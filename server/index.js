const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const db = require('./db');
const { loadConfig } = require('./config');
const requestContext = require('./middleware/request-context');
const { errorMiddleware } = require('./middleware/error');
const logger = require('./utils/logger');
const { Abilities } = require('./services/registry/abilities');
const CombatConfig = require('./services/game/combat-config');
const { CargoManager } = require('./services/game/cargo-manager');
const { computeAllRequirements } = require('./services/registry/blueprints');
const authRoutes = require('./routes/auth');
const lobbyRoutes = require('./routes/lobby');
const { router: gameRoutes } = require('./routes/game');
const stateRoutes = require('./routes/state.routes');
const buildRoutes = require('./routes/build.routes');
const cargoRoutes = require('./routes/cargo.routes');
const galaxyRoutes = require('./routes/galaxy.routes');
const movementRoutes = require('./routes/movement.routes');
const playersRoutes = require('./routes/players.routes');

// (moved) queued orders policy lives in sockets/game.channel.js

// Utility: moved to server/utils/path.js
const { computePathBresenham } = require('./utils/path');

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const CONFIG = loadConfig();
// Verbose server turn/movement logs (enable with env LOG_TURNS=1)
const TURN_LOGS = String(process.env.LOG_TURNS || '').toLowerCase() === '1';
const PORT = CONFIG.port;

// Middleware
if (CONFIG.enableCors) {
    app.use(cors());
}
app.use(bodyParser.json());
app.use(requestContext());
// Serve built React app first (takes precedence over legacy client)
app.use(express.static(CONFIG.staticWebDir));
app.use(express.static(CONFIG.staticClientDir));

// Routes
app.use('/auth', authRoutes);
app.use('/lobby', lobbyRoutes);
app.use('/game', stateRoutes);
app.use('/game', buildRoutes);
app.use('/game', cargoRoutes);
app.use('/game', galaxyRoutes);
app.use('/game', movementRoutes);
app.use('/game', playersRoutes);
app.use('/game', gameRoutes);
// Sector trails: always-visible movement history (last N turns)
// Ability cooldowns endpoint
app.get('/game/ability-cooldowns/:shipId', async (req, res) => {
    const { shipId } = req.params;
    try {
        const rows = await new Promise((resolve, reject) => {
            db.all('SELECT ability_key, available_turn FROM ability_cooldowns WHERE ship_id = ?', [shipId], (e, r) => e ? reject(e) : resolve(r || []));
        });
        res.json({ shipId: Number(shipId), cooldowns: rows });
    } catch (e) {
        console.error('ability-cooldowns error:', e);
        res.status(500).json({ error: 'server_error' });
    }
});
app.get('/game/sector/:sectorId/trails', async (req, res) => {
    const { sectorId } = req.params;
    const { sinceTurn, maxAge = 10 } = req.query;
    try {
        const { MovementService } = require('./services/game/movement.service');
        const svc = new MovementService();
        const result = await svc.getSectorTrails({ sectorId, sinceTurn, maxAge });
        if (!result.success) return res.status(result.httpStatus || 400).json({ error: result.error });
        res.json({ turn: result.turn, maxAge: result.maxAge, segments: result.segments });
    } catch (e) {
        console.error('trails endpoint error:', e);
        res.status(500).json({ error: 'server_error' });
    }
});
    // Combat logs read API (simple fetch)
    app.get('/combat/logs/:gameId/:turnNumber', (req, res) => {
        const { gameId, turnNumber } = req.params;
        db.all(
            'SELECT * FROM combat_logs WHERE game_id = ? AND turn_number = ? ORDER BY id ASC',
            [gameId, turnNumber],
            (err, rows) => {
                if (err) return res.status(500).json({ error: 'db_error' });
                res.json({ logs: rows || [] });
            }
        );
    });

// Serve React landing at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../web/dist/index.html'));
});

// Legacy play route -> existing menu/login flow
app.get('/play', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA catch‑all fallback (after API + static + explicit routes)
app.get('*', (req, res) => {
    res.sendFile(path.join(CONFIG.staticWebDir, 'index.html'));
});

// Error handler must be last among middleware
app.use(errorMiddleware);

// Background scheduler: auto-advance turns for active games with auto_turn_minutes set
// Start TurnScheduler
const { EventBus, EVENTS } = require('./services/bus/event-bus');
const { TurnScheduler } = require('./services/scheduler/turn-scheduler');
const { createTurnResolver } = require('./services/game/turn-resolution.service');
const eventBus = new EventBus();
const resolveTurn = createTurnResolver({ db, io, eventBus, EVENTS });
const scheduler = new TurnScheduler({ db, eventBus, resolveTurn });
scheduler.start();

// Register sockets via channel module (handlers live in sockets/game.channel.js)
const { registerGameChannel } = require('./sockets/game.channel');
io.removeAllListeners('connection');
registerGameChannel({ io, db, resolveTurn });

// Helper function to get current turn number
async function getCurrentTurnNumber(gameId) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1',
            [gameId],
            (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row ? row.turn_number : 1);
                }
            }
        );
    });
}

// sendGameStatusUpdate and checkTurnResolution moved to sockets/game.channel.js

// Resolve a turn (process all moves, combat, etc.)
// ✅ ATOMIC TURN RESOLUTION POLICY:
// - No real-time updates during resolution
// - All changes happen server-side first
// - Clients receive final results via 'turn-resolved' + loadGameState()
// resolveTurn moved to services/game/turn-resolution.service.js

// Process all movement orders for a turn with collision detection
async function processMovementOrders(gameId, turnNumber) {
    return new Promise((resolve, reject) => {
        // Get all active movement AND warp orders for this game (only the most recent per ship)
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
                
                // Clean up any duplicate movement orders (keep only the most recent per ship)
                db.run(
                    `DELETE FROM movement_orders 
                     WHERE status = 'active' 
                     AND created_at NOT IN (
                         SELECT MAX(created_at) 
                         FROM movement_orders mo2 
                         WHERE mo2.object_id = movement_orders.object_id 
                         AND mo2.status = 'active'
                     )`,
                    (err) => {
                        if (err) {
                            console.error('Error cleaning duplicate movement orders:', err);
                        } else if (this.changes > 0) {
                            console.log(`🧹 Cleaned up ${this.changes} duplicate movement orders`);
                        }
                    }
                );
                
                const movementResults = [];
                
                // Process each movement order
                for (const order of orders) {
                    try {
                        const result = await processSingleMovement(order, turnNumber, gameId);
                        movementResults.push(result);
                    } catch (error) {
                        console.error(`Error processing movement for object ${order.object_id}:`, error);
                        movementResults.push({
                            objectId: order.object_id,
                            status: 'error',
                            error: error.message
                        });
                    }
                }
                
                console.log(`📝 Movement processing complete: ${movementResults.length} orders processed`);
                resolve(movementResults);
            }
        );
    });
}

