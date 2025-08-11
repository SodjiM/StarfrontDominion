const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const db = require('./db');
const { Abilities } = require('./abilities');
const CombatConfig = require('./combat-config');
const { CargoManager } = require('./cargo-manager');
const { computeAllRequirements } = require('./blueprints');
const authRoutes = require('./routes/auth');
const lobbyRoutes = require('./routes/lobby');
const { router: gameRoutes, GameWorldManager } = require('./routes/game');
const { HarvestingManager } = require('./harvesting-manager');

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../client')));

// Routes
app.use('/auth', authRoutes);
app.use('/lobby', lobbyRoutes);
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
        // Determine game_id from sector
        const sector = await new Promise((resolve) => db.get('SELECT game_id FROM sectors WHERE id = ?', [sectorId], (e, r) => resolve(r)));
        if (!sector) return res.status(404).json({ error: 'sector_not_found' });
        const currentTurn = await new Promise((resolve) => db.get('SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [sector.game_id], (e, r) => resolve(r?.turn_number || 1)));
        const since = Number(sinceTurn || currentTurn);
        const minTurn = Math.max(1, since - (Number(maxAge) - 1));
        // Fetch movement history for objects in this sector within window
        const rows = await new Promise((resolve, reject) => {
            db.all(
                `SELECT mh.object_id as shipId, so.owner_id as ownerId, mh.turn_number as turn,
                        mh.from_x as fromX, mh.from_y as fromY, mh.to_x as toX, mh.to_y as toY
                 FROM movement_history mh
                 JOIN sector_objects so ON so.id = mh.object_id
                 WHERE so.sector_id = ? AND mh.game_id = ? AND mh.turn_number BETWEEN ? AND ?
                 ORDER BY mh.turn_number ASC, mh.id ASC`,
                [sectorId, sector.game_id, minTurn, since],
                (err, r) => err ? reject(err) : resolve(r || [])
            );
        });
        const segments = rows.map(r => ({
            shipId: r.shipId,
            ownerId: r.ownerId,
            turn: r.turn,
            type: 'move',
            from: { x: r.fromX, y: r.fromY },
            to: { x: r.toX, y: r.toY }
        }));
        res.json({ turn: since, maxAge: Number(maxAge), segments });
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

// Serve client files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Socket.IO connection handling - ASYNCHRONOUS FRIENDLY
io.on('connection', (socket) => {
    // Basic chat: game-wide, direct messages, and group channels
    socket.on('chat:send', (msg) => {
        // msg: { gameId, fromUserId, toUserId?, channelId?, text }
        try {
            const payload = {
                fromUserId: msg.fromUserId,
                text: String(msg.text || '').slice(0, 500),
                timestamp: new Date().toISOString(),
                channelId: msg.channelId || null,
                toUserId: msg.toUserId || null
            };
            if (msg.toUserId) {
                // Direct message: emit only to the recipient if in room
                io.to(`game-${msg.gameId}`).emit('chat:dm', { ...payload, toUserId: msg.toUserId });
            } else if (msg.channelId) {
                io.to(`game-${msg.gameId}`).emit('chat:channel', payload);
            } else {
                io.to(`game-${msg.gameId}`).emit('chat:game', payload);
            }
        } catch (e) {
            socket.emit('chat:error', { message: 'Failed to send message' });
        }
    });
    console.log(`🚀 Player connected: ${socket.id}`);
    
    // Join game room and get current game status
    socket.on('join-game', (gameId, userId) => {
        socket.join(`game-${gameId}`);
        socket.gameId = gameId;
        socket.userId = userId;
        console.log(`👤 Player ${userId} joined game ${gameId} room`);
        // Update presence timestamp
        if (userId) {
            const now = new Date().toISOString();
            db.run('UPDATE users SET last_seen_at = ?, last_activity_at = ? WHERE id = ?', [now, now, userId], () => {});
        }
        
        // Send current game status to newly connected player
        sendGameStatusUpdate(gameId, userId, socket);
    });

    // Track client activity for idle detection
    socket.on('client:activity', () => {
        if (!socket.userId) return;
        db.run('UPDATE users SET last_activity_at = ? WHERE id = ?', [new Date().toISOString(), socket.userId], () => {});
    });

    // Provide players list including lock and online status
    socket.on('players:list', async (payload, callback) => {
        try {
            const gameId = payload?.gameId || socket.gameId;
            if (!gameId) return callback && callback({ success: false, error: 'Missing gameId' });

            // Current turn
            const currentTurn = await new Promise((resolve) => {
                db.get('SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [gameId], (err, row) => {
                    resolve(row?.turn_number || 1);
                });
            });

            // Players in game
            const players = await new Promise((resolve) => {
                db.all(
                    `SELECT gp.user_id as userId, u.username, u.last_seen_at as lastSeenAt, u.last_activity_at as lastActivityAt, gp.avatar, gp.color_primary as colorPrimary, gp.color_secondary as colorSecondary
                     FROM game_players gp 
                     JOIN users u ON gp.user_id = u.id 
                     WHERE gp.game_id = ?`,
                    [gameId],
                    (err, rows) => resolve(rows || [])
                );
            });

            // Locked players map
            const lockedSet = new Set(
                await new Promise((resolve) => {
                    db.all(
                        'SELECT user_id FROM turn_locks WHERE game_id = ? AND turn_number = ? AND locked = 1',
                        [gameId, currentTurn],
                        (err, rows) => resolve((rows || []).map(r => r.user_id))
                    );
                })
            );

            // Online users: sockets in room
            const room = io.sockets.adapter.rooms.get(`game-${gameId}`);
            const onlineUserIds = new Set();
            if (room) {
                for (const sid of room) {
                    const s = io.sockets.sockets.get(sid);
                    if (s?.userId) onlineUserIds.add(Number(s.userId));
                }
            }

            const enriched = players.map(p => ({
                userId: p.userId,
                username: p.username,
                avatar: p.avatar || null,
                colorPrimary: p.colorPrimary || null,
                colorSecondary: p.colorSecondary || null,
                locked: lockedSet.has(p.userId),
                online: onlineUserIds.has(p.userId),
                lastSeenAt: p.lastSeenAt || null,
                lastActivityAt: p.lastActivityAt || null
            }));

            callback && callback({ success: true, currentTurn, players: enriched });
        } catch (e) {
            callback && callback({ success: false, error: 'Failed to get players' });
        }
    });
    
    // Handle turn locking - ASYNCHRONOUS: Players can lock turns anytime
    socket.on('lock-turn', async (gameId, userId, turnNumber) => {
        try {
            console.log(`🔒 Player ${userId} locking turn ${turnNumber} in game ${gameId}`);
            
            // Update turn lock in database
            db.run(
                'INSERT OR REPLACE INTO turn_locks (game_id, user_id, turn_number, locked, locked_at) VALUES (?, ?, ?, ?, ?)',
                [gameId, userId, turnNumber, true, new Date().toISOString()],
                () => {
                    // Notify all players in the game (whether online or not)
                    io.to(`game-${gameId}`).emit('player-locked-turn', { 
                        userId, 
                        turnNumber,
                        message: `Player ${userId} has locked their turn ${turnNumber}` 
                    });
                    
                    // Check if we can auto-resolve (optional - for faster gameplay)
                    checkTurnResolution(gameId, turnNumber);
                }
            );
        } catch (error) {
            console.error('Turn lock error:', error);
            socket.emit('error', { message: 'Failed to lock turn' });
        }
    });
    
    // Handle movement orders - Store in database for asynchronous processing
    socket.on('move-ship', (data) => {
        const { gameId, shipId, currentX, currentY, destinationX, destinationY, movementPath, estimatedTurns } = data;
        console.log(`🚢 Ship ${shipId} move order: from (${currentX || 'unknown'}, ${currentY || 'unknown'}) to (${destinationX}, ${destinationY}) in game ${gameId}`);
        
        // Get ship's current position and metadata
        db.get('SELECT x, y, meta FROM sector_objects WHERE id = ?', [shipId], (err, ship) => {
            if (err || !ship) {
                console.error('Error finding ship:', err);
                socket.emit('error', { message: 'Ship not found' });
                return;
            }
            
            const meta = JSON.parse(ship.meta || '{}');
            const movementSpeed = meta.movementSpeed || 1;
            const pathLength = movementPath ? movementPath.length - 1 : 0;
            const actualETA = Math.ceil(pathLength / movementSpeed);
            
            // Log position validation
            const serverX = ship.x;
            const serverY = ship.y;
            const clientX = currentX;
            const clientY = currentY;
            
            if (clientX !== undefined && clientY !== undefined) {
                const positionDiff = Math.abs(serverX - clientX) + Math.abs(serverY - clientY);
                if (positionDiff > 0) {
                    console.log(`⚠️ Position desync detected: Ship ${shipId} server:(${serverX},${serverY}) vs client:(${clientX},${clientY}) diff:${positionDiff}`);
                } else {
                    console.log(`✅ Position sync confirmed: Ship ${shipId} at (${serverX},${serverY})`);
                }
            }
            
            // First, cancel any existing movement orders for this ship
            db.run(
                'DELETE FROM movement_orders WHERE object_id = ? AND status IN ("active", "blocked")',
                [shipId],
                function(err) {
                    if (err) {
                        console.error('Error canceling old movement orders:', err);
                        socket.emit('error', { message: 'Failed to cancel previous movement order' });
                        return;
                    }
                    
                    if (this.changes > 0) {
                        console.log(`🗑️ Canceled ${this.changes} existing movement orders for ship ${shipId}`);
                    }
                    
                    // Now store the new movement order with timestamp to prevent duplicates
                    const orderTimestamp = new Date().toISOString();
        db.run(
                        `INSERT INTO movement_orders 
                         (object_id, destination_x, destination_y, movement_speed, eta_turns, movement_path, current_step, status, created_at) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            shipId, 
                            destinationX, 
                            destinationY, 
                            movementSpeed, 
                            actualETA,
                            JSON.stringify(movementPath || []),
                            0,
                            'active',
                            orderTimestamp
                        ],
            (err) => {
                if (err) {
                    console.error('Error storing movement order:', err);
                    socket.emit('error', { message: 'Failed to store movement order' });
                } else {
                                console.log(`📝 Movement order stored: ${pathLength} tiles, ETA ${actualETA} turns`);
                                
                    // Confirm order received
                    socket.emit('movement-confirmed', { 
                        shipId, 
                        destinationX, 
                        destinationY,
                                    pathLength,
                                    estimatedTurns: actualETA,
                                    message: `Movement order confirmed: ${pathLength} tiles, ETA ${actualETA} turns`
                    });
                    
                                // Notify other players about the movement
                    socket.to(`game-${gameId}`).emit('ship-movement-ordered', {
                        shipId,
                        destinationX,
                        destinationY,
                                    pathLength,
                                    estimatedTurns: actualETA,
                        userId: socket.userId
                    });
                }
            }
        );
                }
            );
        });
    });
    
    // Handle warp orders - Store warp preparation in database
    socket.on('warp-ship', (data) => {
        const { gameId, shipId, targetId, targetX, targetY, shipName, targetName } = data;
        console.log(`🌌 Ship ${shipId} (${shipName}) warp order: to ${targetName} at (${targetX}, ${targetY}) in game ${gameId}`);
        
        // Validate ship exists and is owned by player
        db.get('SELECT x, y, meta FROM sector_objects WHERE id = ?', [shipId], (err, ship) => {
            if (err || !ship) {
                console.error('Error finding ship for warp:', err);
                socket.emit('error', { message: 'Ship not found' });
                return;
            }
            
            // Validate target exists
            db.get('SELECT x, y, meta, celestial_type FROM sector_objects WHERE id = ?', [targetId], (err, target) => {
                if (err || !target) {
                    console.error('Error finding warp target:', err);
                    socket.emit('error', { message: 'Warp target not found' });
                    return;
                }
                
                // Cancel any existing movement/warp orders for this ship
                db.run(
                    'DELETE FROM movement_orders WHERE object_id = ? AND status IN ("active", "blocked")',
                    [shipId],
                    function(err) {
                        if (err) {
                            console.error('Error canceling old orders for warp:', err);
                            socket.emit('error', { message: 'Failed to cancel previous orders' });
                            return;
                        }
                        
                        if (this.changes > 0) {
                            console.log(`🗑️ Canceled ${this.changes} existing orders for warp ship ${shipId}`);
                        }
                        
                        // Store warp order with preparation phase
                        const orderTimestamp = new Date().toISOString();
                        db.run(
                            `INSERT INTO movement_orders 
                             (object_id, warp_target_id, warp_destination_x, warp_destination_y, 
                              warp_phase, warp_preparation_turns, status, created_at) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                shipId,
                                targetId,
                                targetX,
                                targetY,
                                'preparing',
                                0,
                                'warp_preparing',
                                orderTimestamp
                            ],
                            (err) => {
                                if (err) {
                                    console.error('Error storing warp order:', err);
                                    socket.emit('error', { message: 'Failed to store warp order' });
                                } else {
                                    console.log(`🌌 Warp order stored: ${shipName} → ${targetName}, preparation phase started`);
                                    
                                    // Confirm warp order received
                                    socket.emit('warp-confirmed', {
                                        shipId,
                                        targetId,
                                        targetName,
                                        targetX,
                                        targetY,
                                        phase: 'preparing',
                                        preparationTurns: 0,
                                        message: `Warp drive engaging. Preparation: 0/2 turns`
                                    });
                                    
                                    // Notify other players about the warp preparation
                                    socket.to(`game-${gameId}`).emit('ship-warp-ordered', {
                                        shipId,
                                        shipName,
                                        targetName,
                                        targetX,
                                        targetY,
                                        phase: 'preparing',
                                        userId: socket.userId
                                    });
                                }
                            }
                        );
                    }
                );
            });
        });
    });
    
    // Handle harvesting operations
    socket.on('start-harvesting', async (data) => {
        const { gameId, shipId, resourceNodeId } = data;
        console.log(`⛏️ Start harvesting request: Ship ${shipId} → Node ${resourceNodeId} in game ${gameId}`);
        
        try {
            // Get current turn
            const currentTurn = await getCurrentTurnNumber(gameId);
            
            const result = await HarvestingManager.startHarvesting(shipId, resourceNodeId, currentTurn);
            
            if (result.success) {
                socket.emit('harvesting-started', {
                    shipId,
                    resourceNodeId,
                    harvestRate: result.harvestRate,
                    resourceType: result.resourceType,
                    message: `Started harvesting ${result.resourceType} at ${result.harvestRate}/turn`
                });
                
                // Notify other players
                socket.to(`game-${gameId}`).emit('ship-harvesting-started', {
                    shipId,
                    resourceType: result.resourceType,
                    userId: socket.userId
                });
            } else {
                socket.emit('harvesting-error', {
                    shipId,
                    error: result.error
                });
            }
        } catch (error) {
            console.error('Error starting harvesting:', error);
            socket.emit('harvesting-error', {
                shipId,
                error: 'Server error starting harvesting operation'
            });
        }
    });

    // Deprecated: attack-target is disabled; use activate-ability for offense
    socket.on('attack-target', async () => {
        socket.emit('combat:error', { error: 'Use abilities to attack (activate-ability)' });
    });

    // Handle ability activations - enqueue for turn resolution
    socket.on('activate-ability', async (data) => {
        const { gameId, casterId, abilityKey, targetObjectId, targetX, targetY, params } = data || {};
        try {
            if (!gameId || !casterId || !abilityKey) {
                return socket.emit('ability:error', { error: 'Missing gameId/casterId/abilityKey' });
            }
            const ability = Abilities[abilityKey];
            if (!ability) return socket.emit('ability:error', { error: 'Unknown ability' });
            const currentTurn = await getCurrentTurnNumber(gameId);
            // Validate caster ownership
            const caster = await new Promise((resolve) => {
                db.get('SELECT id, owner_id, sector_id, x, y, meta FROM sector_objects WHERE id = ?', [casterId], (err, row) => resolve(row));
            });
            if (!caster) return socket.emit('ability:error', { error: 'Caster not found' });
            if (Number(caster.owner_id) !== Number(socket.userId)) return socket.emit('ability:error', { error: 'Caster not owned by player' });
            // Cooldown check (soft; final check in resolver)
            const cdRow = await new Promise((resolve) => {
                db.get('SELECT available_turn FROM ability_cooldowns WHERE ship_id = ? AND ability_key = ?', [casterId, abilityKey], (err, row) => resolve(row));
            });
            if (cdRow && Number(cdRow.available_turn) > Number(currentTurn)) {
                return socket.emit('ability:error', { error: 'Ability on cooldown' });
            }
            // Basic target validation shape (offense must include target object)
            if (ability.type === 'offense' && !targetObjectId) {
                return socket.emit('ability:error', { error: 'Offensive abilities require a target object' });
            }
            if (ability.target === 'position' && (typeof targetX !== 'number' || typeof targetY !== 'number')) {
                return socket.emit('ability:error', { error: 'Position target required' });
            }
            if ((ability.target === 'ally' || ability.target === 'enemy') && !targetObjectId) {
                return socket.emit('ability:error', { error: 'Target object required' });
            }
            // Enqueue ability order (latest wins for turn)
            await new Promise((resolve) => db.run('DELETE FROM ability_orders WHERE caster_id = ? AND game_id = ? AND turn_number = ?', [casterId, gameId, currentTurn], () => resolve()));
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO ability_orders (game_id, turn_number, caster_id, ability_key, target_object_id, target_x, target_y, params, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [gameId, currentTurn, casterId, abilityKey, targetObjectId || null, targetX || null, targetY || null, params ? JSON.stringify(params) : null, new Date().toISOString()],
                    (err) => err ? reject(err) : resolve()
                );
            });
            socket.emit('ability-queued', { casterId, abilityKey, turnNumber: currentTurn });
        } catch (e) {
            console.error('Error queuing ability:', e);
            socket.emit('ability:error', { error: 'Failed to queue ability' });
        }
    });
    
    socket.on('stop-harvesting', async (data) => {
        const { gameId, shipId } = data;
        console.log(`🛑 Stop harvesting request: Ship ${shipId} in game ${gameId}`);
        
        try {
            const result = await HarvestingManager.stopHarvesting(shipId);
            
            if (result.success) {
                socket.emit('harvesting-stopped', {
                    shipId,
                    totalHarvested: result.totalHarvested,
                    resourceType: result.resourceType,
                    message: `Stopped harvesting. Total collected: ${result.totalHarvested} ${result.resourceType}`
                });
                
                // Notify other players
                socket.to(`game-${gameId}`).emit('ship-harvesting-stopped', {
                    shipId,
                    userId: socket.userId
                });
            } else {
                socket.emit('harvesting-error', {
                    shipId,
                    error: result.error
                });
            }
        } catch (error) {
            console.error('Error stopping harvesting:', error);
            socket.emit('harvesting-error', {
                shipId,
                error: 'Server error stopping harvesting operation'
            });
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`👋 Player ${socket.userId} disconnected from game ${socket.gameId}`);
        if (socket.userId) {
            db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [new Date().toISOString(), socket.userId], () => {});
        }
    });
});

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

