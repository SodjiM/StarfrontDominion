const physicalScale = require('../../../client/utils/physical-scale');
const { CargoManager } = require('./cargo-manager');
const { computePathBresenham } = require('../../utils/path');

// Factory to create a resolveTurn function bound to app dependencies
function createTurnResolver({ db, io, eventBus, EVENTS }) {
    if (!db || !io || !eventBus || !EVENTS) throw new Error('createTurnResolver requires { db, io, eventBus, EVENTS }');

    const turnResolutionLocks = new Set();

    async function resolveTurn(gameId, turnNumber) {
        const resolutionStartedAt = Date.now();
        const lockKey = `${gameId}-${turnNumber}`;

        if (turnResolutionLocks.has(lockKey)) {
            console.log(`⏳ Turn ${turnNumber} for game ${gameId} is already being resolved, skipping duplicate`);
            return;
        }

        turnResolutionLocks.add(lockKey);
        console.log(`🎬 Resolving turn ${turnNumber} for game ${gameId} (Atomic Resolution)`);

        let transactionActive = false;
        try {
            // Begin a transaction for atomic resolution
            await new Promise((resolve, reject) => db.run('BEGIN IMMEDIATE TRANSACTION', (e) => {
                if (e) return reject(e);
                transactionActive = true;
                resolve();
            }));

            // Read the status while holding the write lock. This prevents a
            // timer/manual race from resolving a turn that was already closed.
            const current=await new Promise((resolve,reject)=>db.get('SELECT status FROM turns WHERE game_id=? AND turn_number=?',[gameId,turnNumber],(e,r)=>e?reject(e):resolve(r)));
            if(!current || current.status!=='waiting') {
                await new Promise((resolve) => db.run('ROLLBACK', () => resolve()));
                transactionActive = false;
                return;
            }
            io.to(`game-${gameId}`).emit('turn-resolving', {
                turnNumber,
                message: `Turn ${turnNumber} is now resolving...`
            });

            // 1. Abilities first
            const { processAbilityOrders } = require('./combat-impl');
            await processAbilityOrders(gameId, turnNumber);

            // 2. Movement
            const {NavigationService}=require('./navigation.service');
            const movementResults = await new NavigationService(db).tickMoves(gameId, turnNumber);

            // 3. Visibility updates
            await updateAllPlayersVisibility(gameId, turnNumber);

            // 4. Cleanup old movement orders
            await cleanupOldMovementOrders(gameId, turnNumber);

            // 5. Harvesting
            const { HarvestingManager } = require('../world/harvesting-manager');
            await HarvestingManager.processHarvestingForTurn(gameId, turnNumber);

            // 6. Combat + cleanup + energy regen
            const { processCombatOrders, cleanupExpiredEffectsAndWrecks } = require('./combat-impl');
            await processCombatOrders(gameId, turnNumber);
            await cleanupExpiredEffectsAndWrecks(gameId, turnNumber);
            await regenerateShipEnergy(gameId, turnNumber);

            // 6.2 Region health tick (upkeep/decay + history)
            const { tickRegionHealth } = require('../world/region-health.tick');
            await tickRegionHealth(gameId, turnNumber);

            // 6.5. Materialize the next generic action for each eligible ship.
            const { QueuedActionService } = require('./queued-action.service');
            const queueResult = await new QueuedActionService(db).materializeForTurn(gameId, turnNumber + 1);

            // Lane tick (Phase 1)
            await tickLanes(gameId, turnNumber);
            await updateAllPlayersVisibility(gameId, turnNumber);

            // Create next turn and mark current as completed
            const nextTurn = turnNumber + 1;
            await new Promise((resolve, reject) => {
                db.run(
                    'INSERT INTO turns (game_id, turn_number, status) VALUES (?, ?, ?)',
                    [gameId, nextTurn, 'waiting'],
                    (err) => {
                        if (err) return reject(err);
                        db.run(
                            'UPDATE turns SET status = ?, resolved_at = ? WHERE game_id = ? AND turn_number = ?',
                            ['completed', new Date().toISOString(), gameId, turnNumber],
                            (err2) => err2 ? reject(err2) : resolve()
                        );
                    }
                );
            });

            await new Promise((resolve,reject)=>db.run('COMMIT',e=>e?reject(e):resolve()));
            transactionActive=false;

            for (const shipId of queueResult?.changedShipIds || []) {
                io.to(`game-${gameId}`).emit('queue:updated', { shipId });
            }

            const resolutionDurationMs = Date.now() - resolutionStartedAt;
            console.log(`✅ Turn ${turnNumber} atomically resolved in ${resolutionDurationMs}ms, starting turn ${nextTurn}`);

            // Emit events on the internal event bus
            try {
                const abilityOrdersCount = await new Promise((resolve) => db.get('SELECT COUNT(1) as c FROM ability_orders WHERE game_id = ? AND turn_number = ?', [gameId, turnNumber], (e, r) => resolve(r?.c || 0)));
                const metrics = {
                    resolutionDurationMs,
                    movementOrdersProcessed: null,
                    abilityOrdersQueued: abilityOrdersCount
                };
                if (typeof movementResults?.length === 'number') metrics.movementOrdersProcessed = movementResults.length;
                eventBus.emit(EVENTS.TurnResolved, { gameId, turnNumber, nextTurn, metrics });
                eventBus.emit(EVENTS.TurnStarted, { gameId, turnNumber: nextTurn });
            } catch {}

            // Notify clients (they will reload state)
            io.to(`game-${gameId}`).emit('turn-resolved', {
                turnNumber,
                nextTurn,
                completedTurn: turnNumber,
                newTurn: nextTurn,
                message: `Turn ${turnNumber} resolved! All changes are now visible.`
            });

        } catch (error) {
            console.error(`❌ Error resolving turn ${turnNumber}:`, error);
            if(transactionActive)try { await new Promise((resolve) => db.run('ROLLBACK', () => resolve())); } catch {}
            io.to(`game-${gameId}`).emit('turn-error', { turnNumber, error: 'Turn resolution failed' });
        } finally {
            turnResolutionLocks.delete(lockKey);
        }
    }
    async function tickLanes(gameId, turnNumber) {
        const {LaneTravelService}=require('./lane-travel.service');
        await new LaneTravelService(db).tick(gameId,turnNumber);
    }

    async function materializeQueuedOrders(gameId, upcomingTurn) {
        const {HarvestingManager}=require('../world/harvesting-manager');
        const ships = await new Promise((resolve) => {
            db.all(
                `SELECT so.id as ship_id, so.sector_id, so.x, so.y, so.meta, so.type
                 FROM sector_objects so
                 JOIN sectors s ON s.id = so.sector_id
                 WHERE s.game_id = ? AND so.type = 'ship'`,
                [gameId],
                (err, rows) => resolve(rows || [])
            );
        });

        for (const ship of ships) {
            try {
                // Pull next queued order first so we can make exceptions for specific types
                const q = await new Promise((resolve) => db.get(
                    `SELECT * FROM queued_orders 
                     WHERE game_id = ? AND ship_id = ? AND status = 'queued'
                     AND (not_before_turn IS NULL OR not_before_turn <= ?)
                     ORDER BY sequence_index ASC, id ASC LIMIT 1`,
                    [gameId, ship.ship_id, upcomingTurn],
                    (e, r) => resolve(r)
                ));
                if (!q) continue;
                if(['warp','travel_start'].includes(q.order_type)){await new Promise((r,j)=>db.run("UPDATE queued_orders SET status='skipped' WHERE id=?",[q.id],e=>e?j(e):r()));continue;}

                // Skip most orders when the ship is busy moving or harvesting
                const activeMove = await new Promise((resolve) => db.get(
                    `SELECT id FROM movement_orders WHERE object_id = ? AND status IN ('active','blocked','warp_preparing') ORDER BY created_at DESC LIMIT 1`,
                    [ship.ship_id],
                    (e, r) => resolve(r)
                ));
                const harvesting = await new Promise((resolve) => db.get(
                    `SELECT id FROM harvesting_tasks WHERE ship_id = ? AND status IN ('active','paused')`,
                    [ship.ship_id],
                    (e, r) => resolve(r)
                ));
                const laneBusy = await new Promise((resolve,reject)=>db.get("SELECT id FROM lane_itineraries WHERE ship_id=? AND status='active'",[ship.ship_id],(e,r)=>e?reject(e):resolve(r)));
                if (laneBusy || ((q.order_type !== 'travel_start') && (activeMove || harvesting))) continue;

                let payload = {};
                try { payload = q.payload ? JSON.parse(q.payload) : {}; } catch {}

                if (q.order_type === 'move') {
                    const dest = payload?.destination || payload;
                    if (!dest || typeof dest.x !== 'number' || typeof dest.y !== 'number') {
                        await new Promise((resolve) => db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], () => resolve()));
                        continue;
                    }
                    try {
                        const {NavigationService}=require('./navigation.service');
                        await new NavigationService(db).order(ship.ship_id,dest,{gameId});
                        await new Promise((r,j)=>db.run("UPDATE queued_orders SET status='consumed' WHERE id=?",[q.id],e=>e?j(e):r()));
                    } catch(e) {
                        await new Promise((r,j)=>db.run("UPDATE queued_orders SET status='skipped' WHERE id=?",[q.id],e=>e?j(e):r()));
                    }
                } else if (q.order_type === 'harvest_start') {
                    const nodeId = Number(payload?.nodeId);
                    if (!nodeId) {
                        await new Promise((resolve) => db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], () => resolve()));
                        continue;
                    }
                    const currentTurn = upcomingTurn;
                    const result = await HarvestingManager.startHarvesting(ship.ship_id, nodeId, currentTurn);
                    if (result?.success) await new Promise((resolve) => db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['consumed', q.id], () => resolve()));
                    else await new Promise((resolve) => db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], () => resolve()));
                } else if (q.order_type === 'harvest_stop') {
                    await HarvestingManager.stopHarvesting(ship.ship_id).catch(() => {});
                    await new Promise((resolve) => db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['consumed', q.id], () => resolve()));
                } else if (q.order_type === 'ability') {
                    // Materialize queued ability into ability_orders for upcoming turn when preconditions are acceptable
                    let payloadObj = payload || {};
                    const abilityKey = payloadObj.abilityKey;
                    if (!abilityKey) {
                        await new Promise((resolve)=>db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], ()=>resolve()));
                        continue;
                    }
                    let targetId = (typeof payloadObj.targetObjectId === 'number') ? Number(payloadObj.targetObjectId) : null;
                    const target = payloadObj.target && typeof payloadObj.target.x==='number' && typeof payloadObj.target.y==='number' ? { x: Number(payloadObj.target.x), y: Number(payloadObj.target.y) } : null;
                    const { Abilities } = require('../registry/abilities');
                    const ability = Abilities[abilityKey];
                    // If target object anchor is specified, validate presence/sector and simple range
                    if (targetId) {
                        const t = await new Promise((resolve)=>db.get('SELECT * FROM sector_objects WHERE id = ?', [targetId], (e,r)=>resolve(r||null)));
                        if (!t || Number(t.sector_id) !== Number(ship.sector_id)) {
                            await new Promise((resolve)=>db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], ()=>resolve()));
                            // Cascade cancel remaining queued items
                            await new Promise((resolve)=>db.run(`UPDATE queued_orders SET status = 'cancelled' WHERE game_id = ? AND ship_id = ? AND status = 'queued' AND sequence_index > ?`, [gameId, ship.ship_id, q.sequence_index], ()=>resolve()));
                            continue;
                        }
                        if (ability && ability.range) {
                            const dx = Number(t.x) - Number(ship.x);
                            const dy = Number(t.y) - Number(ship.y);
                            const dist = physicalScale.gap({...ship,type:'ship'},t);
                            if (dist > Number(ability.range)) {
                                // Not in range yet; leave queued to try next turn (auto-approach can be added later)
                                continue;
                            }
                        }
                    }
                    await new Promise((resolve, reject) => db.run(
                        `INSERT INTO ability_orders (game_id, turn_number, caster_id, ability_key, target_object_id, target_x, target_y, params, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [gameId, upcomingTurn, ship.ship_id, String(abilityKey), targetId || null, target?target.x:null, target?target.y:null, payloadObj.params?JSON.stringify(payloadObj.params):null, new Date().toISOString()],
                        (err)=> err ? reject(err) : resolve()
                    ));
                    await new Promise((resolve)=>db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['consumed', q.id], ()=>resolve()));
                }
            } catch (e) {
                console.warn('materializeQueuedOrders error for ship', ship.ship_id, e?.message || e);
            }
        }
    }

    async function updateAllPlayersVisibility(gameId, turnNumber) {
        const { GameWorldManager } = require('./game-world.service');
        return new Promise((resolve, reject) => {
            db.all('SELECT DISTINCT user_id FROM game_players WHERE game_id = ?', [gameId], async (err, players) => {
                if (err) return reject(err);
                const visibilityPromises = players.map(player =>
                    GameWorldManager.calculatePlayerVision(gameId, player.user_id, turnNumber).catch(() => null)
                );
                try {
                    await Promise.all(visibilityPromises);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async function cleanupOldMovementOrders(gameId, currentTurn) {
        return new Promise((resolve, reject) => {
            db.run(
                `DELETE FROM movement_orders 
                 WHERE status = 'completed' 
                 AND id IN (
                     SELECT mo.id FROM movement_orders mo
                     JOIN sector_objects so ON mo.object_id = so.id
                     JOIN sectors s ON so.sector_id = s.id
                     WHERE s.game_id = ? AND (? - COALESCE(mo.current_step, 0)) > 2
                 )`,
                [gameId, currentTurn],
                function(err) { return err ? reject(err) : resolve(); }
            );
        });
    }

    async function regenerateShipEnergy(gameId, turnNumber) {
        const ships = await new Promise((resolve) => {
            db.all(
                `SELECT so.id, so.meta FROM sector_objects so
                 JOIN sectors s ON s.id = so.sector_id
                 WHERE s.game_id = ? AND so.type = 'ship'`,
                [gameId],
                (e, rows) => resolve(rows || [])
            );
        });
        for (const ship of ships) {
            try {
                const meta = JSON.parse(ship.meta || '{}');
                const regen = Number(meta.energyRegen || 0);
                if (regen > 0) {
                    const current = Number(meta.energy || 0);
                    const cap = (typeof meta.maxEnergy === 'number') ? Number(meta.maxEnergy) : undefined;
                    const next = cap != null ? Math.min(cap, current + regen) : current + regen;
                    if (next !== current) {
                        meta.energy = next;
                        const effects = await new Promise((resolve) => db.all('SELECT * FROM ship_status_effects WHERE ship_id = ? AND (expires_turn IS NULL OR expires_turn >= ?)', [ship.id, turnNumber], (e, rows) => resolve(rows || [])));
                        const hasRegen = effects.some(eff => { try { const d = eff.effect_data ? JSON.parse(eff.effect_data) : {}; return eff.effect_key === 'repair_over_time' && d.healPercentPerTurn; } catch { return false; } });
                        if (hasRegen && typeof meta.maxHp === 'number' && typeof meta.hp === 'number') {
                            const healPct = effects.reduce((acc, eff) => { try { const d = eff.effect_data ? JSON.parse(eff.effect_data) : {}; return acc + (eff.effect_key === 'repair_over_time' ? (d.healPercentPerTurn || 0) : 0); } catch { return acc; } }, 0);
                            const heal = Math.max(1, Math.floor((meta.maxHp || 0) * healPct));
                            meta.hp = Math.min(meta.maxHp, meta.hp + heal);
                        }
                        // Clear expired UI hints on tick
                        try {
                            if (typeof meta.scanBoostExpires === 'number' && Number(meta.scanBoostExpires) <= Number(turnNumber)) { delete meta.scanRangeMultiplier; delete meta.scanBoostExpires; }
                            if (typeof meta.movementBoostExpires === 'number' && Number(meta.movementBoostExpires) <= Number(turnNumber)) { delete meta.movementBoostMultiplier; delete meta.movementBoostExpires; }
                            if (typeof meta.movementFlatExpires === 'number' && Number(meta.movementFlatExpires) <= Number(turnNumber)) { delete meta.movementFlatBonus; delete meta.movementFlatExpires; }
                            if (typeof meta.evasionExpires === 'number' && Number(meta.evasionExpires) <= Number(turnNumber)) { delete meta.evasionBonus; delete meta.evasionExpires; }
                        } catch {}
                        await new Promise((resolve) => db.run('UPDATE sector_objects SET meta = ?, updated_at = ? WHERE id = ?', [JSON.stringify(meta), new Date().toISOString(), ship.id], () => resolve()));
                    }
                }
            } catch {}
        }
    }

    return (gameId,turnNumber)=>require('./mutation-lock').run(()=>resolveTurn(Number(gameId),Number(turnNumber)));
}

module.exports = { createTurnResolver };