// Process a single ship's movement or warp with collision detection
async function processSingleMovement(order, turnNumber, gameId) {
    return new Promise(async (resolve, reject) => {
        // Handle warp orders separately
        if (order.status === 'warp_preparing') {
            // Legacy warp removed: drop lingering orders
            return db.run('DELETE FROM movement_orders WHERE id = ?', [order.id], () => resolve({ objectId: order.object_id, status: 'skipped_legacy_warp' }));
        }
        
        const movementPath = JSON.parse(order.movement_path || '[]');
        const currentStep = order.current_step || 0;
        const baseSpeed = order.movement_speed || 1;
        const meta = JSON.parse(order.meta || '{}');
        // Apply engine boost effect if present
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
        console.log(`🧭 Movement calc: ship=${order.object_id} base=${baseSpeed} mult=${speedMultiplier.toFixed(2)} eff=${movementSpeed} turn=${turnNumber}`);
        
        // Calculate how many steps to take this turn
        const stepsToTake = Math.min(movementSpeed, movementPath.length - 1 - currentStep);
        
        if (stepsToTake <= 0) {
            // Movement already complete
            db.run(
                'UPDATE movement_orders SET status = ? WHERE id = ?',
                ['completed', order.id],
                () => resolve({ objectId: order.object_id, status: 'completed' })
            );
            return;
        }
        
        const newStep = currentStep + stepsToTake;
        const targetTile = movementPath[newStep];
        
        if (!targetTile) {
            return reject(new Error('Invalid movement path'));
        }
        
        // Check for collision at target position
        db.get(
            'SELECT id, type, owner_id, meta FROM sector_objects WHERE sector_id = ? AND x = ? AND y = ? AND id != ?',
            [order.sector_id, targetTile.x, targetTile.y, order.object_id],
            (err, collision) => {
                if (err) return reject(err);
                
                if (collision) {
                    // Collision detected - stop movement
                    console.log(`🚧 Movement blocked: Ship ${order.object_id} blocked by ${collision.type} ${collision.id} at (${targetTile.x}, ${targetTile.y})`);
                    
                    const blockingInfo = {
                        blockingObjectId: collision.id,
                        blockingType: collision.type,
                        blockingOwner: collision.owner_id,
                        blockedAt: targetTile,
                        turn: turnNumber
                    };
                    
                    // Update movement order as blocked
                    db.run(
                        'UPDATE movement_orders SET status = ?, blocked_by = ? WHERE id = ?',
                        ['blocked', JSON.stringify(blockingInfo), order.id],
                        () => {
                                                                const result = {
                                        objectId: order.object_id,
                                        status: 'blocked',
                                        blockingInfo,
                                        finalPosition: { x: order.current_x, y: order.current_y }
                                    };
                                    
                                    // ✅ No real-time updates - clients will see results after turn resolves
                                    console.log(`🚫 Ship ${order.object_id} movement blocked at (${order.current_x}, ${order.current_y})`);
                                    
                                    resolve(result);
                        }
                    );
                } else {
                    // No collision - move ship
                    db.run(
                        'UPDATE sector_objects SET x = ?, y = ?, updated_at = ? WHERE id = ?',
                        [targetTile.x, targetTile.y, new Date().toISOString(), order.object_id],
                        (err) => {
                            if (err) return reject(err);
                            
                            // PHASE 1B: Record actual movement segment in history
                            // Get current position from movement path
                            const fromTile = movementPath[currentStep];
                            if (fromTile) {
                                db.run(
                                    `INSERT INTO movement_history 
                                     (object_id, game_id, turn_number, from_x, from_y, to_x, to_y, movement_speed) 
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                                    [
                                        order.object_id, 
                                        gameId, 
                                        turnNumber, 
                                        fromTile.x, 
                                        fromTile.y, 
                                        targetTile.x, 
                                        targetTile.y, 
                                        movementSpeed
                                    ],
                                    (historyErr) => {
                                        if (historyErr) {
                                            console.error(`❌ Failed to record movement history for ship ${order.object_id}:`, historyErr);
                                        } else {
                                            console.log(`📜 Recorded movement history: Ship ${order.object_id} from (${fromTile.x},${fromTile.y}) to (${targetTile.x},${targetTile.y}) on turn ${turnNumber}`);
                                        }
                                    }
                                );
                            } else {
                                console.error(`❌ Could not get current position for ship ${order.object_id} movement history - currentStep: ${currentStep}, pathLength: ${movementPath.length}`);
                            }
                            
                            // Update movement order progress
                            const isComplete = newStep >= movementPath.length - 1;
                            const newStatus = isComplete ? 'completed' : 'active';
                            
                            // STAGE A FIX: Calculate remaining ETA after movement
                            const remainingSteps = movementPath.length - 1 - newStep;
                            const newETA = Math.ceil(remainingSteps / movementSpeed);
                            console.log(`📐 ETA recompute: total=${movementPath.length - 1} currentStep=${newStep} remaining=${remainingSteps} speed=${movementSpeed} eta=${newETA}`);
                            
                            db.run(
                                'UPDATE movement_orders SET current_step = ?, status = ?, eta_turns = ? WHERE id = ?',
                                [newStep, newStatus, newETA, order.id],
                                () => {
                                    console.log(`🚢 Ship ${order.object_id} moved to (${targetTile.x}, ${targetTile.y}) - Step ${newStep}/${movementPath.length-1} - ETA: ${newETA}T`);
                                    
                                    const result = {
                                        objectId: order.object_id,
                                        status: newStatus,
                                        newPosition: targetTile,
                                        currentStep: newStep,
                                        totalSteps: movementPath.length - 1,
                                        eta: newETA
                                    };
                                    
                                    // ✅ No real-time updates - clients will see all results after turn resolves
                                    if (newStatus === 'completed') {
                                        console.log(`✅ Ship ${order.object_id} completed movement to (${targetTile.x}, ${targetTile.y})`);
                                    } else {
                                        console.log(`➡️ Ship ${order.object_id} continuing movement - step ${newStep}/${movementPath.length-1} - ETA: ${newETA}T`);
                                    }
                                    
                                    resolve(result);
                                }
                            );
                        }
                    );
                }
            }
        );
    });
}

// Legacy warp removed

// Materialize one queued order per idle ship for the upcoming turn
async function materializeQueuedOrders(gameId, upcomingTurn) {
    // Find ships in this game that are not currently moving/warping or harvesting
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
            // Skip if ship has active movement/warp
            const activeMove = await new Promise((resolve) => db.get(
                `SELECT id FROM movement_orders WHERE object_id = ? AND status IN ('active','warp_preparing') ORDER BY created_at DESC LIMIT 1`,
                [ship.ship_id],
                (e, r) => resolve(r)
            ));
            if (activeMove) continue;

            // Skip if ship is harvesting
            const harvesting = await new Promise((resolve) => db.get(
                `SELECT id FROM harvesting_tasks WHERE ship_id = ? AND status IN ('active','paused')`,
                [ship.ship_id],
                (e, r) => resolve(r)
            ));
            if (harvesting) continue;

            // Get the next queued order for this ship
            const q = await new Promise((resolve) => db.get(
                `SELECT * FROM queued_orders 
                 WHERE game_id = ? AND ship_id = ? AND status = 'queued'
                 AND (not_before_turn IS NULL OR not_before_turn <= ?)
                 ORDER BY sequence_index ASC, id ASC LIMIT 1`,
                [gameId, ship.ship_id, upcomingTurn],
                (e, r) => resolve(r)
            ));
            if (!q) continue;

            // Parse payload
            let payload = {};
            try { payload = q.payload ? JSON.parse(q.payload) : {}; } catch {}

            if (q.order_type === 'move') {
                // Compute path from current to destination
                const dest = payload?.destination || payload; // support {destination:{x,y}} or {x,y}
                if (!dest || typeof dest.x !== 'number' || typeof dest.y !== 'number') {
                    await new Promise((resolve) => db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], () => resolve()));
                    continue;
                }
                const movementPath = computePathBresenham(ship.x, ship.y, dest.x, dest.y);
                if (movementPath.length <= 1) {
                    await new Promise((resolve) => db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], () => resolve()));
                    continue;
                }
                // Fetch movement speed from ship meta
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
                // Insert warp_preparing order
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
                // Try to start harvesting; if not adjacent, skip in v1
                const currentTurn = upcomingTurn;
                const result = await HarvestingManager.startHarvesting(ship.ship_id, nodeId, currentTurn);
                if (result?.success) {
                    await new Promise((resolve) => db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['consumed', q.id], () => resolve()));
                } else {
                    await new Promise((resolve) => db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], () => resolve()));
                }
            } else if (q.order_type === 'harvest_stop') {
                await HarvestingManager.stopHarvesting(ship.ship_id).catch(() => {});
                await new Promise((resolve) => db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['consumed', q.id], () => resolve()));
            } else if (q.order_type === 'ability') {
                // Ability queued into a future turn; materialize into ability_orders when preconditions are acceptable
                const { abilityKey, targetObjectId, target, params } = payload || {};
                if (!abilityKey) {
                    await new Promise((resolve) => db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], () => resolve()));
                    continue;
                }
                // Optional object target check and range gate (soft): if target exists and is in same sector and (if ability has range) in range
                const ability = Abilities[abilityKey];
                let inRange = true;
                let targetId = (typeof targetObjectId === 'number') ? Number(targetObjectId) : null;
                if (targetId) {
                    const t = await new Promise((resolve)=>db.get('SELECT id, sector_id, x, y FROM sector_objects WHERE id = ?', [targetId], (e,r)=>resolve(r||null)));
                    if (!t || Number(t.sector_id) !== Number(ship.sector_id)) {
                        // Target missing or wrong sector → skip and cascade cancel future items that depend on this anchor
                        await new Promise((resolve)=>db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['skipped', q.id], ()=>resolve()));
                        // Cascade cancel: all later queued items for this ship
                        await new Promise((resolve)=>db.run(`UPDATE queued_orders SET status = 'cancelled' WHERE game_id = ? AND ship_id = ? AND status = 'queued' AND sequence_index > ?`, [gameId, ship.ship_id, q.sequence_index], ()=>resolve()));
                        continue;
                    }
                    if (ability && ability.range) {
                        const dx = Number(t.x) - Number(ship.x);
                        const dy = Number(t.y) - Number(ship.y);
                        const dist = Math.hypot(dx, dy);
                        inRange = dist <= Number(ability.range);
                    }
                }
                // If not in range and no auto-move logic yet, defer: leave as queued for next turn
                if (!inRange) {
                    // Optionally we could enqueue a move precursor here in the future
                    continue;
                }
                // Insert ability order for upcoming turn
                await new Promise((resolve, reject) => db.run(
                    `INSERT INTO ability_orders (game_id, turn_number, caster_id, ability_key, target_object_id, target_x, target_y, params, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [gameId, upcomingTurn, ship.ship_id, String(abilityKey), targetId || null, (target && typeof target.x==='number')?Number(target.x):null, (target && typeof target.y==='number')?Number(target.y):null, params?JSON.stringify(params):null, new Date().toISOString()],
                    (err)=> err ? reject(err) : resolve()
                ));
                await new Promise((resolve)=>db.run('UPDATE queued_orders SET status = ? WHERE id = ?', ['consumed', q.id], ()=>resolve()));
            }
        } catch (e) {
            // Non-fatal per ship
            console.warn('materializeQueuedOrders error for ship', ship.ship_id, e?.message || e);
        }
    }
}

// STAGE 3 OPTIMIZATION: Parallel processing for all players visibility updates
async function updateAllPlayersVisibility(gameId, turnNumber) {
    return new Promise((resolve, reject) => {
        // Get all players in the game
        db.all(
            'SELECT DISTINCT user_id FROM game_players WHERE game_id = ?',
            [gameId],
            async (err, players) => {
                if (err) return reject(err);
                
                console.log(`👁️ Updating visibility for ${players.length} players (parallel processing)`);
                const startTime = Date.now();
                
                // PARALLEL PROCESSING: Update visibility for all players simultaneously
                const visibilityPromises = players.map(player => 
                    GameWorldManager.calculatePlayerVision(gameId, player.user_id, turnNumber)
                        .catch(error => {
                            console.error(`Error updating visibility for player ${player.user_id}:`, error);
                            return null; // Don't fail entire batch for one player error
                        })
                );
                
                try {
                    // Apply survey scanner effect: double scan range while active
                    await Promise.all(visibilityPromises);
                    const endTime = Date.now();
                    console.log(`👁️ Completed visibility updates for ${players.length} players in ${endTime - startTime}ms (optimized)`);
                    resolve();
                } catch (error) {
                    console.error('Error in parallel visibility processing:', error);
                    reject(error);
                }
            }
        );
    });
}

// Clean up old completed movement orders to prevent database bloat
async function cleanupOldMovementOrders(gameId, currentTurn) {
    return new Promise((resolve, reject) => {
        // Delete movement orders that have been completed for more than 2 turns
        // This gives time for players to see the path completion before it disappears
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
            function(err) {
                if (err) {
                    console.error('Error cleaning up movement orders:', err);
                    return reject(err);
                }
                
                if (this.changes > 0) {
                    console.log(`🧹 Cleaned up ${this.changes} old movement orders for game ${gameId}`);
                }
                resolve();
            }
        );
    });
}

// Cleanup expired status effects and decay wrecks
async function cleanupExpiredEffectsAndWrecks(gameId, turnNumber) {
    // Remove expired effects
    await new Promise((resolve) => db.run('DELETE FROM ship_status_effects WHERE expires_turn IS NOT NULL AND expires_turn < ?', [turnNumber], () => resolve()));
    // Decay wrecks: any wreck whose decayTurn <= current turn becomes debris (delete or leave minimal)
    const wrecks = await new Promise((resolve) => {
        db.all(
            `SELECT so.id, so.meta FROM sector_objects so
             JOIN sectors s ON s.id = so.sector_id
             WHERE s.game_id = ? AND so.type = 'wreck'`,
            [gameId],
            (e, rows) => resolve(rows || [])
        );
    });
    for (const w of wrecks) {
        try {
            const meta = JSON.parse(w.meta || '{}');
            if (meta.decayTurn !== undefined && Number(meta.decayTurn) <= Number(turnNumber)) {
                // For now: delete wreck and its cargo
                await new Promise((resolve) => db.run('DELETE FROM object_cargo WHERE object_id = ?', [w.id], () => resolve()));
                await new Promise((resolve) => db.run('DELETE FROM sector_objects WHERE id = ?', [w.id], () => resolve()));
                await new Promise((resolve) => db.run(
                    `INSERT INTO combat_logs (game_id, turn_number, event_type, summary, data)
                     VALUES (?, ?, 'effect', ?, ?)`,
                    [gameId, turnNumber, 'Wreck decayed', JSON.stringify({ objectId: w.id })],
                    () => resolve()
                ));
            }
        } catch {}
    }

    // Remove empty, expired cargo cans
    const cans = await new Promise((resolve) => {
        db.all(
            `SELECT so.id, so.meta FROM sector_objects so
             JOIN sectors s ON s.id = so.sector_id
             WHERE s.game_id = ? AND so.type = 'cargo_can'`,
            [gameId],
            (e, rows) => resolve(rows || [])
        );
    });
    for (const c of cans) {
        try {
            const meta = JSON.parse(c.meta || '{}');
            const emptiesAt = Number(meta.emptiesAtTurn || 0);
            if (emptiesAt && emptiesAt <= Number(turnNumber)) {
                const cargo = await new Promise((resolve) => db.get('SELECT SUM(quantity) as q FROM object_cargo WHERE object_id = ?', [c.id], (e, r) => resolve(r?.q || 0)));
                if (!cargo || Number(cargo) === 0) {
                    await new Promise((resolve) => db.run('DELETE FROM sector_objects WHERE id = ?', [c.id], () => resolve()));
                    await new Promise((resolve) => db.run(
                        `INSERT INTO combat_logs (game_id, turn_number, event_type, summary, data)
                         VALUES (?, ?, 'effect', ?, ?)`,
                        [gameId, turnNumber, 'Empty cargo can despawned', JSON.stringify({ objectId: c.id })],
                        () => resolve()
                    ));
                }
            }
        } catch {}
    }
}

// Regenerate ship energy each turn
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
                    // Apply repair-over-time
                    const effects = await new Promise((resolve) => db.all('SELECT * FROM ship_status_effects WHERE ship_id = ? AND (expires_turn IS NULL OR expires_turn >= ?)', [ship.id, turnNumber], (e, rows) => resolve(rows || [])));
                    const hasRegen = effects.some(eff => {
                        try { const d = eff.effect_data ? JSON.parse(eff.effect_data) : {}; return eff.effect_key === 'repair_over_time' && d.healPercentPerTurn; } catch { return false; }
                    });
                    if (hasRegen && typeof meta.maxHp === 'number' && typeof meta.hp === 'number') {
                        const healPct = effects.reduce((acc, eff) => {
                            try { const d = eff.effect_data ? JSON.parse(eff.effect_data) : {}; return acc + (eff.effect_key === 'repair_over_time' ? (d.healPercentPerTurn || 0) : 0); } catch { return acc; }
                        }, 0);
                        const heal = Math.max(1, Math.floor((meta.maxHp || 0) * healPct));
                        meta.hp = Math.min(meta.maxHp, meta.hp + heal);
                    }
                    // Clear expired temporary UI hints on tick
                    try {
                        if (typeof meta.scanBoostExpires === 'number' && Number(meta.scanBoostExpires) <= Number(turnNumber)) {
                            delete meta.scanRangeMultiplier;
                            delete meta.scanBoostExpires;
                        }
                        if (typeof meta.movementBoostExpires === 'number' && Number(meta.movementBoostExpires) <= Number(turnNumber)) {
                            delete meta.movementBoostMultiplier;
                            delete meta.movementBoostExpires;
                        }
                        if (typeof meta.movementFlatExpires === 'number' && Number(meta.movementFlatExpires) <= Number(turnNumber)) {
                            delete meta.movementFlatBonus;
                            delete meta.movementFlatExpires;
                        }
                        if (typeof meta.evasionExpires === 'number' && Number(meta.evasionExpires) <= Number(turnNumber)) {
                            delete meta.evasionBonus;
                            delete meta.evasionExpires;
                        }
                    } catch {}
                    // Passive: Solo Miner's Instinct (apply per-turn if alone)
                    try {
                        const abilities = Array.isArray(meta.abilities) ? meta.abilities : [];
                        if (abilities.includes('solo_miners_instinct')) {
                            const selfRow = await new Promise((resolve) => db.get('SELECT id, owner_id, sector_id, x, y FROM sector_objects WHERE id = ?', [ship.id], (e, r) => resolve(r)));
                            if (selfRow) {
                                const nearAlly = await new Promise((resolve) => db.get(
                                    'SELECT 1 FROM sector_objects WHERE sector_id = ? AND owner_id = ? AND id != ? AND ABS(x - ?) <= 5 AND ABS(y - ?) <= 5 LIMIT 1',
                                    [selfRow.sector_id, selfRow.owner_id, selfRow.id, selfRow.x, selfRow.y],
                                    (e, r) => resolve(!!r)
                                ));
                                if (!nearAlly) {
                                    // Apply temporary bonuses for this turn
                                    meta.movementFlatBonus = Math.max(meta.movementFlatBonus || 0, 1);
                                    meta.movementFlatExpires = Number(turnNumber) + 1;
                                    meta.scanRangeMultiplier = Math.max(meta.scanRangeMultiplier || 1, 1.25);
                                    meta.scanBoostExpires = Number(turnNumber) + 1;
                                    meta.evasionBonus = Math.max(meta.evasionBonus || 0, 0.10);
                                    meta.evasionExpires = Number(turnNumber) + 1;
                                }
                            }
                        }
                    } catch {}
                    await new Promise((resolve) => db.run('UPDATE sector_objects SET meta = ?, updated_at = ? WHERE id = ?', [JSON.stringify(meta), new Date().toISOString(), ship.id], () => resolve()));
                }
            }
        } catch {}
    }
}

