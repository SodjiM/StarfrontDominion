const { CargoManager } = require('./cargo-manager');
const { computePathBresenham } = require('../../utils/path');
const { HarvestingManager } = require('../world/harvesting-manager');

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

        // Notify all players that resolution has started
        io.to(`game-${gameId}`).emit('turn-resolving', {
            turnNumber,
            message: `Turn ${turnNumber} is now resolving...`
        });

        try {
            // Begin a transaction for atomic resolution
            let transactionActive = false;
            await new Promise((resolve, reject) => db.run('BEGIN IMMEDIATE TRANSACTION', (e) => {
                if (e) return reject(e);
                transactionActive = true;
                resolve();
            }));

            // 1. Abilities first
            const { processAbilityOrders } = require('./combat-impl');
            await processAbilityOrders(gameId, turnNumber);

            // 2. Movement
            const movementResults = await processMovementOrders(gameId, turnNumber);

            // 3. Visibility updates
            await updateAllPlayersVisibility(gameId, turnNumber);

            // 4. Cleanup old movement orders
            await cleanupOldMovementOrders(gameId, turnNumber);

            // 5. Harvesting
            await HarvestingManager.processHarvestingForTurn(gameId, turnNumber);

            // 6. Combat + cleanup + energy regen
            const { processCombatOrders, cleanupExpiredEffectsAndWrecks } = require('./combat-impl');
            await processCombatOrders(gameId, turnNumber);
            await cleanupExpiredEffectsAndWrecks(gameId, turnNumber);
            await regenerateShipEnergy(gameId, turnNumber);

            // 6.2 Region health tick (upkeep/decay + history)
            try { const { tickRegionHealth } = require('../world/region-health.tick'); await tickRegionHealth(gameId, turnNumber); } catch {}

            // 6.5. Materialize next queued orders for idle ships into upcoming turn
            await materializeQueuedOrders(gameId, turnNumber + 1);

            // Lane tick (Phase 1)
            try { await tickLanes(gameId, turnNumber); } catch (e) { console.warn('Lane tick error', e); }

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

            // Commit the transaction (guard for unexpected external rollbacks)
            if (transactionActive) {
                try {
                    await new Promise((resolve, reject) => db.run('COMMIT', (e) => e ? reject(e) : resolve()));
                } catch (commitErr) {
                    if (!/no transaction is active/i.test(String(commitErr?.message || ''))) {
                        throw commitErr;
                    } else {
                        console.warn('⚠️ Commit called without active transaction (continuing):', commitErr?.message || commitErr);
                    }
                }
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
            try { await new Promise((resolve) => db.run('ROLLBACK', () => resolve())); } catch {}
            io.to(`game-${gameId}`).emit('turn-error', { turnNumber, error: 'Turn resolution failed' });
        } finally {
            turnResolutionLocks.delete(lockKey);
        }
    }
    async function tickLanes(gameId, turnNumber) {
        const sectors = await new Promise((resolve)=>db.all('SELECT id FROM sectors WHERE game_id = ?', [gameId], (e,r)=>resolve(r||[])));
        for (const s of sectors) {
            const sectorId = s.id;
            const edges = await new Promise((resolve)=>db.all(
                `SELECT e.id, e.region_id, e.width_core, e.lane_speed, e.cap_base, e.headway
                 FROM lane_edges e WHERE e.sector_id = ?`, [sectorId], (e, rows)=>resolve(rows||[])));
            const healthRows = await new Promise((resolve)=>db.all('SELECT region_id, health FROM regions WHERE sector_id = ?', [sectorId], (e, rows)=>resolve(rows||[])));
            const healthMap = new Map();
            for (const r of healthRows) healthMap.set(String(r.region_id), Number(r.health||50));
            for (const e of edges) {
                const health = healthMap.get(String(e.region_id)) ?? 50;
                const healthMult = health>=80?1.25:(health>=60?1.0:0.7);
                const cap = Math.max(1, Math.floor(Number(e.cap_base) * (Number(e.width_core)/150) * healthMult));
                const runtime = await new Promise((resolve)=>db.get('SELECT load_cu FROM lane_edges_runtime WHERE edge_id = ?', [e.id], (er, r)=>resolve(r||{load_cu:0})));
                const loadCU = Number(runtime.load_cu || 0);
                const rho = loadCU / Math.max(1, cap);
                const speedMult = rho<=1?1:rho<=1.5?0.8:rho<=2?0.6:0.4;
                const edgeSpeed = Number(e.lane_speed) * speedMult;
                // Release slots from taps FIFO
                const taps = await new Promise((resolve)=>db.all('SELECT id FROM lane_taps WHERE edge_id = ?', [e.id], (er, rows)=>resolve(rows||[])));
                const slotsPerTurn = Math.max(0, Math.floor(Number(e.lane_speed) / Math.max(1, Number(e.headway))));
                let budgetCU = slotsPerTurn * 2; // slot carries 2 CU
                for (const t of taps) {
                    while (budgetCU > 0) {
                        const q = await new Promise((resolve)=>db.get(
                            `SELECT * FROM lane_tap_queue WHERE tap_id = ? AND status = 'queued' ORDER BY enqueued_turn ASC, id ASC LIMIT 1`,
                            [t.id], (er, row)=>resolve(row)));
                        if (!q) break;
                        if (q.cu > budgetCU) break;
                        await new Promise((resolve)=>db.run('UPDATE lane_tap_queue SET status = ? WHERE id = ?', ['launched', q.id], ()=>resolve()));
                        await new Promise((resolve)=>db.run(
                            `INSERT INTO lane_transits (edge_id, ship_id, direction, progress, cu, mode, entered_turn)
                             VALUES (?, ?, ?, 0.0, ?, 'core', ?)`,
                            [e.id, q.ship_id || null, 1, q.cu, turnNumber], ()=>resolve()));
                        await new Promise((resolve)=>db.run(
                            `UPDATE lane_edges_runtime SET load_cu = load_cu + ?, updated_at = CURRENT_TIMESTAMP WHERE edge_id = ?`,
                            [q.cu, e.id], ()=>resolve()));
                        budgetCU -= q.cu;
                    }
                }
                // Progress transits
                const transits = await new Promise((resolve)=>db.all('SELECT id, progress, cu, mode, merge_turns FROM lane_transits WHERE edge_id = ?', [e.id], (er, rows)=>resolve(rows||[])));
                for (const tr of transits) {
                    // Shoulder merge countdown: after merge_turns expire, flip to core
                    if (tr.mode === 'shoulder' && tr.merge_turns != null) {
                        const left = Number(tr.merge_turns);
                        if (left <= 1) {
                            await new Promise((resolve)=>db.run('UPDATE lane_transits SET mode = ?, merge_turns = NULL WHERE id = ?', ['core', tr.id], ()=>resolve()));
                        } else {
                            await new Promise((resolve)=>db.run('UPDATE lane_transits SET merge_turns = ? WHERE id = ?', [left-1, tr.id], ()=>resolve()));
                        }
                    }
                    const newProgress = Math.min(1, Number(tr.progress || 0) + (edgeSpeed / 5000));
                    if (newProgress >= 1) {
                        // Soft off-ramp on arrival (Phase 1 stub: just delete and reduce load)
                        await new Promise((resolve)=>db.run('DELETE FROM lane_transits WHERE id = ?', [tr.id], ()=>resolve()));
                        await new Promise((resolve)=>db.run('UPDATE lane_edges_runtime SET load_cu = MAX(0, load_cu - ?) WHERE edge_id = ?', [tr.cu, e.id], ()=>resolve()));
                        // Future: emit event for interdiction catch on arrival
                    } else {
                        await new Promise((resolve)=>db.run('UPDATE lane_transits SET progress = ? WHERE id = ?', [newProgress, tr.id], ()=>resolve()));
                    }
                }
            }
        }
    }

    // Process all movement orders for a turn with collision detection
    async function processMovementOrders(gameId, turnNumber) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT mo.*, so.x as current_x, so.y as current_y, so.sector_id, so.meta 
                 FROM movement_orders mo 
                 JOIN sector_objects so ON mo.object_id = so.id 
                 JOIN sectors s ON so.sector_id = s.id 
                 WHERE s.game_id = ? AND mo.status IN ('active', 'warp_preparing')
                 AND mo.created_at = (
                     SELECT MAX(mo2.created_at) 
                     FROM movement_orders mo2 
                     WHERE mo2.object_id = mo.object_id AND mo2.status IN ('active', 'warp_preparing')
                 )`,
                [gameId],
                async (err, orders) => {
                    if (err) return reject(err);
                    console.log(`🚀 Processing ${orders.length} movement orders for turn ${turnNumber}`);
                    // Clean any duplicate active movement orders (keep most recent)
                    db.run(
                        `DELETE FROM movement_orders 
                         WHERE status = 'active' 
                         AND created_at NOT IN (
                             SELECT MAX(created_at) 
                             FROM movement_orders mo2 
                             WHERE mo2.object_id = movement_orders.object_id 
                             AND mo2.status = 'active'
                         )`,
                        () => {}
                    );

                    const movementResults = [];
                    for (const order of orders) {
                        try {
                            const result = await processSingleMovement(order, turnNumber, gameId);
                            movementResults.push(result);
                        } catch (e) {
                            console.error(`Error processing movement for object ${order.object_id}:`, e);
                            movementResults.push({ objectId: order.object_id, status: 'error', error: e.message });
                        }
                    }
                    console.log(`📝 Movement processing complete: ${movementResults.length} orders processed`);
                    resolve(movementResults);
                }
            );
        });
    }

    // Process a single ship's movement or warp
    async function processSingleMovement(order, turnNumber, gameId) {
        return new Promise(async (resolve, reject) => {
            if (order.status === 'warp_preparing') {
                return processWarpOrder(order, turnNumber, gameId, resolve, reject);
            }

            const movementPath = JSON.parse(order.movement_path || '[]');
            const currentStep = order.current_step || 0;
            const baseSpeed = order.movement_speed || 1;
            const effects = await new Promise((resolve) => db.all('SELECT * FROM ship_status_effects WHERE ship_id = ? AND (expires_turn IS NULL OR expires_turn >= ?)', [order.object_id, turnNumber], (e, rows) => resolve(rows || [])));
            let speedMultiplier = 1;
            let speedFlat = 0;
            for (const eff of effects) {
                try {
                    const data = eff.effect_data ? JSON.parse(eff.effect_data) : {};
                    if (data.movementBonus) speedMultiplier += data.movementBonus;
                    if (typeof data.movementFlatBonus === 'number') speedFlat = Math.max(speedFlat, data.movementFlatBonus);
                } catch {}
            }
            const movementSpeed = Math.max(1, Math.floor(baseSpeed * speedMultiplier) + speedFlat);
            const stepsToTake = Math.min(movementSpeed, movementPath.length - 1 - currentStep);

            if (stepsToTake <= 0) {
                db.run('UPDATE movement_orders SET status = ? WHERE id = ?', ['completed', order.id], () => resolve({ objectId: order.object_id, status: 'completed' }));
                return;
            }

            const newStep = currentStep + stepsToTake;
            const targetTile = movementPath[newStep];
            if (!targetTile) return reject(new Error('Invalid movement path'));

            db.get(
                'SELECT id, type, owner_id, meta FROM sector_objects WHERE sector_id = ? AND x = ? AND y = ? AND id != ?',
                [order.sector_id, targetTile.x, targetTile.y, order.object_id],
                (err, collision) => {
                    if (err) return reject(err);
                    if (collision) {
                        const blockingInfo = {
                            blockingObjectId: collision.id,
                            blockingType: collision.type,
                            blockingOwner: collision.owner_id,
                            blockedAt: targetTile,
                            turn: turnNumber
                        };
                        db.run('UPDATE movement_orders SET status = ?, blocked_by = ? WHERE id = ?', ['blocked', JSON.stringify(blockingInfo), order.id], () => {
                            resolve({ objectId: order.object_id, status: 'blocked', blockingInfo, finalPosition: { x: order.current_x, y: order.current_y } });
                        });
                        return;
                    }

                    db.run('UPDATE sector_objects SET x = ?, y = ?, updated_at = ? WHERE id = ?', [targetTile.x, targetTile.y, new Date().toISOString(), order.object_id], (updateErr) => {
                        if (updateErr) return reject(updateErr);

                        const fromTile = movementPath[currentStep];
                        if (fromTile) {
                            db.run(
                                `INSERT INTO movement_history 
                                 (object_id, game_id, turn_number, from_x, from_y, to_x, to_y, movement_speed) 
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                                [order.object_id, gameId, turnNumber, fromTile.x, fromTile.y, targetTile.x, targetTile.y, movementSpeed],
                                () => {}
                            );
                        }

                        const isComplete = newStep >= movementPath.length - 1;
                        const newStatus = isComplete ? 'completed' : 'active';
                        const remainingSteps = movementPath.length - 1 - newStep;
                        const newETA = Math.ceil(remainingSteps / movementSpeed);
                        db.run('UPDATE movement_orders SET current_step = ?, status = ?, eta_turns = ? WHERE id = ?', [newStep, newStatus, newETA, order.id], () => {
                            resolve({ objectId: order.object_id, status: newStatus, newPosition: targetTile, currentStep: newStep, totalSteps: movementPath.length - 1, eta: newETA });
                        });
                    });
                }
            );
        });
    }

    function processWarpOrder(order, turnNumber, gameId, resolve, reject) {
        const preparationTurns = order.warp_preparation_turns || 0;
        const warpPhase = order.warp_phase || 'preparing';
        const meta = JSON.parse(order.meta || '{}');
        const requiredPrep = (typeof meta.warpPreparationTurns === 'number' && meta.warpPreparationTurns >= 0) ? Math.max(0, Math.floor(meta.warpPreparationTurns)) : 2;

        if (warpPhase === 'preparing') {
            const newPreparationTurns = preparationTurns + 1;
            if (newPreparationTurns >= requiredPrep) {
                db.run('UPDATE sector_objects SET x = ?, y = ? WHERE id = ?', [order.warp_destination_x, order.warp_destination_y, order.object_id], function(err) {
                    if (err) return reject(err);
                    db.run(
                        `INSERT INTO movement_history 
                         (object_id, game_id, turn_number, from_x, from_y, to_x, to_y, movement_speed) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [order.object_id, gameId, turnNumber, order.current_x || order.warp_destination_x, order.current_y || order.warp_destination_y, order.warp_destination_x, order.warp_destination_y, 0],
                        () => {}
                    );
                    db.run('DELETE FROM movement_orders WHERE id = ?', [order.id], () => {
                        resolve({ objectId: order.object_id, status: 'warp_completed', newX: order.warp_destination_x, newY: order.warp_destination_y });
                    });
                });
            } else {
                db.run('UPDATE movement_orders SET warp_preparation_turns = ? WHERE id = ?', [newPreparationTurns, order.id], (err) => {
                    if (err) return reject(err);
                    resolve({ objectId: order.object_id, status: 'warp_preparing', preparationTurns: newPreparationTurns });
                });
            }
        } else {
            resolve({ objectId: order.object_id, status: 'warp_error', message: 'Unknown warp phase' });
        }
    }

    async function materializeQueuedOrders(gameId, upcomingTurn) {
        const ships = await new Promise((resolve) => {
            db.all(
                `SELECT so.id as ship_id, so.sector_id, so.x, so.y
                 FROM sector_objects so
                 JOIN sectors s ON s.id = so.sector_id
                 WHERE s.game_id = ? AND so.type = 'ship'`,
                [gameId],
                (err, rows) => resolve(rows || [])
            );
        });

        for (const ship of ships) {
            try {
                const activeMove = await new Promise((resolve) => db.get(
                    `SELECT id FROM movement_orders WHERE object_id = ? AND status IN ('active','warp_preparing') ORDER BY created_at DESC LIMIT 1`,
                    [ship.ship_id],
                    (e, r) => resolve(r)
                ));
                if (activeMove) continue;
                const harvesting = await new Promise((resolve) => db.get(
                    `SELECT id FROM harvesting_tasks WHERE ship_id = ? AND status IN ('active','paused')`,
                    [ship.ship_id],
                    (e, r) => resolve(r)
                ));
                if (harvesting) continue;

                const q = await new Promise((resolve) => db.get(
                    `SELECT * FROM queued_orders 
                     WHERE game_id = ? AND ship_id = ? AND status = 'queued'
                     AND (not_before_turn IS NULL OR not_before_turn <= ?)
                     ORDER BY sequence_index ASC, id ASC LIMIT 1`,
                    [gameId, ship.ship_id, upcomingTurn],
                    (e, r) => resolve(r)
                ));
                if (!q) continue;

                let payload = {};
                try { payload = q.payload ? JSON.parse(q.payload) : {}; } catch {}

                if (q.order_type === 'move') {
                    const dest = payload?.destination || payload;
                    if (!dest || typeof dest.x !== 'number' || typeof dest.y !== 'number') {
                        await new Promise((resolve) => db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], () => resolve()));
                        continue;
                    }
                    const movementPath = computePathBresenham(ship.x, ship.y, dest.x, dest.y);
                    if (movementPath.length <= 1) {
                        await new Promise((resolve) => db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], () => resolve()));
                        continue;
                    }
                    const metaRow = await new Promise((resolve) => db.get('SELECT meta FROM sector_objects WHERE id = ?', [ship.ship_id], (e, r) => resolve(r)));
                    const metaObj = (() => { try { return JSON.parse(metaRow?.meta || '{}'); } catch { return {}; } })();
                    const baseSpeed = Number(metaObj.movementSpeed || 1);
                    const eta = Math.ceil((movementPath.length - 1) / Math.max(1, baseSpeed));
                    await new Promise((resolve, reject) => {
                        db.run(
                            `INSERT INTO movement_orders (object_id, destination_x, destination_y, movement_speed, eta_turns, movement_path, current_step, status, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, 0, 'active', ?)`,
                            [ship.ship_id, dest.x, dest.y, baseSpeed, eta, JSON.stringify(movementPath), new Date().toISOString()],
                            (err) => err ? reject(err) : resolve()
                        );
                    });
                    await new Promise((resolve) => db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['consumed', q.id], () => resolve()));
                } else if (q.order_type === 'warp') {
                    const dest = payload?.destination || {};
                    if (typeof dest.x !== 'number' || typeof dest.y !== 'number') {
                        await new Promise((resolve) => db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], () => resolve()));
                        continue;
                    }
                    await new Promise((resolve, reject) => {
                        db.run(
                            `INSERT INTO movement_orders (object_id, warp_target_id, warp_destination_x, warp_destination_y, warp_phase, warp_preparation_turns, status, created_at)
                             VALUES (?, ?, ?, ?, 'preparing', 0, 'warp_preparing', ?)`,
                            [ship.ship_id, payload?.targetId || null, dest.x, dest.y, new Date().toISOString()],
                            (err) => err ? reject(err) : resolve()
                        );
                    });
                    await new Promise((resolve) => db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['consumed', q.id], () => resolve()));
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

    return resolveTurn;
}

module.exports = { createTurnResolver };