// Send current game status to a player
function sendGameStatusUpdate(gameId, userId, socket) {
    // Get current turn status
    db.get(
        'SELECT * FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1',
        [gameId],
        (err, currentTurn) => {
            if (err || !currentTurn) return;
            
            // Get player's lock status
            db.get(
                'SELECT locked FROM turn_locks WHERE game_id = ? AND user_id = ? AND turn_number = ?',
                [gameId, userId, currentTurn.turn_number],
                (err, lockStatus) => {
                    if (err) return;
                    
                    socket.emit('game-status-update', {
                        currentTurn: currentTurn.turn_number,
                        turnStatus: currentTurn.status,
                        playerLocked: lockStatus?.locked || false,
                        message: `Welcome back! Current turn: ${currentTurn.turn_number}`
                    });
                }
            );
        }
    );
}

// Check if turn can be resolved (optional auto-resolution for faster gameplay)
function checkTurnResolution(gameId, turnNumber) {
    // Get all players in game
    db.all(
        'SELECT gp.user_id FROM game_players gp WHERE gp.game_id = ?',
        [gameId],
        (err, allPlayers) => {
            if (err) return;
            
            // Get locked players for this turn
            db.all(
                'SELECT user_id FROM turn_locks WHERE game_id = ? AND turn_number = ? AND locked = 1',
                [gameId, turnNumber],
                (err, lockedPlayers) => {
                    if (err) return;
                    
                    console.log(`📊 Game ${gameId} Turn ${turnNumber}: ${lockedPlayers.length}/${allPlayers.length} players have locked`);
                    
                    // Option 1: Auto-resolve when all players lock (immediate)
                    if (lockedPlayers.length === allPlayers.length) {
                        console.log(`⚡ All players locked turn ${turnNumber} for game ${gameId} - auto-resolving!`);
                        resolveTurn(gameId, turnNumber);
                    }
                    
                    // Option 2: Set timer for auto-resolution (e.g., 24 hours)
                    // This allows asynchronous play where players don't need to be online simultaneously
                    // Uncomment the following for time-based resolution:
                    /*
                    else if (lockedPlayers.length > 0) {
                        // Set up delayed resolution (24 hour example)
                        setTimeout(() => {
                            resolveTurn(gameId, turnNumber);
                        }, 24 * 60 * 60 * 1000); // 24 hours
                    }
                    */
                }
            );
        }
    );
}