// Process ability orders: apply status effects and set cooldowns
async function processAbilityOrders(gameId, turnNumber) {
    // Fetch latest ability order per caster
    const orders = await new Promise((resolve, reject) => {
        db.all(
            `SELECT ao.* FROM ability_orders ao
             JOIN sector_objects so ON so.id = ao.caster_id
             JOIN sectors s ON s.id = so.sector_id
             WHERE s.game_id = ? AND ao.turn_number = ?
             AND ao.created_at = (
               SELECT MAX(created_at) FROM ability_orders ao2 WHERE ao2.caster_id = ao.caster_id AND ao2.turn_number = ao.turn_number AND ao2.game_id = ao.game_id
             )`,
            [gameId, turnNumber],
            (err, rows) => err ? reject(err) : resolve(rows || [])
        );
    });

    // Partition orders: utility (non-offense) first, then offense. Ensures pre-combat reposition/buffs apply before we queue attacks.
    const utilityOrders = [];
    const offenseOrders = [];
    for (const o of orders) {
        const ab = Abilities[o.ability_key];
        if (!ab) continue;
        if (ab.type === 'offense') offenseOrders.push(o); else utilityOrders.push(o);
    }

    // Utility phase
    for (const order of utilityOrders) {
        const ability = Abilities[order.ability_key];
        if (!ability) continue;
        // Cooldown check; if on CD skip
        const cdRow = await new Promise((resolve) => db.get('SELECT available_turn FROM ability_cooldowns WHERE ship_id = ? AND ability_key = ?', [order.caster_id, order.ability_key], (e, r) => resolve(r)));
        if (cdRow && Number(cdRow.available_turn) > Number(turnNumber)) continue;

        // Basic range check if there is a target object
        let target = null;
        if (order.target_object_id) {
            target = await new Promise((resolve) => db.get('SELECT id, sector_id, x, y FROM sector_objects WHERE id = ?', [order.target_object_id], (e, r) => resolve(r)));
        }
        const caster = await new Promise((resolve) => db.get('SELECT id, sector_id, x, y FROM sector_objects WHERE id = ?', [order.caster_id], (e, r) => resolve(r)));
        if (!caster) continue;
        if (target && caster.sector_id !== target.sector_id) continue;
        if (ability.range && target) {
            const dx = (caster.x || 0) - (target.x || 0);
            const dy = (caster.y || 0) - (target.y || 0);
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist > ability.range) continue;
        }

        // Energy check and consume for active/offense abilities
        if (ability.type !== 'passive' && ability.energyCost) {
            const casterMetaRow = await new Promise((resolve) => db.get('SELECT meta FROM sector_objects WHERE id = ?', [order.caster_id], (e, r) => resolve(r)));
            if (!casterMetaRow) continue;
            const metaObj = JSON.parse(casterMetaRow.meta || '{}');
            const currentEnergy = Number(metaObj.energy || 0);
            if (currentEnergy < ability.energyCost) {
                await new Promise((resolve) => db.run(
                    `INSERT INTO combat_logs (game_id, turn_number, attacker_id, event_type, summary, data)
                     VALUES (?, ?, ?, 'ability', ?, ?)`,
                    [gameId, turnNumber, order.caster_id, `Not enough energy for ${order.ability_key}`, JSON.stringify({ needed: ability.energyCost, have: currentEnergy })],
                    () => resolve()
                ));
                continue;
            }
            const cap = (typeof metaObj.maxEnergy === 'number') ? Number(metaObj.maxEnergy) : undefined;
            const post = Math.max(0, currentEnergy - ability.energyCost);
            metaObj.energy = cap != null ? Math.min(cap, post) : post;
            await new Promise((resolve) => db.run('UPDATE sector_objects SET meta = ?, updated_at = ? WHERE id = ?', [JSON.stringify(metaObj), new Date().toISOString(), order.caster_id], () => resolve()));
        }

        if (ability.type === 'offense') {
            // Enqueue combat order and set cooldown; skip status effects
            await new Promise((resolve) => db.run('DELETE FROM combat_orders WHERE attacker_id = ? AND game_id = ? AND turn_number = ?', [order.caster_id, gameId, turnNumber], () => resolve()));
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO combat_orders (game_id, turn_number, attacker_id, target_id, weapon_key, desired_range, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [gameId, turnNumber, order.caster_id, order.target_object_id, order.ability_key, null, new Date().toISOString()],
                    (err) => err ? reject(err) : resolve()
                );
            });
            const availableTurn = Number(turnNumber) + (ability.cooldown || 1);
            await new Promise((resolve) => db.run(
                `INSERT INTO ability_cooldowns (ship_id, ability_key, available_turn) VALUES (?, ?, ?)
                 ON CONFLICT(ship_id, ability_key) DO UPDATE SET available_turn = excluded.available_turn`,
                [order.caster_id, order.ability_key, availableTurn],
                () => resolve()
            ));
            await new Promise((resolve) => db.run(
                `INSERT INTO combat_logs (game_id, turn_number, attacker_id, target_id, event_type, summary, data)
                 VALUES (?, ?, ?, ?, 'attack', ?, ?)`,
                [gameId, turnNumber, order.caster_id, order.target_object_id, `${order.ability_key} queued`, JSON.stringify({ weaponKey: order.ability_key })],
                () => resolve()
            ));
        } else {
            // Special-case ability handling (non-offense)
            if (order.ability_key === 'strike_vector') {
                // Instant micro-warp reposition up to ability.range tiles, if not tractored/rooted, landing on a free tile
                const casterFull = await new Promise((resolve) => db.get('SELECT id, sector_id, x, y FROM sector_objects WHERE id = ?', [order.caster_id], (e, r) => resolve(r)));
                if (!casterFull) continue;
                const range = ability.range || 3;
                const tx = Math.round(order.target_x || 0);
                const ty = Math.round(order.target_y || 0);
                const dx = (casterFull.x || 0) - tx;
                const dy = (casterFull.y || 0) - ty;
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist > range) {
                    // Out of range → skip
                    await new Promise((resolve) => db.run(
                        `INSERT INTO combat_logs (game_id, turn_number, attacker_id, event_type, summary, data)
                         VALUES (?, ?, ?, 'ability', ?, ?)`,
                        [gameId, turnNumber, order.caster_id, 'Strike Vector failed: out of range', JSON.stringify({ range, dist, from: { x: casterFull.x, y: casterFull.y }, to: { x: tx, y: ty } })],
                        () => resolve()
                    ));
                } else {
                    // Check tractored/rooted (any effect that prevents reposition)
                    const blocked = await new Promise((resolve) => db.get(
                        `SELECT 1 FROM ship_status_effects WHERE ship_id = ? AND effect_key IN ('tractored','rooted') AND (expires_turn IS NULL OR expires_turn >= ?) LIMIT 1`,
                        [order.caster_id, turnNumber],
                        (e, r) => resolve(!!r)
                    ));
                    if (blocked) {
                        // Skip if immobilized
                        await new Promise((resolve) => db.run(
                            `INSERT INTO combat_logs (game_id, turn_number, attacker_id, event_type, summary)
                             VALUES (?, ?, ?, 'ability', ?)`,
                            [gameId, turnNumber, order.caster_id, 'Strike Vector failed: immobilized (tractored/rooted)'],
                            () => resolve()
                        ));
                    } else {
                        // Ensure landing tile is free in the same sector
                        const occupied = await new Promise((resolve) => db.get(
                            'SELECT 1 FROM sector_objects WHERE sector_id = ? AND x = ? AND y = ? LIMIT 1',
                            [casterFull.sector_id, tx, ty],
                            (e, r) => resolve(!!r)
                        ));
                        if (!occupied) {
                            await new Promise((resolve) => db.run('UPDATE sector_objects SET x = ?, y = ?, updated_at = ? WHERE id = ?', [tx, ty, new Date().toISOString(), order.caster_id], () => resolve()));
                            // Re-base any active movement order from new position to same destination
                            const move = await new Promise((resolve) => db.get(
                                `SELECT * FROM movement_orders WHERE object_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
                                [order.caster_id],
                                (e, r) => resolve(r)
                            ));
                            if (move && typeof move.destination_x === 'number' && typeof move.destination_y === 'number') {
                                const path = computePathBresenham(tx, ty, move.destination_x, move.destination_y);
                                const movementSpeed = move.movement_speed || 1;
                                const eta = Math.ceil(Math.max(0, path.length - 1) / Math.max(1, movementSpeed));
                                await new Promise((resolve) => db.run(
                                    'UPDATE movement_orders SET movement_path = ?, current_step = 0, eta_turns = ? WHERE id = ?',
                                    [JSON.stringify(path), eta, move.id],
                                    () => resolve()
                                ));
                            }
                            // Cooldown and log
                            const availableTurn = Number(turnNumber) + (ability.cooldown || 3);
                            await new Promise((resolve) => db.run(
                                `INSERT INTO ability_cooldowns (ship_id, ability_key, available_turn) VALUES (?, ?, ?)
                                 ON CONFLICT(ship_id, ability_key) DO UPDATE SET available_turn = excluded.available_turn`,
                                [order.caster_id, order.ability_key, availableTurn],
                                () => resolve()
                            ));
                            await new Promise((resolve) => db.run(
                                `INSERT INTO combat_logs (game_id, turn_number, attacker_id, event_type, summary, data)
                                 VALUES (?, ?, ?, 'ability', ?, ?)`,
                                [gameId, turnNumber, order.caster_id, `Strike Vector: repositioned to (${tx},${ty})`, JSON.stringify({ x: tx, y: ty })],
                                () => resolve()
                            ));
                            continue;
                        } else {
                            await new Promise((resolve) => db.run(
                                `INSERT INTO combat_logs (game_id, turn_number, attacker_id, event_type, summary, data)
                                 VALUES (?, ?, ?, 'ability', ?, ?)`,
                                [gameId, turnNumber, order.caster_id, 'Strike Vector failed: destination occupied', JSON.stringify({ to: { x: tx, y: ty } })],
                                () => resolve()
                            ));
                        }
                    }
                }
                // If failed (blocked/occupied/out of range), still apply cooldown
                const availableTurn = Number(turnNumber) + (ability.cooldown || 3);
                await new Promise((resolve) => db.run(
                    `INSERT INTO ability_cooldowns (ship_id, ability_key, available_turn) VALUES (?, ?, ?)
                     ON CONFLICT(ship_id, ability_key) DO UPDATE SET available_turn = excluded.available_turn`,
                    [order.caster_id, order.ability_key, availableTurn],
                    () => resolve()
                ));
                await new Promise((resolve) => db.run(
                    `INSERT INTO combat_logs (game_id, turn_number, attacker_id, event_type, summary)
                     VALUES (?, ?, ?, 'ability', ?)`,
                    [gameId, turnNumber, order.caster_id, `Strike Vector failed (blocked/occupied/out-of-range)`],
                    () => resolve()
                ));
                continue;
            }
            if (order.ability_key === 'microthruster_shift') {
                // New design: speed buff only, no reposition. +3 tiles for this turn
                const effectData = { movementFlatBonus: 3 };
                await new Promise((resolve) => db.run(
                    `INSERT INTO ship_status_effects (ship_id, effect_key, magnitude, effect_data, source_object_id, applied_turn, expires_turn)
                     VALUES (?, 'microthruster_speed', NULL, ?, ?, ?, ?)`,
                    [order.caster_id, JSON.stringify(effectData), order.caster_id, turnNumber, Number(turnNumber) + 1],
                    () => resolve()
                ));
                // Mirror to meta for immediate UI ETA calculation on client
                const casterMetaRow = await new Promise((resolve) => db.get('SELECT meta FROM sector_objects WHERE id = ?', [order.caster_id], (e, r) => resolve(r)));
                if (casterMetaRow) {
                    try {
                        const cm = JSON.parse(casterMetaRow.meta || '{}');
                        cm.movementFlatBonus = Math.max(cm.movementFlatBonus || 0, 3);
                        cm.movementFlatExpires = Number(turnNumber) + 1;
                        await new Promise((resolve) => db.run('UPDATE sector_objects SET meta = ?, updated_at = ? WHERE id = ?', [JSON.stringify(cm), new Date().toISOString(), order.caster_id], () => resolve()));
                    } catch {}
                }
                const availableTurn = Number(turnNumber) + (ability.cooldown || 5);
                await new Promise((resolve) => db.run(
                    `INSERT INTO ability_cooldowns (ship_id, ability_key, available_turn) VALUES (?, ?, ?)
                     ON CONFLICT(ship_id, ability_key) DO UPDATE SET available_turn = excluded.available_turn`,
                    [order.caster_id, order.ability_key, availableTurn],
                    () => resolve()
                ));
                await new Promise((resolve) => db.run(
                    `INSERT INTO combat_logs (game_id, turn_number, attacker_id, event_type, summary, data)
                     VALUES (?, ?, ?, 'ability', ?, ?)`,
                    [gameId, turnNumber, order.caster_id, 'Microthruster Shift: +3 movement this turn', JSON.stringify({ movementFlatBonus: 3 })],
                    () => resolve()
                ));
                continue;
            }
            if (order.ability_key === 'emergency_discharge_vent') {
                // Create a cargo can at caster position
                const casterFull = await new Promise((resolve) => db.get('SELECT id, sector_id, x, y FROM sector_objects WHERE id = ?', [order.caster_id], (e, r) => resolve(r)));
                if (casterFull) {
                    const canMeta = { name: 'Jettisoned Cargo', hp: 10, maxHp: 10, cargoCapacity: 25, alwaysKnown: true, publicAccess: true, emptiesAtTurn: Number(turnNumber) + 10 };
                    const canId = await new Promise((resolve, reject) => {
                        db.run(
                            'INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta) VALUES (?, ?, ?, ?, NULL, ?)',
                            [casterFull.sector_id, 'cargo_can', casterFull.x, casterFull.y, JSON.stringify(canMeta)],
                            function(err) { if (err) reject(err); else resolve(this.lastID); }
                        );
                    });
                    try { await CargoManager.initializeObjectCargo(canId, 25); } catch {}
                    // Move all ship cargo to can (atomic per item)
                    try {
                        const cargo = await CargoManager.getShipCargo(order.caster_id);
                        for (const item of (cargo.items || [])) {
                            const qty = Number(item.quantity || 0);
                            if (qty > 0) {
                                await CargoManager.removeResourceFromCargo(order.caster_id, item.resource_name, qty, true);
                                await CargoManager.addResourceToCargo(canId, item.resource_name, qty, false);
                            }
                        }
                    } catch (moveErr) {
                        console.warn('jettison cargo move error:', moveErr);
                    }
                    await new Promise((resolve) => db.run(
                        `INSERT INTO combat_logs (game_id, turn_number, attacker_id, event_type, summary, data)
                         VALUES (?, ?, ?, 'ability', ?, ?)`,
                        [gameId, turnNumber, order.caster_id, 'Emergency Discharge: cargo jettisoned', JSON.stringify({ canId })],
                        () => resolve()
                    ));
                }
                // Apply temporary movement and evasion buffs via status effect and mirror into meta
                const effectData = { movementFlatBonus: 3, evasionBonus: 0.5 };
                await new Promise((resolve) => db.run(
                    `INSERT INTO ship_status_effects (ship_id, effect_key, magnitude, effect_data, source_object_id, applied_turn, expires_turn)
                     VALUES (?, 'emergency_discharge_buff', NULL, ?, ?, ?, ?)`,
                    [order.caster_id, JSON.stringify(effectData), order.caster_id, turnNumber, Number(turnNumber) + 1],
                    () => resolve()
                ));
                const casterMetaRow2 = await new Promise((resolve) => db.get('SELECT meta FROM sector_objects WHERE id = ?', [order.caster_id], (e, r) => resolve(r)));
                if (casterMetaRow2) {
                    try {
                        const cm = JSON.parse(casterMetaRow2.meta || '{}');
                        cm.movementFlatBonus = Math.max(cm.movementFlatBonus || 0, 3);
                        cm.movementFlatExpires = Number(turnNumber) + 1;
                        cm.evasionBonus = Math.max(cm.evasionBonus || 0, 0.5);
                        cm.evasionExpires = Number(turnNumber) + 1;
                        await new Promise((resolve) => db.run('UPDATE sector_objects SET meta = ?, updated_at = ? WHERE id = ?', [JSON.stringify(cm), new Date().toISOString(), order.caster_id], () => resolve()));
                    } catch {}
                }
                const availableTurn = Number(turnNumber) + (ability.cooldown || 10);
                await new Promise((resolve) => db.run(
                    `INSERT INTO ability_cooldowns (ship_id, ability_key, available_turn) VALUES (?, ?, ?)
                     ON CONFLICT(ship_id, ability_key) DO UPDATE SET available_turn = excluded.available_turn`,
                    [order.caster_id, order.ability_key, availableTurn],
                    () => resolve()
                ));
                continue;
            }
            // Apply status effects (if defined) and set cooldown
            let effectTargetId = order.target_object_id || order.caster_id;
            let magnitude = ability.penaltyReduction || ability.selfPenaltyReduction || ability.damageReduction || ability.ignoreSizePenalty ? 1 : null;
            const effectData = {};
            if (ability.penaltyReduction) effectData.penaltyReduction = ability.penaltyReduction;
            if (ability.selfPenaltyReduction) effectData.selfPenaltyReduction = ability.selfPenaltyReduction;
            if (ability.ignoreSizePenalty) effectData.ignoreSizePenalty = true;
            if (ability.damageReduction) effectData.damageReduction = ability.damageReduction;
            if (ability.auraRange) effectData.auraRange = ability.auraRange;
            if (ability.movementBonus) effectData.movementBonus = ability.movementBonus;
            if (ability.healPercentPerTurn) effectData.healPercentPerTurn = ability.healPercentPerTurn;
            if (ability.scanRangeMultiplier) effectData.scanRangeMultiplier = ability.scanRangeMultiplier;

            if (ability.effectKey) {
                await new Promise((resolve) => db.run(
                    `INSERT INTO ship_status_effects (ship_id, effect_key, magnitude, effect_data, source_object_id, applied_turn, expires_turn)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [effectTargetId, ability.effectKey, magnitude, JSON.stringify(effectData), order.caster_id, turnNumber, turnNumber + (ability.duration || 1)],
                    () => resolve()
                ));

                // Mirror temporary UI hints into meta for same-turn visibility/UI
                if (effectTargetId === order.caster_id) {
                    const casterMetaRow = await new Promise((resolve) => db.get('SELECT meta FROM sector_objects WHERE id = ?', [order.caster_id], (e, r) => resolve(r)));
                    if (casterMetaRow) {
                        try {
                            const cm = JSON.parse(casterMetaRow.meta || '{}');
                            if (ability.scanRangeMultiplier) {
                                cm.scanRangeMultiplier = ability.scanRangeMultiplier;
                                cm.scanBoostExpires = Number(turnNumber) + (ability.duration || 1);
                            }
                            if (ability.movementBonus) {
                                cm.movementBoostMultiplier = 1 + ability.movementBonus; // e.g., 2.0 for +100%
                                cm.movementBoostExpires = Number(turnNumber) + (ability.duration || 1);
                            }
                            if (ability.evasionBonus) {
                                cm.evasionBonus = Math.max(cm.evasionBonus || 0, ability.evasionBonus);
                                cm.evasionExpires = Number(turnNumber) + (ability.duration || 1);
                            }
                            await new Promise((resolve) => db.run('UPDATE sector_objects SET meta = ?, updated_at = ? WHERE id = ?', [JSON.stringify(cm), new Date().toISOString(), order.caster_id], () => resolve()));
                        } catch {}
                    }
                }
            }
            const availableTurn = Number(turnNumber) + (ability.cooldown || 1);
            await new Promise((resolve) => db.run(
                `INSERT INTO ability_cooldowns (ship_id, ability_key, available_turn) VALUES (?, ?, ?)
                 ON CONFLICT(ship_id, ability_key) DO UPDATE SET available_turn = excluded.available_turn`,
                [order.caster_id, order.ability_key, availableTurn],
                () => resolve()
            ));
            await new Promise((resolve) => db.run(
                `INSERT INTO combat_logs (game_id, turn_number, attacker_id, target_id, event_type, summary, data)
                 VALUES (?, ?, ?, ?, 'ability', ?, ?)`,
                [gameId, turnNumber, order.caster_id, effectTargetId, `${order.ability_key} applied`, JSON.stringify({ abilityKey: order.ability_key })],
                () => resolve()
            ));
        }
    }

    // Offense phase
    for (const order of offenseOrders) {
        const ability = Abilities[order.ability_key];
        if (!ability) continue;
        // Cooldown check; if on CD skip
        const cdRow = await new Promise((resolve) => db.get('SELECT available_turn FROM ability_cooldowns WHERE ship_id = ? AND ability_key = ?', [order.caster_id, order.ability_key], (e, r) => resolve(r)));
        if (cdRow && Number(cdRow.available_turn) > Number(turnNumber)) continue;

        // Target presence
        if (!order.target_object_id) continue;
        const target = await new Promise((resolve) => db.get('SELECT id, sector_id, x, y FROM sector_objects WHERE id = ?', [order.target_object_id], (e, r) => resolve(r)));
        const caster = await new Promise((resolve) => db.get('SELECT id, sector_id, x, y FROM sector_objects WHERE id = ?', [order.caster_id], (e, r) => resolve(r)));
        if (!caster || !target) continue;
        if (caster.sector_id !== target.sector_id) continue;
        if (ability.range) {
            const dx = (caster.x || 0) - (target.x || 0);
            const dy = (caster.y || 0) - (target.y || 0);
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist > ability.range) continue;
        }
        // Enqueue combat order and set cooldown
        await new Promise((resolve) => db.run('DELETE FROM combat_orders WHERE attacker_id = ? AND game_id = ? AND turn_number = ?', [order.caster_id, gameId, turnNumber], () => resolve()));
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO combat_orders (game_id, turn_number, attacker_id, target_id, weapon_key, desired_range, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [gameId, turnNumber, order.caster_id, order.target_object_id, order.ability_key, null, new Date().toISOString()],
                (err) => err ? reject(err) : resolve()
            );
        });
        const availableTurn = Number(turnNumber) + (ability.cooldown || 1);
        await new Promise((resolve) => db.run(
            `INSERT INTO ability_cooldowns (ship_id, ability_key, available_turn) VALUES (?, ?, ?)
             ON CONFLICT(ship_id, ability_key) DO UPDATE SET available_turn = excluded.available_turn`,
            [order.caster_id, order.ability_key, availableTurn],
            () => resolve()
        ));
        await new Promise((resolve) => db.run(
            `INSERT INTO combat_logs (game_id, turn_number, attacker_id, target_id, event_type, summary, data)
             VALUES (?, ?, ?, ?, 'attack', ?, ?)`,
            [gameId, turnNumber, order.caster_id, order.target_object_id, `${order.ability_key} queued`, JSON.stringify({ weaponKey: order.ability_key })],
            () => resolve()
        ));
    }
}

