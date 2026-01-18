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
            try { const { HarvestingManager } = require('../world/harvesting-manager'); await HarvestingManager.processHarvestingForTurn(gameId, turnNumber); } catch {}

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
        // Global flat warp speed in tiles per turn (independent of lane length)
        const WARP_BASE_TILES_PER_TURN = 100; // tune here
        // Per-ship warp speed: read from ship meta at tick time
        const sectors = await new Promise((resolve)=>db.all('SELECT id FROM sectors WHERE game_id = ?', [gameId], (e,r)=>resolve(r||[])));
        // Cache edge geometry for interpolation
        const geomCache = new Map();
        async function getEdgeGeom(edgeId) {
            const key = Number(edgeId);
            if (geomCache.has(key)) return geomCache.get(key);
            const row = await new Promise((resolve)=>db.get('SELECT polyline_json FROM lane_edges WHERE id = ?', [key], (er, r)=>resolve(r||null)));
            const pts = (()=>{ try { return JSON.parse(row?.polyline_json||'[]'); } catch { return []; } })();
            let total = 0; const acc = [0];
            if (pts.length > 1) {
                for (let i=1;i<pts.length;i++){ total += Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y); acc.push(total); }
            }
            const geom = { pts, acc, total: Math.max(1, total) };
            geomCache.set(key, geom);
            return geom;
        }
        function pointAtProgress(geom, p) {
            const clamped = Math.max(0, Math.min(1, Number(p||0)));
            const s = clamped * geom.total; const acc = geom.acc; const pts = geom.pts;
            if (pts.length < 2) return { x: pts[0]?.x || 0, y: pts[0]?.y || 0 };
            let idx = 0; while (idx<acc.length-1 && acc[idx+1] < s) idx++;
            const segLen = Math.max(1e-6, acc[idx+1]-acc[idx]);
            const t = (s - acc[idx]) / segLen;
            return { x: Math.round(pts[idx].x + (pts[idx+1].x-pts[idx].x)*t), y: Math.round(pts[idx].y + (pts[idx+1].y-pts[idx].y)*t) };
        }
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
                
                // Use flat tiles-per-turn warp speed adjusted by congestion multiplier
                const baseTilesPerTurn = Math.max(1, WARP_BASE_TILES_PER_TURN * speedMult);
                
                // 1. Release slots from taps FIFO
                const taps = await new Promise((resolve)=>db.all('SELECT id FROM lane_taps WHERE edge_id = ?', [e.id], (er, rows)=>resolve(rows||[])));
                const slotsPerTurn = Math.max(1, Math.floor(Number(e.lane_speed) / Math.max(1, Number(e.headway))));
                let budgetCU = slotsPerTurn * 2; // slot carries 2 CU
                
                for (const t of taps) {
                    while (budgetCU > 0) {
                        const q = await new Promise((resolve)=>db.get(
                            `SELECT * FROM lane_tap_queue 
                             WHERE tap_id = ? AND status = 'queued' AND enqueued_turn <= ?
                             ORDER BY enqueued_turn ASC, id ASC LIMIT 1`,
                            [t.id, Number(turnNumber)], (er, row)=>resolve(row)));
                        if (!q) break;
                        if (q.cu > budgetCU) break;
                        
                        await new Promise((resolve)=>db.run('UPDATE lane_tap_queue SET status = ? WHERE id = ?', ['launched', q.id], ()=>resolve()));
                        
                        let initialProgress = 0.0; let metaJson = null;
                        try {
                            const itin = await new Promise((resolve)=>db.get(
                                `SELECT id, itinerary_json FROM lane_itineraries WHERE ship_id = ? AND sector_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
                                [q.ship_id, sectorId], (er, row)=>resolve(row||null)));
                            if (itin) {
                                let legs = []; try { legs = JSON.parse(itin.itinerary_json||'[]'); } catch {}
                                const leg = legs.find(L => !L.done && Number(L.edgeId) === Number(e.id));
                                if (leg) {
                                    const geom = await getEdgeGeom(e.id);
                                    initialProgress = Math.max(0, Math.min(1, Number(leg.sStart||0) / geom.total));
                                    metaJson = JSON.stringify({ targetStartP: initialProgress, targetEndP: Math.max(0, Math.min(1, Number(leg.sEnd||geom.total) / geom.total)) });
                                }
                            }
                        } catch {}
                        
                        const shipRow = await new Promise((resolve)=>db.get('SELECT id FROM sector_objects WHERE id = ?', [q.ship_id], (er, r)=>resolve(r||null)));
                        if (shipRow) {
                            await new Promise((resolve)=>db.run(
                                `INSERT INTO lane_transits (edge_id, ship_id, direction, progress, cu, mode, entered_turn, meta)
                                 VALUES (?, ?, ?, ?, ?, 'core', ?, ?)`,
                                [e.id, q.ship_id, 1, initialProgress, q.cu, turnNumber, metaJson], ()=>resolve()));
                            
                            const geom = await getEdgeGeom(e.id);
                            const pos0 = pointAtProgress(geom, initialProgress);
                            await new Promise((resolve)=>db.run('UPDATE sector_objects SET x = ?, y = ?, updated_at = ? WHERE id = ?', [pos0.x, pos0.y, new Date().toISOString(), q.ship_id], ()=>resolve()));
                        }
                        budgetCU -= q.cu;
                    }
                }

                // 2. Launch Wildcat merges from itineraries (FIX: Wildcat Itinerary Bug)
                if (rho < 1.2) {
                    const wildcatCandidates = await new Promise((resolve)=>db.all(
                        `SELECT * FROM lane_itineraries WHERE sector_id = ? AND status = 'active'`, [sectorId], (er, rows)=>resolve(rows||[])));
                    
                    for (const itin of wildcatCandidates) {
                        let legs = []; try { legs = JSON.parse(itin.itinerary_json||'[]'); } catch {}
                        const nextLeg = legs.find(L => !L.done);
                        if (nextLeg && Number(nextLeg.edgeId) === Number(e.id) && nextLeg.entry === 'wildcat') {
                            const inTransit = await new Promise((resolve)=>db.get('SELECT id FROM lane_transits WHERE ship_id = ?', [itin.ship_id], (er, r)=>resolve(r||null)));
                            if (inTransit) continue;

                            const ship = await new Promise((resolve)=>db.get('SELECT x, y, meta FROM sector_objects WHERE id = ?', [itin.ship_id], (er, r)=>resolve(r||null)));
                            if (!ship) continue;

                            const geom = await getEdgeGeom(e.id);
                            const startPos = pointAtProgress(geom, Number(nextLeg.sStart || 0) / geom.total);
                            const d = Math.hypot(ship.x - startPos.x, ship.y - startPos.y);
                            
                            if (d <= 5) { // Close enough to "auto-merge" if turn tick picks it up
                                let cu = 1; try { cu = JSON.parse(ship.meta||'{}').convoyUnits || 1; } catch {}
                                const startP = Number(nextLeg.sStart || 0) / geom.total;
                                const endP = Number(nextLeg.sEnd || geom.total) / geom.total;
                                
                                await new Promise((resolve)=>db.run(
                                    `INSERT INTO lane_transits (edge_id, ship_id, direction, progress, cu, mode, merge_turns, entered_turn, meta)
                                     VALUES (?, ?, 1, ?, ?, 'shoulder', ?, ?, ?)`,
                                    [e.id, itin.ship_id, startP, cu, Math.max(1, Number(nextLeg.mergeTurns || 1)), turnNumber, JSON.stringify({ targetStartP: startP, targetEndP: endP })], ()=>resolve()));
                                await new Promise((resolve)=>db.run(`UPDATE lane_edges_runtime SET load_cu = load_cu + ? WHERE edge_id = ?`, [cu, e.id], ()=>resolve()));
                            }
                        }
                    }
                }

                // 3. Progress transits with Multi-Leg support
                const transits = await new Promise((resolve)=>db.all('SELECT * FROM lane_transits WHERE edge_id = ?', [e.id], (er, rows)=>resolve(rows||[])));
                for (const tr of transits) {
                    let distanceRemaining = baseTilesPerTurn; // tiles we can still move this turn
                    let currentTransit = tr;
                    let currentEdgeId = e.id;

                    while (distanceRemaining > 0 && currentTransit) {
                        if (currentTransit.mode === 'shoulder' && currentTransit.merge_turns != null) {
                            const left = Number(currentTransit.merge_turns);
                            if (left <= 1) {
                                await new Promise((resolve)=>db.run('UPDATE lane_transits SET mode = ?, merge_turns = NULL WHERE id = ?', ['core', currentTransit.id], ()=>resolve()));
                                currentTransit.mode = 'core';
                            } else {
                                await new Promise((resolve)=>db.run('UPDATE lane_transits SET merge_turns = ? WHERE id = ?', [left-1, currentTransit.id], ()=>resolve()));
                                break;
                            }
                        }

                        let targetStartP = 0, targetEndP = 1;
                        try { const m = currentTransit.meta ? JSON.parse(currentTransit.meta) : null; if (m) { targetStartP = m.targetStartP ?? 0; targetEndP = m.targetEndP ?? 1; } } catch {}
                        
                        const geom = await getEdgeGeom(currentEdgeId);
                        let shipWarpMult = 1;
                        try {
                            const shipRow = await new Promise((resolve)=>db.get('SELECT meta FROM sector_objects WHERE id = ?', [currentTransit.ship_id], (er, r)=>resolve(r||null)));
                            shipWarpMult = JSON.parse(shipRow?.meta || '{}').warpSpeedMultiplier || 1;
                        } catch {}

                        const effectiveSpeed = distanceRemaining * shipWarpMult;
                        const deltaP = effectiveSpeed / geom.total;
                        let curP = Number(currentTransit.progress || 0);
                        if (curP < targetStartP) curP = targetStartP;

                        const newProgress = Math.min(targetEndP, curP + deltaP);
                        const actualDeltaP = newProgress - curP;
                        const distanceUsed = actualDeltaP * geom.total / shipWarpMult;
                        distanceRemaining -= distanceUsed;

                        const pos = pointAtProgress(geom, newProgress);
                        await new Promise((resolve)=>db.run('UPDATE sector_objects SET x = ?, y = ?, updated_at = ? WHERE id = ?', [pos.x, pos.y, new Date().toISOString(), currentTransit.ship_id], ()=>resolve()));
                        await new Promise((resolve)=>db.run('UPDATE lane_transits SET progress = ? WHERE id = ?', [newProgress, currentTransit.id], ()=>resolve()));

                        if (newProgress >= targetEndP) {
                            await new Promise((resolve)=>db.run('DELETE FROM lane_transits WHERE id = ?', [currentTransit.id], ()=>resolve()));
                            await new Promise((resolve)=>db.run('UPDATE lane_edges_runtime SET load_cu = MAX(0, load_cu - ?) WHERE edge_id = ?', [currentTransit.cu, currentEdgeId], ()=>resolve()));
                            
                            const itinRow = await new Promise((resolve)=>db.get(
                                `SELECT id, itinerary_json FROM lane_itineraries WHERE ship_id = ? AND sector_id = ? AND status = 'active'`, [currentTransit.ship_id, sectorId], (er, row)=>resolve(row)));
                            
                            if (itinRow) {
                                let legs = []; try { legs = JSON.parse(itinRow.itinerary_json||'[]'); } catch {}
                                const curIdx = legs.findIndex(L => !L.done && Number(L.edgeId) === Number(currentEdgeId));
                                if (curIdx !== -1) legs[curIdx].done = true;
                                const nextLeg = legs.find(L => !L.done);
                                await new Promise((resolve)=>db.run('UPDATE lane_itineraries SET itinerary_json = ? WHERE id = ?', [JSON.stringify(legs), itinRow.id], ()=>resolve()));

                                if (nextLeg) {
                                    if (nextLeg.entry === 'wildcat') {
                                        const nextGeom = await getEdgeGeom(nextLeg.edgeId);
                                        const nextStartP = Number(nextLeg.sStart || 0) / nextGeom.total;
                                        const nextEndP = Number(nextLeg.sEnd || nextGeom.total) / nextGeom.total;
                                        
                                        const insertRes = await new Promise((resolve)=>db.run(
                                            `INSERT INTO lane_transits (edge_id, ship_id, direction, progress, cu, mode, entered_turn, meta)
                                             VALUES (?, ?, 1, ?, ?, 'core', ?, ?)`,
                                            [nextLeg.edgeId, currentTransit.ship_id, nextStartP, currentTransit.cu, turnNumber, JSON.stringify({ targetStartP: nextStartP, targetEndP: nextEndP })], function(err){ resolve(this); }));
                                        
                                        await new Promise((resolve)=>db.run(`UPDATE lane_edges_runtime SET load_cu = load_cu + ? WHERE edge_id = ?`, [currentTransit.cu, nextLeg.edgeId], ()=>resolve()));
                                        
                                        currentTransit = { id: insertRes.lastID, ship_id: currentTransit.ship_id, cu: currentTransit.cu, progress: nextStartP, mode: 'core', meta: JSON.stringify({ targetStartP: nextStartP, targetEndP: nextEndP }) };
                                        currentEdgeId = nextLeg.edgeId;
                                        continue; 
                                    } else {
                                        await new Promise((resolve)=>db.run(
                                            `INSERT INTO lane_tap_queue (tap_id, ship_id, cu, enqueued_turn, status) VALUES (?, ?, ?, ?, 'queued')`,
                                            [nextLeg.tapId, currentTransit.ship_id, currentTransit.cu, turnNumber], ()=>resolve()));
                                        break; 
                                    }
                                } else {
                                    await new Promise((resolve)=>db.run('UPDATE lane_itineraries SET status = "consumed" WHERE id = ?', [itinRow.id], ()=>resolve()));
                                    break;
                                }
                            }
                            break;
                        } else {
                            break;
                        }
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
            // Legacy warp orders are no longer supported; clean up any lingering ones
            if (order.status === 'warp_preparing') {
                return db.run('DELETE FROM movement_orders WHERE id = ?', [order.id], () => resolve({ objectId: order.object_id, status: 'skipped_legacy_warp' }));
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

    // Legacy warp implementation removed

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

                // Skip most orders when the ship is busy moving or harvesting
                const activeMove = await new Promise((resolve) => db.get(
                    `SELECT id FROM movement_orders WHERE object_id = ? AND status IN ('active','warp_preparing') ORDER BY created_at DESC LIMIT 1`,
                    [ship.ship_id],
                    (e, r) => resolve(r)
                ));
                const harvesting = await new Promise((resolve) => db.get(
                    `SELECT id FROM harvesting_tasks WHERE ship_id = ? AND status IN ('active','paused')`,
                    [ship.ship_id],
                    (e, r) => resolve(r)
                ));
                if ((q.order_type !== 'travel_start') && (activeMove || harvesting)) continue;

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
                        const t = await new Promise((resolve)=>db.get('SELECT id, sector_id, x, y FROM sector_objects WHERE id = ?', [targetId], (e,r)=>resolve(r||null)));
                        if (!t || Number(t.sector_id) !== Number(ship.sector_id)) {
                            await new Promise((resolve)=>db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], ()=>resolve()));
                            // Cascade cancel remaining queued items
                            await new Promise((resolve)=>db.run(`UPDATE queued_orders SET status = 'cancelled' WHERE game_id = ? AND ship_id = ? AND status = 'queued' AND sequence_index > ?`, [gameId, ship.ship_id, q.sequence_index], ()=>resolve()));
                            continue;
                        }
                        if (ability && ability.range) {
                            const dx = Number(t.x) - Number(ship.x);
                            const dy = Number(t.y) - Number(ship.y);
                            const dist = Math.hypot(dx, dy);
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
                } else if (q.order_type === 'travel_start') {
                    // Attempt to start the next itinerary leg now (auto-approach was completed in prior order)
                    try {
                        const itinRow = await new Promise((resolve)=>db.get(
                            `SELECT id, created_turn, freshness_turns, itinerary_json, status FROM lane_itineraries 
                             WHERE ship_id = ? AND sector_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
                            [ship.ship_id, ship.sector_id], (er, row)=>resolve(row||null)));
                        if (!itinRow) {
                            await new Promise((resolve)=>db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], ()=>resolve()));
                            continue;
                        }
                        let itinerary = []; try { itinerary = JSON.parse(itinRow.itinerary_json||'[]'); } catch {}
                        const nextLeg = itinerary.find(L => !L.done);
                        if (!nextLeg) { await new Promise((resolve)=>db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], ()=>resolve())); continue; }
                        // If the ship is still finishing its approach movement, only proceed when close enough
                        if (activeMove) {
                            try {
                                // Compute the intended entry point (tap position or projection at sStart)
                                let entryXY = null;
                                if (String(nextLeg.entry) === 'tap' && nextLeg.tapId) {
                                    const t = await new Promise((resolve)=>db.get('SELECT x, y FROM lane_taps WHERE id = ?', [nextLeg.tapId], (e,r)=>resolve(r||null)));
                                    if (t) entryXY = { x: Number(t.x), y: Number(t.y) };
                                } else {
                                    const edgeRow = await new Promise((resolve)=>db.get('SELECT polyline_json FROM lane_edges WHERE id = ?', [nextLeg.edgeId], (e,r)=>resolve(r||null)));
                                    const pts = (()=>{ try { return JSON.parse(edgeRow?.polyline_json||'[]'); } catch { return []; } })();
                                    if (pts.length >= 2) {
                                        let total = 0; const acc=[0]; for (let i=1;i<pts.length;i++){ total+=Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y); acc.push(total); }
                                        const sTarget = Math.max(0, Math.min(total, Number(nextLeg.sStart||0)));
                                        let idx=0; while (idx<acc.length-1 && acc[idx+1] < sTarget) idx++;
                                        const segLen = Math.max(1e-6, acc[idx+1]-acc[idx]); const t=(sTarget-acc[idx])/segLen;
                                        entryXY = { x: Math.round(pts[idx].x + (pts[idx+1].x-pts[idx].x)*t), y: Math.round(pts[idx].y + (pts[idx+1].y-pts[idx].y)*t) };
                                    }
                                }
                                if (entryXY) {
                                    const dx = Number(ship.x) - Number(entryXY.x);
                                    const dy = Number(ship.y) - Number(entryXY.y);
                                    const far = Math.hypot(dx, dy) > 2;
                                    if (far) {
                                        // Defer until next turn; leave queued
                                        continue;
                                    }
                                }
                            } catch {}
                        }
                        if (nextLeg.entry === 'tap' && nextLeg.tapId) {
                            await new Promise((resolve)=>db.run(
                                `INSERT INTO lane_tap_queue (tap_id, ship_id, cu, enqueued_turn, status) VALUES (?, ?, ?, ?, 'queued')`,
                                [nextLeg.tapId, ship.ship_id, 1, upcomingTurn], ()=>resolve()));
                            await new Promise((resolve)=>db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['consumed', q.id], ()=>resolve()));
                        } else if (nextLeg.entry === 'tap' && !nextLeg.tapId) {
                            // Fallback: choose nearest tap to sStart along the edge
                            try {
                                const edgeRow = await new Promise((resolve)=>db.get('SELECT polyline_json FROM lane_edges WHERE id = ?', [nextLeg.edgeId], (er, r)=>resolve(r||null)));
                                const pts = (()=>{ try { return JSON.parse(edgeRow?.polyline_json||'[]'); } catch { return []; } })();
                                let total = 1; if (pts.length>1) { let d=0; for(let i=1;i<pts.length;i++){ d+=Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y); } total = Math.max(1, d); }
                                const targetS = Math.max(0, Number(nextLeg.sStart||0));
                                const taps = await new Promise((resolve)=>db.all('SELECT id, x, y FROM lane_taps WHERE edge_id = ?', [nextLeg.edgeId], (e, rows)=>resolve(rows||[])));
                                function projectToSegment(p,a,b){ const apx=p.x-a.x, apy=p.y-a.y; const abx=b.x-a.x, aby=b.y-a.y; const ab2=Math.max(1e-6,abx*abx+aby*aby); const t=Math.max(0, Math.min(1, (apx*abx+apy*aby)/ab2)); return { x:a.x+abx*t, y:a.y+aby*t, t }; }
                                function projectToPolyline(p, pts){ let best={d:Infinity, i:0, t:0, point:pts[0]}; for(let i=1;i<pts.length;i++){ const pr=projectToSegment(p, pts[i-1], pts[i]); const d=Math.hypot(p.x-pr.x, p.y-pr.y); if(d<best.d){ best={ d, i:i-1, t:pr.t, point:{x:pr.x,y:pr.y} }; } } return best; }
                                function sAt(proj, acc){ return acc[proj.i] + proj.t * (acc[proj.i+1]-acc[proj.i]); }
                                const acc = (()=>{ let d=0; const a=[0]; for(let i=1;i<pts.length;i++){ d+=Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y); a.push(d);} return a; })();
                                let bestTap = null;
                                for (const t of taps) {
                                    const pr = projectToPolyline({x:t.x,y:t.y}, pts);
                                    const s = sAt(pr, acc);
                                    const diff = Math.abs(s - targetS);
                                    if (!bestTap || diff < bestTap.diff) bestTap = { id: t.id, diff };
                                }
                                if (bestTap && bestTap.id) {
                                    // Persist chosen tapId on itinerary for consistency
                                    nextLeg.tapId = bestTap.id;
                                    await new Promise((resolve)=>db.run('UPDATE lane_itineraries SET itinerary_json = ? WHERE id = ?', [JSON.stringify(itinerary), itinRow.id], ()=>resolve()));
                                    await new Promise((resolve)=>db.run(
                                        `INSERT INTO lane_tap_queue (tap_id, ship_id, cu, enqueued_turn, status) VALUES (?, ?, ?, ?, 'queued')`,
                                        [bestTap.id, ship.ship_id, 1, upcomingTurn], ()=>resolve()));
                                    await new Promise((resolve)=>db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['consumed', q.id], ()=>resolve()));
                                } else {
                                    await new Promise((resolve)=>db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], ()=>resolve()));
                                }
                            } catch {
                                await new Promise((resolve)=>db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], ()=>resolve()));
                            }
                        } else if (nextLeg.entry === 'wildcat') {
                            // Shoulder merge transit for next edge using target window
                            const edgeRow2 = await new Promise((resolve)=>db.get('SELECT polyline_json FROM lane_edges WHERE id = ?', [nextLeg.edgeId], (er, r)=>resolve(r||null)));
                            const pts2 = (()=>{ try { return JSON.parse(edgeRow2?.polyline_json||'[]'); } catch { return []; } })();
                            let total2 = 1; if (pts2.length>1) { let d2=0; for(let i=1;i<pts2.length;i++){ d2+=Math.hypot(pts2[i].x-pts2[i-1].x, pts2[i].y-pts2[i-1].y); } total2 = Math.max(1, d2); }
                            const targetStartP2 = Math.max(0, Math.min(1, Number(nextLeg.sStart||0) / total2));
                            const targetEndP2 = Math.max(0, Math.min(1, Number(nextLeg.sEnd||total2) / total2));
                            await new Promise((resolve)=>db.run(
                                `INSERT INTO lane_transits (edge_id, ship_id, direction, progress, cu, mode, merge_turns, entered_turn, meta)
                                 VALUES (?, ?, 1, ?, ?, 'shoulder', ?, ?, ?)`,
                                [nextLeg.edgeId, ship.ship_id, targetStartP2, 1, Math.max(1, Number(nextLeg.mergeTurns || 1)), Number(upcomingTurn), JSON.stringify({ targetStartP: targetStartP2, targetEndP: targetEndP2 })], ()=>resolve()));
                            await new Promise((resolve)=>db.run(`UPDATE lane_edges_runtime SET load_cu = load_cu + ? WHERE edge_id = ?`, [1, nextLeg.edgeId], ()=>resolve()));
                            await new Promise((resolve)=>db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['consumed', q.id], ()=>resolve()));
                        } else {
                            await new Promise((resolve)=>db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], ()=>resolve()));
                        }
                    } catch {
                        await new Promise((resolve)=>db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], ()=>resolve()));
                    }
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