// Resolve a turn (process all moves, combat, etc.)
// ✅ ATOMIC TURN RESOLUTION POLICY:
// - No real-time updates during resolution
// - All changes happen server-side first
// - Clients receive final results via 'turn-resolved' + loadGameState()
// Global turn resolution locks to prevent concurrent resolution
const turnResolutionLocks = new Set();

// - This ensures consistent game state and eliminates timing bugs
async function resolveTurn(gameId, turnNumber) {
    const lockKey = `${gameId}-${turnNumber}`;
    
    // Check if this turn is already being resolved
    if (turnResolutionLocks.has(lockKey)) {
        console.log(`⏳ Turn ${turnNumber} for game ${gameId} is already being resolved, skipping duplicate`);
        return;
    }
    
    // Acquire lock
    turnResolutionLocks.add(lockKey);
    
    console.log(`🎬 Resolving turn ${turnNumber} for game ${gameId} (Atomic Resolution)`);
    
    // Notify all players that resolution has started
    io.to(`game-${gameId}`).emit('turn-resolving', { 
        turnNumber,
        message: `Turn ${turnNumber} is now resolving...` 
    });
    
    try {
        // Begin a transaction for atomic resolution
        await new Promise((resolve, reject) => db.run('BEGIN IMMEDIATE TRANSACTION', (e) => e ? reject(e) : resolve()));
    // 1. Process movement orders
        await processMovementOrders(gameId, turnNumber);
        
        // 2. Update visibility for all players
        await updateAllPlayersVisibility(gameId, turnNumber);
        
        // 3. Clean up old completed movement orders (older than 2 turns)
        await cleanupOldMovementOrders(gameId, turnNumber);
        
        // 4. Process harvesting operations
        await HarvestingManager.processHarvestingForTurn(gameId, turnNumber);
        
        // 5. Handle abilities then combat
        await processAbilityOrders(gameId, turnNumber);
        await processCombatOrders(gameId, turnNumber);
        await cleanupExpiredEffectsAndWrecks(gameId, turnNumber);
        await regenerateShipEnergy(gameId, turnNumber);
        
        // Create next turn
        const nextTurn = turnNumber + 1;
        
        await new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO turns (game_id, turn_number, status) VALUES (?, ?, ?)',
            [gameId, nextTurn, 'waiting'],
                (err) => {
                    if (err) return reject(err);
                    
                // Mark current turn as resolved
                db.run(
                    'UPDATE turns SET status = ?, resolved_at = ? WHERE game_id = ? AND turn_number = ?',
                    ['completed', new Date().toISOString(), gameId, turnNumber],
                        (err) => {
                            if (err) return reject(err);
                            resolve();
                        }
                    );
                }
            );
        });

        // Commit the transaction
        await new Promise((resolve, reject) => db.run('COMMIT', (e) => e ? reject(e) : resolve()));
        
                        console.log(`✅ Turn ${turnNumber} atomically resolved, starting turn ${nextTurn}`);
                        
                        // Notify all players - they will now loadGameState() to see all changes
                        io.to(`game-${gameId}`).emit('turn-resolved', { 
                            turnNumber: turnNumber,
                            nextTurn: nextTurn,
                            completedTurn: turnNumber,
                            newTurn: nextTurn,
                            message: `Turn ${turnNumber} resolved! All changes are now visible.`
                        });
        
    } catch (error) {
        console.error(`❌ Error resolving turn ${turnNumber}:`, error);
        try { await new Promise((resolve) => db.run('ROLLBACK', () => resolve())); } catch {}
        
        // Notify players of error
        io.to(`game-${gameId}`).emit('turn-error', {
            turnNumber,
            error: 'Turn resolution failed'
        });
    } finally {
        // Always release the lock
        turnResolutionLocks.delete(lockKey);
    }
}

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
    return new Promise((resolve, reject) => {
        // Handle warp orders separately
        if (order.status === 'warp_preparing') {
            return processWarpOrder(order, turnNumber, gameId, resolve, reject);
        }
        
        const movementPath = JSON.parse(order.movement_path || '[]');
        const currentStep = order.current_step || 0;
        const movementSpeed = order.movement_speed || 1;
        const meta = JSON.parse(order.meta || '{}');
        
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

// Process warp order (preparation and execution)
function processWarpOrder(order, turnNumber, gameId, resolve, reject) {
    const preparationTurns = order.warp_preparation_turns || 0;
    const warpPhase = order.warp_phase || 'preparing';
    const meta = JSON.parse(order.meta || '{}');
    
    console.log(`🌌 Processing warp order for ship ${order.object_id}: phase=${warpPhase}, prep=${preparationTurns}/2`);
    
    if (warpPhase === 'preparing') {
        const newPreparationTurns = preparationTurns + 1;
        
        if (newPreparationTurns >= 2) {
            // Preparation complete - execute warp jump
            console.log(`🚀 Warp preparation complete for ship ${order.object_id}, executing jump!`);
            
            // Move ship to destination instantly
            db.run(
                'UPDATE sector_objects SET x = ?, y = ? WHERE id = ?',
                [order.warp_destination_x, order.warp_destination_y, order.object_id],
                function(err) {
                    if (err) {
                        console.error('Error executing warp jump:', err);
                        return reject(err);
                    }
                    
                    console.log(`✨ Ship ${order.object_id} warped to (${order.warp_destination_x}, ${order.warp_destination_y})`);
                    
                    // Record warp as a movement_history segment for trails
                    db.run(
                        `INSERT INTO movement_history 
                         (object_id, game_id, turn_number, from_x, from_y, to_x, to_y, movement_speed) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            order.object_id,
                            gameId,
                            turnNumber,
                            order.current_x || order.warp_destination_x, // best-effort from state; may be null
                            order.current_y || order.warp_destination_y,
                            order.warp_destination_x,
                            order.warp_destination_y,
                            0
                        ],
                        (historyErr) => {
                            if (historyErr) {
                                console.error(`❌ Failed to record warp history for ship ${order.object_id}:`, historyErr);
                            } else {
                                console.log(`📜 Recorded warp history: Ship ${order.object_id} to (${order.warp_destination_x},${order.warp_destination_y}) on turn ${turnNumber}`);
                            }
                        }
                    );

                    // Delete the warp order (completed)
                    db.run(
                        'DELETE FROM movement_orders WHERE id = ?',
                        [order.id],
                        (err) => {
                            if (err) {
                                console.error('Error cleaning up warp order:', err);
                            }
                            
                            resolve({
                                objectId: order.object_id,
                                status: 'warp_completed',
                                newX: order.warp_destination_x,
                                newY: order.warp_destination_y,
                                message: `Warp jump completed to (${order.warp_destination_x}, ${order.warp_destination_y})`
                            });
                        }
                    );
                }
            );
        } else {
            // Continue preparation - increment turn counter
            db.run(
                'UPDATE movement_orders SET warp_preparation_turns = ? WHERE id = ?',
                [newPreparationTurns, order.id],
                (err) => {
                    if (err) {
                        console.error('Error updating warp preparation:', err);
                        return reject(err);
                    }
                    
                    console.log(`⚡ Ship ${order.object_id} warp preparation: ${newPreparationTurns}/2 turns`);
                    
                    resolve({
                        objectId: order.object_id,
                        status: 'warp_preparing',
                        preparationTurns: newPreparationTurns,
                        message: `Warp drive charging: ${newPreparationTurns}/2 turns`
                    });
                }
            );
        }
    } else {
        // Shouldn't happen, but handle gracefully
        console.warn(`⚠️ Unknown warp phase: ${warpPhase} for ship ${order.object_id}`);
        resolve({
            objectId: order.object_id,
            status: 'warp_error',
            message: 'Unknown warp phase'
        });
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
            const maxE = Number(meta.maxEnergy || 0);
            if (regen > 0 && maxE > 0) {
                const current = Number(meta.energy || 0);
                const next = Math.min(maxE, current + regen);
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

    for (const order of orders) {
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
            metaObj.energy = Math.max(0, currentEnergy - ability.energyCost);
            await new Promise((resolve) => db.run('UPDATE sector_objects SET meta = ?, updated_at = ? WHERE id = ?', [JSON.stringify(metaObj), new Date().toISOString(), order.caster_id], () => resolve()));
        }

        // Apply status effect records
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

        await new Promise((resolve) => db.run(
            `INSERT INTO ship_status_effects (ship_id, effect_key, magnitude, effect_data, source_object_id, applied_turn, expires_turn)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [effectTargetId, ability.effectKey, magnitude, JSON.stringify(effectData), order.caster_id, turnNumber, turnNumber + (ability.duration || 1)],
            () => resolve()
        ));

        // Set cooldown
        const availableTurn = Number(turnNumber) + (ability.cooldown || 1);
        await new Promise((resolve) => db.run(
            `INSERT INTO ability_cooldowns (ship_id, ability_key, available_turn) VALUES (?, ?, ?)
             ON CONFLICT(ship_id, ability_key) DO UPDATE SET available_turn = excluded.available_turn`,
            [order.caster_id, order.ability_key, availableTurn],
            () => resolve()
        ));

        // Log
        await new Promise((resolve) => db.run(
            `INSERT INTO combat_logs (game_id, turn_number, attacker_id, target_id, event_type, summary, data)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [gameId, turnNumber, order.caster_id, effectTargetId, 'ability', `${order.ability_key} applied`, JSON.stringify({ abilityKey: order.ability_key })],
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
        const { Abilities: AB } = require('./abilities');
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

        // Explorer passive hook sets
        const targetAbilities = Array.isArray(tMeta.abilities) ? tMeta.abilities : [];

        // Base damage cadence: honor simple cooldown per attacker/weapon (per-weapon fire every N turns)
        let baseDamage = weapon.baseDamage || 0;
        let weaponCooldown = weapon.cooldown || 1;
        let weaponReady = (Number(turnNumber) % weaponCooldown) === 0;
        // Enforce PD targeting rules: PD only effective vs small ships; vs larger, diminish hard
        const isPD = (weapon.tags || []).includes('pd');
        const targetIsSmall = (tMeta.class === 'frigate');
        if (isPD && !targetIsSmall) {
            baseDamage = Math.floor(baseDamage * 0.2); // heavily diminished vs larger
        }
        // PD fires every turn regardless (cd=1), heavy weapons respect cooldown
        if (!weaponReady) {
            await new Promise((resolve) => db.run(
                `INSERT INTO combat_logs (game_id, turn_number, attacker_id, target_id, event_type, summary, data)
                 VALUES (?, ?, ?, ?, 'attack', ?, ?)`,
                [gameId, turnNumber, attacker.id, target.id, `Weapon ${weaponKey} reloading`, JSON.stringify({ weaponKey })],
                () => resolve()
            ));
            continue;
        }
        let damage = Math.max(0, Math.round(baseDamage * rangeMult * sizeMult));

        // Duct Tape Resilience: first hit at full HP reduced by 25%
        if (targetAbilities.includes('duct_tape_resilience') && tMeta.hp === tMeta.maxHp && !tMeta._resilienceConsumed) {
            damage = Math.floor(damage * 0.75);
            tMeta._resilienceConsumed = true;
        }

        if (damage <= 0) {
            await new Promise((resolve) => db.run(
                `INSERT INTO combat_logs (game_id, turn_number, attacker_id, target_id, event_type, summary, data)
                 VALUES (?, ?, ?, ?, 'attack', ?, ?)`,
                [gameId, turnNumber, attacker.id, target.id, `Attack with ${weaponKey} missed/ineffective`, JSON.stringify({ weaponKey, distance, rangeMult, sizeMult })],
                () => resolve()
            ));
            continue;
        }

        // Apply HP change
        const targetHp = typeof tMeta.hp === 'number' ? tMeta.hp : 1;
        const newHp = targetHp - damage;
        tMeta.hp = newHp;
        await new Promise((resolve) => db.run('UPDATE sector_objects SET meta = ?, updated_at = ? WHERE id = ?', [JSON.stringify(tMeta), new Date().toISOString(), target.id], () => resolve()));

        // Log attack
        await new Promise((resolve) => db.run(
            `INSERT INTO combat_logs (game_id, turn_number, attacker_id, target_id, event_type, summary, data)
             VALUES (?, ?, ?, ?, 'attack', ?, ?)`,
            [gameId, turnNumber, attacker.id, target.id, `Hit for ${damage}`, JSON.stringify({ weaponKey, distance, rangeMult, sizeMult })],
            () => resolve()
        ));

        // Handle kill → wreck + loot
        if (newHp <= 0) {
            // Convert to wreck object (keep same position/sector)
            await new Promise((resolve) => db.run('DELETE FROM ship_status_effects WHERE ship_id = ?', [target.id], () => resolve()));
            const wreckMeta = { name: (tMeta.name || 'Wreck'), type: 'wreck', decayTurn: Number(turnNumber) + 7 };
            // Mark as wreck by updating type and meta
            await new Promise((resolve) => db.run('UPDATE sector_objects SET type = ?, meta = ?, updated_at = ? WHERE id = ?', ['wreck', JSON.stringify(wreckMeta), new Date().toISOString(), target.id], () => resolve()));
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
                    const blueprint = { id: blueprintId, class: bpClass, role: bpRole, specialized: [] };
                    const reqs = computeAllRequirements(blueprint);
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
    // TODO: Get ship position and calculate actual distance/speed
    // For now, return a simple estimate
    return 3; // 3 turns
}

// Make io available to routes
app.set('io', io);

// Start server after DB is initialized
db.ready.then(() => {
    server.listen(PORT, () => {
        console.log(`🌌 Starfront: Dominion server running on http://localhost:${PORT}`);
        console.log(`🎮 Game client available at http://localhost:${PORT}/`);
        console.log(`📊 Health check at http://localhost:${PORT}/health`);
        console.log(`🔌 Socket.IO enabled for real-time gameplay`);
    });
});