// Process combat orders: compute damage using range falloff then size penalty adjusted by status effects
async function processCombatOrders(gameId, turnNumber) {
    const orders = await new Promise((resolve, reject) => {
        db.all(
            `SELECT co.* FROM combat_orders co
             JOIN sector_objects a ON a.id = co.attacker_id
             JOIN sector_objects t ON t.id = co.target_id
             JOIN sectors s ON s.id = a.sector_id
             WHERE s.game_id = ? AND co.turn_number = ?
             AND co.created_at = (
               SELECT MAX(created_at) FROM combat_orders co2 WHERE co2.attacker_id = co.attacker_id AND co2.turn_number = co.turn_number AND co2.game_id = co.game_id
             )`,
            [gameId, turnNumber],
            (err, rows) => err ? reject(err) : resolve(rows || [])
        );
    });

    for (const order of orders) {
        const attacker = await new Promise((resolve) => db.get('SELECT id, x, y, meta FROM sector_objects WHERE id = ?', [order.attacker_id], (e, r) => resolve(r)));
        const target = await new Promise((resolve) => db.get('SELECT id, x, y, meta FROM sector_objects WHERE id = ?', [order.target_id], (e, r) => resolve(r)));
        if (!attacker || !target) continue;

        const aMeta = JSON.parse(attacker.meta || '{}');
        const tMeta = JSON.parse(target.meta || '{}');
        const distance = Math.hypot((attacker.x||0)-(target.x||0), (attacker.y||0)-(target.y||0));

        // Prefer offensive abilities; fallback to class weapon profiles
        const { Abilities: AB } = require('./services/registry/abilities');
        let weapon = null;
        let weaponKey = null;
        if (order.weapon_key && AB[order.weapon_key] && AB[order.weapon_key].type === 'offense') {
            weaponKey = order.weapon_key;
            weapon = AB[weaponKey];
        } else {
            // No offensive ability provided; skip firing
            await new Promise((resolve) => db.run(
                `INSERT INTO combat_logs (game_id, turn_number, attacker_id, target_id, event_type, summary)
                 VALUES (?, ?, ?, ?, 'attack', ?)`,
                [gameId, turnNumber, attacker.id, target.id, 'No offensive ability queued'],
                () => resolve()
            ));
            continue;
        }

        // Hard range enforcement (if weapon defines a range)
        if (weapon.range && distance > weapon.range) {
            await new Promise((resolve) => db.run(
                `INSERT INTO combat_logs (game_id, turn_number, attacker_id, target_id, event_type, summary, data)
                 VALUES (?, ?, ?, ?, 'attack', ?, ?)`,
                [gameId, turnNumber, attacker.id, target.id, `Target out of range for ${weaponKey}`, JSON.stringify({ weaponKey, distance, maxRange: weapon.range })],
                () => resolve()
            ));
            continue;
        }

        // Range multiplier (symmetric falloff)
        const rangeMult = CombatConfig.computeRangeMultiplier(distance, weapon.optimal || 1, weapon.falloff || 0.15);

        // Status effects: accumulate for target and attacker
        const effects = await new Promise((resolve) => db.all('SELECT * FROM ship_status_effects WHERE ship_id IN (?, ?) AND (expires_turn IS NULL OR expires_turn >= ?)', [target.id, attacker.id, turnNumber], (e, rows) => resolve(rows || [])));
        const effectCtx = { weaponTags: new Set(weapon.tags || []) };
        for (const eff of effects) {
            try {
                const data = eff.effect_data ? JSON.parse(eff.effect_data) : {};
                if (eff.ship_id === target.id) {
                    if (data.ignoreSizePenalty) effectCtx.ignoreSizePenalty = true;
                    if (typeof data.penaltyReduction === 'number') effectCtx.penaltyReduction = Math.max(effectCtx.penaltyReduction || 0, data.penaltyReduction);
                }
                if (eff.ship_id === attacker.id) {
                    if (typeof data.selfPenaltyReduction === 'number') effectCtx.penaltyReduction = Math.max(effectCtx.penaltyReduction || 0, data.selfPenaltyReduction);
                }
            } catch {}
        }

        // Size penalty (apply after we compute status effects context)
        const sizeMult = CombatConfig.computeSizePenalty(aMeta.class, tMeta.class, effectCtx);

        // Evasion: aggregate from status effects and meta, clamp [0, 0.9]
        let evasionTotal = 0;
        for (const eff of effects) {
            try {
                const data = eff.effect_data ? JSON.parse(eff.effect_data) : {};
                if (eff.ship_id === target.id && typeof data.evasionBonus === 'number') {
                    evasionTotal += data.evasionBonus;
                }
            } catch {}
        }
        if (typeof tMeta.evasionBonus === 'number') {
            evasionTotal += tMeta.evasionBonus;
        }
        evasionTotal = Math.max(0, Math.min(0.9, evasionTotal));

        // Explorer passive hook sets
        const targetAbilities = Array.isArray(tMeta.abilities) ? tMeta.abilities : [];

        // Base damage; cooldown is enforced by ability_cooldowns via processAbilityOrders
        let baseDamage = weapon.baseDamage || 0;
        // Enforce PD targeting rules: PD only effective vs small ships; vs larger, diminish hard
        const isPD = (weapon.tags || []).includes('pd');
        const targetIsSmall = (tMeta.class === 'frigate');
        if (isPD && !targetIsSmall) {
            baseDamage = Math.floor(baseDamage * 0.2); // heavily diminished vs larger
        }
        // PD fires every turn regardless (cd=1), heavy weapons respect cooldown
        // Do not use turn-modulus cadence here; ability cooldowns already gated firing
        const hitMultiplier = Math.max(0, 1 - evasionTotal);
        let damage = Math.max(0, Math.round(baseDamage * rangeMult * sizeMult * hitMultiplier));

        // Duct Tape Resilience: first hit at full HP reduced by 25%
        if (targetAbilities.includes('duct_tape_resilience') && tMeta.hp === tMeta.maxHp && !tMeta._resilienceConsumed) {
            damage = Math.floor(damage * 0.75);
            tMeta._resilienceConsumed = true;
        }

        if (damage <= 0) {
            await new Promise((resolve) => db.run(
                `INSERT INTO combat_logs (game_id, turn_number, attacker_id, target_id, event_type, summary, data)
                 VALUES (?, ?, ?, ?, 'attack', ?, ?)`,
                [gameId, turnNumber, attacker.id, target.id, `Attack with ${weaponKey} missed/ineffective`, JSON.stringify({ weaponKey, distance, rangeMult, sizeMult, evasionTotal, hitMultiplier })],
                () => resolve()
            ));
            continue;
        }

        // Apply HP change
        const targetHp = typeof tMeta.hp === 'number' ? tMeta.hp : 1;
        const newHp = targetHp - damage;
        tMeta.hp = newHp;
        await new Promise((resolve) => db.run('UPDATE sector_objects SET meta = ?, updated_at = ? WHERE id = ?', [JSON.stringify(tMeta), new Date().toISOString(), target.id], () => resolve()));

        // On-hit status application (e.g., missiles applying debuff)
        try {
            const { Abilities: AB2 } = require('./services/registry/abilities');
            const weap = AB2[weaponKey];
            if (weap && weap.onHitStatus && damage > 0) {
                const status = weap.onHitStatus;
                const effData = {};
                if (typeof status.magnitude === 'number') {
                    effData.magnitude = status.magnitude;
                }
                await new Promise((resolve) => db.run(
                    `INSERT INTO ship_status_effects (ship_id, effect_key, magnitude, effect_data, source_object_id, applied_turn, expires_turn)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [target.id, status.effectKey, status.magnitude || null, JSON.stringify(effData), attacker.id, turnNumber, Number(turnNumber) + (status.duration || 1)],
                    () => resolve()
                ));
                await new Promise((resolve) => db.run(
                    `INSERT INTO combat_logs (game_id, turn_number, attacker_id, target_id, event_type, summary, data)
                     VALUES (?, ?, ?, ?, 'status', ?, ?)`,
                    [gameId, turnNumber, attacker.id, target.id, `Applied ${status.effectKey}`, JSON.stringify({ duration: status.duration || 1, magnitude: status.magnitude })],
                    () => resolve()
                ));
            }
        } catch {}

        // Log attack
        await new Promise((resolve) => db.run(
            `INSERT INTO combat_logs (game_id, turn_number, attacker_id, target_id, event_type, summary, data)
             VALUES (?, ?, ?, ?, 'attack', ?, ?)`,
            [gameId, turnNumber, attacker.id, target.id, `Hit for ${damage}`, JSON.stringify({ weaponKey, distance, rangeMult, sizeMult, evasionTotal, hitMultiplier })],
            () => resolve()
        ));

        // Handle kill → wreck + loot
        if (newHp <= 0) {
            // Convert to wreck object (keep same position/sector)
            await new Promise((resolve) => db.run('DELETE FROM ship_status_effects WHERE ship_id = ?', [target.id], () => resolve()));
            const wreckMeta = { name: (tMeta.name || 'Wreck'), type: 'wreck', decayTurn: Number(turnNumber) + 7 };
            // Mark as wreck by updating type and meta
            await new Promise((resolve) => db.run('UPDATE sector_objects SET type = ?, meta = ?, updated_at = ? WHERE id = ?', ['wreck', JSON.stringify(wreckMeta), new Date().toISOString(), target.id], () => resolve()));
            
            // Queue dead pilots for respawn
            try {
                const pilotCost = Number(tMeta.pilotCost || 1);
                const gameIdRow = await new Promise((resolve) => db.get('SELECT game_id FROM sectors WHERE id = (SELECT sector_id FROM sector_objects WHERE id = ?)', [target.id], (e, r) => resolve(r)));
                const gameId = gameIdRow?.game_id;
                if (gameId && target.owner_id) {
                    await new Promise((resolve) => db.run(
                        'INSERT INTO dead_pilots_queue (game_id, user_id, count, respawn_turn) VALUES (?, ?, ?, ?)',
                        [gameId, target.owner_id, Math.max(1, pilotCost), Number(turnNumber) + 10],
                        () => resolve()
                    ));
                }
            } catch (e) {
                console.warn('Failed to enqueue dead pilots:', e?.message || e);
            }
            
            // Loot: move portion of ship cargo into wreck (legacy table -> object_cargo)
            try {
                const shipCargo = await CargoManager.getShipCargo(target.id);
                for (const item of shipCargo.items) {
                    const roll = 0.6 + Math.random() * 0.2; // 60–80%
                    const dropQty = Math.max(0, Math.floor(item.quantity * roll));
                    if (dropQty > 0) {
                        const resourceName = item.resource_name;
                        // Remove from ship cargo (legacy) and add to wreck cargo (object_cargo)
                        await CargoManager.removeResourceFromCargo(target.id, resourceName, dropQty, true);
                        await CargoManager.addResourceToCargo(target.id, resourceName, dropQty, false);
                    }
                }
            } catch (lootErr) {
                console.warn('Loot transfer error:', lootErr?.message || lootErr);
            }
            // Salvage: add fraction of build cost based on blueprint
            try {
                if (tMeta?.blueprintId) {
                    const blueprintId = tMeta.blueprintId;
                    // Reconstruct blueprint minimal object to compute requirements
                    const bpClass = tMeta.class;
                    const bpRole = tMeta.role;
                    const { SHIP_BLUEPRINTS } = require('./services/registry/blueprints');
                    const bp = (SHIP_BLUEPRINTS || []).find(b => b.id === blueprintId) || { id: blueprintId, class: bpClass, role: bpRole, specialized: [] };
                    const reqs = computeAllRequirements(bp);
                    const salvageMap = {};
                    // 30% of core
                    for (const [name, qty] of Object.entries(reqs.core || {})) {
                        salvageMap[name] = Math.max(1, Math.floor(qty * 0.3));
                    }
                    // 20% of specialized
                    for (const [name, qty] of Object.entries(reqs.specialized || {})) {
                        salvageMap[name] = (salvageMap[name] || 0) + Math.max(1, Math.floor(qty * 0.2));
                    }
                    for (const [resName, qty] of Object.entries(salvageMap)) {
                        await CargoManager.addResourceToCargo(target.id, resName, qty, false);
                    }
                }
            } catch (salvErr) {
                console.warn('Salvage generation error:', salvErr?.message || salvErr);
            }
            await new Promise((resolve) => db.run(
                `INSERT INTO combat_logs (game_id, turn_number, attacker_id, target_id, event_type, summary, data)
                 VALUES (?, ?, ?, ?, 'kill', ?, ?)`,
                [gameId, turnNumber, attacker.id, target.id, `Destroyed`, JSON.stringify({ weaponKey })],
                () => resolve()
            ));
        }
    }
}

// Helper function to calculate ETA for movement
function calculateETA(destX, destY, shipId) {
    // Future: Get ship position and calculate actual distance/speed
    // For now, return a simple estimate
    return 3; // 3 turns
}

// Make io available to routes
app.set('io', io);
// Register socket channel via ServerApp in future; for now, register directly

// Start server after DB is initialized
db.ready.then(() => {
    server.listen(PORT, () => {
        logger.info('server_started', { port: PORT, env: CONFIG.nodeEnv });
    });
});