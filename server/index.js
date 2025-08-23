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

// Queued orders configuration
const MAX_QUEUED_ORDERS_PER_SHIP = 5;

// Utility: simple Bresenham line for tile path
function computePathBresenham(x0, y0, x1, y1) {
    const path = [];
    let ix = Math.round(Number(x0) || 0);
    let iy = Math.round(Number(y0) || 0);
    const tx = Math.round(Number(x1) || 0);
    const ty = Math.round(Number(y1) || 0);
    const dx = Math.abs(tx - ix);
    const dy = Math.abs(ty - iy);
    const sx = ix < tx ? 1 : -1;
    const sy = iy < ty ? 1 : -1;
    let err = dx - dy;
    while (true) {
        path.push({ x: ix, y: iy });
        if (ix === tx && iy === ty) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; ix += sx; }
        if (e2 < dx) { err += dx; iy += sy; }
    }
    return path;
}

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
// Serve built React app first (takes precedence over legacy client)
app.use(express.static(path.join(__dirname, '../web/dist')));
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
    res.sendFile(path.join(__dirname, '../web/dist/index.html'));
});

// Background scheduler: auto-advance turns for active games with auto_turn_minutes set
setInterval(async () => {
    try {
        // Find active games with auto turn enabled
        const games = await new Promise((resolve) => {
            db.all('SELECT id, auto_turn_minutes FROM games WHERE status = ? AND auto_turn_minutes IS NOT NULL', ['active'], (e, rows) => resolve(rows || []));
        });
        const now = Date.now();
        for (const g of games) {
            try {
                const current = await new Promise((resolve) => {
                    db.get('SELECT turn_number, created_at, status FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [g.id], (e, row) => resolve(row));
                });
                if (!current) continue;
                // Only act on waiting turns
                if (current.status && current.status !== 'waiting') continue;
                // Normalize SQLite UTC timestamp to ISO UTC for safe parsing
                const createdAtMs = current.created_at ? Date.parse((String(current.created_at).includes('T') ? String(current.created_at) : String(current.created_at).replace(' ', 'T') + 'Z')) : null;
                if (!createdAtMs || !Number.isFinite(createdAtMs)) continue;
                const dueMs = (g.auto_turn_minutes || 0) * 60 * 1000;
                if (dueMs <= 0) continue;
                if (now - createdAtMs >= dueMs) {
                    // Time window elapsed: resolve the turn even if no locks
                    console.log(`⏰ Auto-advancing game ${g.id} turn ${current.turn_number} after ${g.auto_turn_minutes} minutes`);
                    resolveTurn(g.id, current.turn_number);
                }
            } catch (inner) {
                console.warn('Auto-advance scan error for game', g?.id, inner?.message || inner);
            }
        }
    } catch (e) {
        console.warn('Auto-advance scheduler error:', e?.message || e);
    }
}, 60 * 1000);

// Socket.IO connection handling - ASYNCHRONOUS FRIENDLY
io.on('connection', (socket) => {
    // Basic chat: game-wide, direct messages, and group channels (with persistence)
    socket.on('chat:send', async (msg) => {
        // msg: { gameId, fromUserId, toUserId?, channelId?, text }
        try {
            const gameId = Number(msg.gameId);
            const fromUserId = Number(msg.fromUserId || socket.userId);
            const toUserId = msg.toUserId != null ? Number(msg.toUserId) : null;
            const channelId = msg.channelId != null ? Number(msg.channelId) : null;
            const text = String(msg.text || '').slice(0, 500);
            if (!gameId || !fromUserId || !text) {
                return socket.emit('chat:error', { message: 'Invalid chat payload' });
            }

            // Resolve usernames for sender/recipient
            const fromUsername = await new Promise((resolve) => {
                db.get('SELECT username FROM users WHERE id = ?', [fromUserId], (err, row) => {
                    resolve(row?.username || null);
                });
            });
            const toUsername = toUserId ? await new Promise((resolve) => {
                db.get('SELECT username FROM users WHERE id = ?', [toUserId], (err, row) => {
                    resolve(row?.username || null);
                });
            }) : null;

            // Persist
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO chat_messages (game_id, from_user_id, to_user_id, channel_id, text, created_at)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [gameId, fromUserId, toUserId, channelId, text, new Date().toISOString()],
                    (err) => err ? reject(err) : resolve()
                );
            });

            const payload = {
                fromUserId,
                fromUsername: fromUsername || null,
                text,
                timestamp: new Date().toISOString(),
                channelId: channelId || null,
                toUserId: toUserId || null,
                toUsername: toUsername || null
            };

            if (toUserId) {
                // DM: send to sender and recipient only
                io.to(`user-${fromUserId}`).to(`user-${toUserId}`).emit('chat:dm', { ...payload, toUserId });
            } else if (channelId) {
                io.to(`game-${gameId}`).emit('chat:channel', payload);
            } else {
                io.to(`game-${gameId}`).emit('chat:game', payload);
            }
        } catch (e) {
            console.error('chat:send error:', e);
            socket.emit('chat:error', { message: 'Failed to send message' });
        }
    });

    // Chat history fetch
    socket.on('chat:history', async (params, callback) => {
        try {
            const gameId = Number(params?.gameId || socket.gameId);
            const withUserId = params?.withUserId != null ? Number(params.withUserId) : null;
            const limit = Math.max(1, Math.min(200, Number(params?.limit || 100)));
            if (!gameId) return callback && callback({ success: false, error: 'Missing gameId' });

            let rows = [];
            if (withUserId) {
                const me = Number(socket.userId);
                rows = await new Promise((resolve, reject) => {
                    db.all(
                        `SELECT m.from_user_id, m.to_user_id, m.channel_id, m.text, m.created_at,
                                fu.username AS from_username, tu.username AS to_username
                         FROM chat_messages m
                         LEFT JOIN users fu ON fu.id = m.from_user_id
                         LEFT JOIN users tu ON tu.id = m.to_user_id
                         WHERE m.game_id = ? AND (
                            (m.from_user_id = ? AND m.to_user_id = ?) OR
                            (m.from_user_id = ? AND m.to_user_id = ?)
                         )
                         ORDER BY m.id DESC LIMIT ?`,
                        [gameId, me, withUserId, withUserId, me, limit],
                        (err, r) => err ? reject(err) : resolve(r || [])
                    );
                });
            } else {
                rows = await new Promise((resolve, reject) => {
                    db.all(
                        `SELECT m.from_user_id, m.to_user_id, m.channel_id, m.text, m.created_at,
                                fu.username AS from_username
                         FROM chat_messages m
                         LEFT JOIN users fu ON fu.id = m.from_user_id
                         WHERE m.game_id = ? AND m.to_user_id IS NULL
                         ORDER BY m.id DESC LIMIT ?`,
                        [gameId, limit],
                        (err, r) => err ? reject(err) : resolve(r || [])
                    );
                });
            }

            const messages = rows.reverse().map(r => ({
                fromUserId: r.from_user_id,
                fromUsername: r.from_username || null,
                toUserId: r.to_user_id || null,
                toUsername: r.to_username || null,
                channelId: r.channel_id || null,
                text: r.text,
                timestamp: r.created_at
            }));
            callback && callback({ success: true, messages });
        } catch (err) {
            console.error('chat:history error:', err);
            callback && callback({ success: false, error: 'Failed to fetch history' });
        }
    });
    console.log(`🚀 Player connected: ${socket.id}`);
    
    // Join game room and get current game status
    socket.on('join-game', (gameId, userId) => {
        socket.join(`game-${gameId}`);
        socket.gameId = gameId;
        socket.userId = userId;
        if (userId) {
            socket.join(`user-${userId}`);
        }
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

            // [players:list] request
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
                     LEFT JOIN users u ON gp.user_id = u.id 
                     WHERE gp.game_id = ?`,
                    [gameId],
                    (err, rows) => {
                        if (err) {
                            // [players:list] game_players query error
                            return resolve([]);
                        }
                        // [players:list] raw players rows
                        resolve(rows || []);
                    }
                );
            });

            // Locked players map
            const lockedSet = new Set(
                await new Promise((resolve) => {
                    db.all(
                        'SELECT user_id FROM turn_locks WHERE game_id = ? AND turn_number = ? AND locked = 1',
                        [gameId, currentTurn],
                        (err, rows) => {
                            if (err) {
                                // [players:list] turn_locks query error
                                return resolve([]);
                            }
                            const ids = (rows || []).map(r => r.user_id);
                            // [players:list] locked users turn
                            resolve(ids);
                        }
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
            // [players:list] online users detected

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

            // [players:list] responding with players for game
            callback && callback({ success: true, currentTurn, players: enriched });
        } catch (e) {
            // [players:list] handler error
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
    
    // Handle turn unlocking - allowed until turn resolves
    socket.on('unlock-turn', async (gameId, userId, turnNumber) => {
        try {
            console.log(`🔓 Player ${userId} unlocking turn ${turnNumber} in game ${gameId}`);
            // Ensure the turn is still waiting
            db.get('SELECT status FROM turns WHERE game_id = ? AND turn_number = ?', [gameId, turnNumber], (err, row) => {
                if (err || !row) { socket.emit('error', { message: 'Failed to unlock turn' }); return; }
                if (row.status !== 'waiting') { socket.emit('error', { message: 'Turn already resolving or completed' }); return; }
                db.run(
                    'INSERT OR REPLACE INTO turn_locks (game_id, user_id, turn_number, locked, locked_at) VALUES (?, ?, ?, ?, ?)',
                    [gameId, userId, turnNumber, false, new Date().toISOString()],
                    () => {
                        io.to(`game-${gameId}`).emit('player-unlocked-turn', {
                            userId,
                            turnNumber,
                            message: `Player ${userId} has unlocked their turn ${turnNumber}`
                        });
                    }
                );
            });
        } catch (error) {
            console.error('Turn unlock error:', error);
            socket.emit('error', { message: 'Failed to unlock turn' });
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
                        
                        // Determine required preparation time from ship blueprint if available
                        let requiredPrep = 2;
                        try {
                            const metaObj = JSON.parse(ship.meta || '{}');
                            if (typeof metaObj.warpPreparationTurns === 'number' && metaObj.warpPreparationTurns >= 0) {
                                requiredPrep = Math.max(0, Math.floor(metaObj.warpPreparationTurns));
                            }
                        } catch {}

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
                                        requiredPreparationTurns: requiredPrep,
                                        message: `Warp drive engaging. Preparation: 0/${requiredPrep} turns`
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

    // Queue management: add a queued order
    socket.on('queue-order', async (data, callback) => {
        try {
            const { gameId, shipId, orderType, payload, notBeforeTurn } = data || {};
            if (!gameId || !shipId || !orderType) return callback && callback({ success: false, error: 'missing_fields' });
            // Enforce ownership
            const ship = await new Promise((resolve) => db.get('SELECT owner_id FROM sector_objects WHERE id = ?', [shipId], (e, r) => resolve(r)));
            if (!ship || Number(ship.owner_id) !== Number(socket.userId)) return callback && callback({ success: false, error: 'not_owner' });
            // Enforce queue length limit
            const queuedCount = await new Promise((resolve) => db.get('SELECT COUNT(1) as c FROM queued_orders WHERE ship_id = ? AND status = "queued"', [shipId], (e, r) => resolve(r?.c || 0)));
            if (queuedCount >= MAX_QUEUED_ORDERS_PER_SHIP) return callback && callback({ success: false, error: 'queue_full' });
            // Determine next sequence index
            const seqRow = await new Promise((resolve) => db.get('SELECT COALESCE(MAX(sequence_index), 0) as maxSeq FROM queued_orders WHERE ship_id = ?', [shipId], (e, r) => resolve(r)));
            const nextSeq = Number(seqRow?.maxSeq || 0) + 1;
            await new Promise((resolve, reject) => db.run(
                `INSERT INTO queued_orders (game_id, ship_id, sequence_index, order_type, payload, not_before_turn, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
                [gameId, shipId, nextSeq, String(orderType), payload ? JSON.stringify(payload) : null, (typeof notBeforeTurn === 'number' ? notBeforeTurn : null), new Date().toISOString()],
                (err) => err ? reject(err) : resolve()
            ));
            callback && callback({ success: true });
            io.to(`game-${gameId}`).emit('queue:updated', { shipId });
        } catch (e) {
            callback && callback({ success: false, error: 'server_error' });
        }
    });

    socket.on('queue:list', async (data, callback) => {
        try {
            const { gameId, shipId } = data || {};
            if (!gameId || !shipId) return callback && callback({ success: false, error: 'missing_fields' });
            const rows = await new Promise((resolve) => db.all(
                `SELECT id, sequence_index, order_type, payload, not_before_turn, status
                 FROM queued_orders WHERE game_id = ? AND ship_id = ? AND status = 'queued'
                 ORDER BY sequence_index ASC, id ASC`,
                [gameId, shipId],
                (e, r) => resolve(r || [])
            ));
            callback && callback({ success: true, orders: rows });
        } catch {
            callback && callback({ success: false, error: 'server_error' });
        }
    });

    socket.on('queue:clear', async (data, callback) => {
        try {
            const { gameId, shipId } = data || {};
            if (!gameId || !shipId) return callback && callback({ success: false, error: 'missing_fields' });
            await new Promise((resolve) => db.run(`UPDATE queued_orders SET status = 'cancelled' WHERE game_id = ? AND ship_id = ? AND status = 'queued'`, [gameId, shipId], () => resolve()));
            callback && callback({ success: true });
            io.to(`game-${gameId}`).emit('queue:updated', { shipId });
        } catch {
            callback && callback({ success: false, error: 'server_error' });
        }
    });

    socket.on('queue:remove', async (data, callback) => {
        try {
            const { gameId, shipId, id } = data || {};
            if (!gameId || !shipId || !id) return callback && callback({ success: false, error: 'missing_fields' });
            await new Promise((resolve) => db.run(`UPDATE queued_orders SET status = 'cancelled' WHERE id = ? AND game_id = ? AND ship_id = ? AND status = 'queued'`, [id, gameId, shipId], () => resolve()));
            callback && callback({ success: true });
            io.to(`game-${gameId}`).emit('queue:updated', { shipId });
        } catch {
            callback && callback({ success: false, error: 'server_error' });
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
            console.log(`🎯 activate-ability request: game=${gameId} caster=${casterId} key=${abilityKey} targetObj=${targetObjectId || 'n/a'} target=(${targetX||'n/a'},${targetY||'n/a'})`);
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
            console.log(`🧾 ability order stored: ship=${casterId} key=${abilityKey} turn=${currentTurn}`);
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
        let transactionActive = false;
        await new Promise((resolve, reject) => db.run('BEGIN IMMEDIATE TRANSACTION', (e) => {
            if (e) return reject(e);
            transactionActive = true;
            resolve();
        }));
        // 1. Apply abilities first so effects impact movement and vision this turn
        await processAbilityOrders(gameId, turnNumber);
        
        // 2. Process movement orders (benefits from movement-related effects)
        await processMovementOrders(gameId, turnNumber);
        
        // 3. Update visibility for all players (benefits from scan-related effects)
        await updateAllPlayersVisibility(gameId, turnNumber);
        
        // 4. Clean up old completed movement orders (older than 2 turns)
        await cleanupOldMovementOrders(gameId, turnNumber);
        
        // 5. Process harvesting operations
        await HarvestingManager.processHarvestingForTurn(gameId, turnNumber);
        
        // 6. Resolve combat
        await processCombatOrders(gameId, turnNumber);
        await cleanupExpiredEffectsAndWrecks(gameId, turnNumber);
        await regenerateShipEnergy(gameId, turnNumber);
        
        // 6.5. Materialize next queued orders for idle ships into the upcoming turn
        // This creates at most one active order per ship for the next turn
        await materializeQueuedOrders(gameId, turnNumber + 1);

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

        // Commit the transaction (guard for unexpected external rollbacks)
        if (transactionActive) {
            try {
                await new Promise((resolve, reject) => db.run('COMMIT', (e) => e ? reject(e) : resolve()));
            } catch (commitErr) {
                // If no active transaction, log and continue (non-fatal)
                if (!/no transaction is active/i.test(String(commitErr?.message || ''))) {
                    throw commitErr;
                } else {
                    console.warn('⚠️ Commit called without active transaction (continuing):', commitErr?.message || commitErr);
                }
            }
            transactionActive = false;
        }
        
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
    return new Promise(async (resolve, reject) => {
        // Handle warp orders separately
        if (order.status === 'warp_preparing') {
            return processWarpOrder(order, turnNumber, gameId, resolve, reject);
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

// Process warp order (preparation and execution)
function processWarpOrder(order, turnNumber, gameId, resolve, reject) {
    const preparationTurns = order.warp_preparation_turns || 0;
    const warpPhase = order.warp_phase || 'preparing';
    const meta = JSON.parse(order.meta || '{}');
    const requiredPrep = (typeof meta.warpPreparationTurns === 'number' && meta.warpPreparationTurns >= 0) ? Math.max(0, Math.floor(meta.warpPreparationTurns)) : 2;
    
    console.log(`🌌 Processing warp order for ship ${order.object_id}: phase=${warpPhase}, prep=${preparationTurns}/${requiredPrep}`);
    
    if (warpPhase === 'preparing') {
        const newPreparationTurns = preparationTurns + 1;
        
        if (newPreparationTurns >= requiredPrep) {
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
                    
                    console.log(`⚡ Ship ${order.object_id} warp preparation: ${newPreparationTurns}/${requiredPrep} turns`);
                    
                    resolve({
                        objectId: order.object_id,
                        status: 'warp_preparing',
                        preparationTurns: newPreparationTurns,
                        message: `Warp drive charging: ${newPreparationTurns}/${requiredPrep} turns`
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
            metaObj.energy = Math.max(0, currentEnergy - ability.energyCost);
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
            const { Abilities: AB2 } = require('./abilities');
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
                    const { SHIP_BLUEPRINTS } = require('./blueprints');
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