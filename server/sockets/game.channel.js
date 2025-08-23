const { AbilitiesService } = require('../services/game/abilities.service');
const { HarvestingService } = require('../services/game/harvesting.service');
const { MovementService } = require('../services/game/movement.service');
const { z } = require('zod');

// Keep queue size policy near socket layer for now
const MAX_QUEUED_ORDERS_PER_SHIP = 5;

function registerGameChannel({ io, db, resolveTurn }) {
    if (!io || !db) throw new Error('registerGameChannel requires io and db');

    // Simple in-memory rate limits per socket
    const RATE_LIMITS = {
        move: { windowMs: 2000, max: 8 },
        warp: { windowMs: 2000, max: 4 },
        ability: { windowMs: 2000, max: 12 },
        queue: { windowMs: 2000, max: 20 },
        travel: { windowMs: 5000, max: 6 },
        chat: { windowMs: 2000, max: 20 }
    };
    const counters = new WeakMap();
    function allow(socket, bucket) {
        const now = Date.now();
        let state = counters.get(socket);
        if (!state) { state = {}; counters.set(socket, state); }
        const cfg = RATE_LIMITS[bucket];
        if (!cfg) return true;
        let b = state[bucket];
        if (!b || (now - b.start) > cfg.windowMs) { b = { start: now, count: 0 }; state[bucket] = b; }
        if (b.count >= cfg.max) return false;
        b.count++;
        return true;
    }

    // Basic metrics
    const metrics = { moves: 0, warps: 0, abilities: 0, queued: 0, travels: 0 };

    io.on('connection', (socket) => {
        // Basic chat: game-wide, direct messages, and group channels (with persistence)
        socket.on('chat:send', async (msg) => {
            try {
                const gameId = Number(msg.gameId);
                const fromUserId = Number(msg.fromUserId || socket.userId);
                const toUserId = msg.toUserId != null ? Number(msg.toUserId) : null;
                const channelId = msg.channelId != null ? Number(msg.channelId) : null;
                const text = String(msg.text || '').slice(0, 500);
                if (!gameId || !fromUserId || !text) {
                    return socket.emit('chat:error', { message: 'Invalid chat payload' });
                }

                const fromUsername = await new Promise((resolve) => {
                    db.get('SELECT username FROM users WHERE id = ?', [fromUserId], (err, row) => resolve(row?.username || null));
                });
                const toUsername = toUserId ? await new Promise((resolve) => {
                    db.get('SELECT username FROM users WHERE id = ?', [toUserId], (err, row) => resolve(row?.username || null));
                }) : null;

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

        socket.on('join-game', (gameId, userId) => {
            socket.join(`game-${gameId}`);
            socket.gameId = gameId;
            socket.userId = userId;
            if (userId) socket.join(`user-${userId}`);
            console.log(`👤 Player ${userId} joined game ${gameId} room`);
            if (userId) {
                const now = new Date().toISOString();
                db.run('UPDATE users SET last_seen_at = ?, last_activity_at = ? WHERE id = ?', [now, now, userId], () => {});
            }
            sendGameStatusUpdate({ gameId, userId, socket });
        });

        socket.on('client:activity', () => {
            if (!socket.userId) return;
            db.run('UPDATE users SET last_activity_at = ? WHERE id = ?', [new Date().toISOString(), socket.userId], () => {});
        });

        socket.on('players:list', async (payload, callback) => {
            try {
                const gameId = payload?.gameId || socket.gameId;
                if (!gameId) return callback && callback({ success: false, error: 'Missing gameId' });

                const currentTurn = await new Promise((resolve) => {
                    db.get('SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [gameId], (err, row) => resolve(row?.turn_number || 1));
                });
                const players = await new Promise((resolve) => {
                    db.all(
                        `SELECT gp.user_id as userId, u.username, u.last_seen_at as lastSeenAt, u.last_activity_at as lastActivityAt, gp.avatar, gp.color_primary as colorPrimary, gp.color_secondary as colorSecondary
                         FROM game_players gp 
                         LEFT JOIN users u ON gp.user_id = u.id 
                         WHERE gp.game_id = ?`,
                        [gameId],
                        (err, rows) => resolve(rows || [])
                    );
                });
                const lockedSet = new Set(
                    await new Promise((resolve) => {
                        db.all('SELECT user_id FROM turn_locks WHERE game_id = ? AND turn_number = ? AND locked = 1', [gameId, currentTurn], (err, rows) => resolve((rows || []).map(r => r.user_id)));
                    })
                );
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

        socket.on('lock-turn', async (gameId, userId, turnNumber) => {
            try {
                db.run(
                    'INSERT OR REPLACE INTO turn_locks (game_id, user_id, turn_number, locked, locked_at) VALUES (?, ?, ?, ?, ?)',
                    [gameId, userId, turnNumber, true, new Date().toISOString()],
                    () => {
                        io.to(`game-${gameId}`).emit('player-locked-turn', { userId, turnNumber, message: `Player ${userId} has locked their turn ${turnNumber}` });
                        checkTurnResolution({ gameId, turnNumber });
                    }
                );
            } catch (error) {
                socket.emit('error', { message: 'Failed to lock turn' });
            }
        });

        socket.on('unlock-turn', async (gameId, userId, turnNumber) => {
            try {
                db.get('SELECT status FROM turns WHERE game_id = ? AND turn_number = ?', [gameId, turnNumber], (err, row) => {
                    if (err || !row) { socket.emit('error', { message: 'Failed to unlock turn' }); return; }
                    if (row.status !== 'waiting') { socket.emit('error', { message: 'Turn already resolving or completed' }); return; }
                    db.run(
                        'INSERT OR REPLACE INTO turn_locks (game_id, user_id, turn_number, locked, locked_at) VALUES (?, ?, ?, ?, ?)',
                        [gameId, userId, turnNumber, false, new Date().toISOString()],
                        () => {
                            io.to(`game-${gameId}`).emit('player-unlocked-turn', { userId, turnNumber, message: `Player ${userId} has unlocked their turn ${turnNumber}` });
                        }
                    );
                });
            } catch (error) {
                socket.emit('error', { message: 'Failed to unlock turn' });
            }
        });

        const moveSchema = z.object({
            gameId: z.coerce.number().int().positive(),
            shipId: z.coerce.number().int().positive(),
            currentX: z.number().int().optional(),
            currentY: z.number().int().optional(),
            destinationX: z.number().int(),
            destinationY: z.number().int(),
            movementPath: z.array(z.object({ x: z.number().int(), y: z.number().int() })).min(1)
        });
        socket.on('move-ship', (raw) => {
            if (!allow(socket, 'move')) return socket.emit('error', { message: 'rate_limited' });
            const parsed = moveSchema.safeParse(raw);
            if (!parsed.success) return socket.emit('error', { message: 'invalid_move_payload', issues: parsed.error.issues });
            const { gameId, shipId, currentX, currentY, destinationX, destinationY, movementPath } = parsed.data;
            db.get('SELECT x, y, meta FROM sector_objects WHERE id = ?', [shipId], (err, ship) => {
                if (err || !ship) return socket.emit('error', { message: 'Ship not found' });
                const meta = JSON.parse(ship.meta || '{}');
                const movementSpeed = meta.movementSpeed || 1;
                const pathLength = movementPath ? movementPath.length - 1 : 0;
                const actualETA = Math.ceil(pathLength / movementSpeed);
                const serverX = ship.x, serverY = ship.y;
                if (currentX !== undefined && currentY !== undefined) {
                    const positionDiff = Math.abs(serverX - currentX) + Math.abs(serverY - currentY);
                    if (positionDiff > 0) {
                        console.log(`⚠️ Position desync detected: Ship ${shipId} server:(${serverX},${serverY}) vs client:(${currentX},${currentY}) diff:${positionDiff}`);
                    }
                }
                db.run('DELETE FROM movement_orders WHERE object_id = ? AND status IN ("active", "blocked")', [shipId], function(err2){
                    if (err2) return socket.emit('error', { message: 'Failed to cancel previous movement order' });
                    const orderTimestamp = new Date().toISOString();
                    db.run(
                        `INSERT INTO movement_orders (object_id, destination_x, destination_y, movement_speed, eta_turns, movement_path, current_step, status, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [shipId, destinationX, destinationY, movementSpeed, actualETA, JSON.stringify(movementPath || []), 0, 'active', orderTimestamp],
                        (err3) => {
                            if (err3) return socket.emit('error', { message: 'Failed to store movement order' });
                            socket.emit('movement-confirmed', { shipId, destinationX, destinationY, pathLength, estimatedTurns: actualETA, message: `Movement order confirmed: ${pathLength} tiles, ETA ${actualETA} turns` });
                            socket.to(`game-${gameId}`).emit('ship-movement-ordered', { shipId, destinationX, destinationY, pathLength, estimatedTurns: actualETA, userId: socket.userId });
                        }
                    );
                });
            });
        });

        const warpSchema = z.object({
            gameId: z.coerce.number().int().positive(),
            shipId: z.coerce.number().int().positive(),
            targetId: z.coerce.number().int().nullable().optional(),
            targetX: z.number().int(),
            targetY: z.number().int(),
            shipName: z.string().optional(),
            targetName: z.string().optional()
        });
        socket.on('warp-ship', async (raw) => {
            if (!allow(socket, 'warp')) return socket.emit('error', { message: 'rate_limited' });
            const parsed = warpSchema.safeParse(raw);
            if (!parsed.success) return socket.emit('error', { message: 'invalid_warp_payload', issues: parsed.error.issues });
            const { gameId, shipId, targetId, targetX, targetY, shipName, targetName } = parsed.data;
            try {
                const svc = new MovementService();
                const result = await svc.createWarpOrder({ gameId, shipId, targetId, targetX, targetY, shipName, targetName });
                if (!result.success) return socket.emit('error', { message: result.error || 'Failed to store warp order' });
                metrics.warps++;
                const requiredPrep = result.requiredPrep;
                socket.emit('warp-confirmed', { shipId, targetId, targetName, targetX, targetY, phase: 'preparing', preparationTurns: 0, requiredPreparationTurns: requiredPrep, message: `Warp drive engaging. Preparation: 0/${requiredPrep} turns` });
                socket.to(`game-${gameId}`).emit('ship-warp-ordered', { shipId, shipName, targetName, targetX, targetY, phase: 'preparing', userId: socket.userId });
            } catch (err) {
                socket.emit('error', { message: 'Failed to store warp order' });
            }
        });

        const harvestStartSchema = z.object({
            gameId: z.coerce.number().int().positive(),
            shipId: z.coerce.number().int().positive(),
            resourceNodeId: z.coerce.number().int().positive()
        });
        socket.on('start-harvesting', async (raw) => {
            const parsed = harvestStartSchema.safeParse(raw);
            if (!parsed.success) return socket.emit('harvesting-error', { error: 'invalid_start_payload', issues: parsed.error.issues });
            const { gameId, shipId, resourceNodeId } = parsed.data;
            try {
                const svc = new HarvestingService();
                const result = await svc.startHarvesting({ gameId, shipId, resourceNodeId });
                if (result.success) {
                    socket.emit('harvesting-started', { shipId, resourceNodeId, harvestRate: result.harvestRate, resourceType: result.resourceType, message: `Started harvesting ${result.resourceType} at ${result.harvestRate}/turn` });
                    socket.to(`game-${gameId}`).emit('ship-harvesting-started', { shipId, resourceNodeId, resourceType: result.resourceType, userId: socket.userId });
                } else {
                    socket.emit('harvesting-error', { shipId, error: result.error });
                }
            } catch (error) {
                socket.emit('harvesting-error', { shipId, error: 'Server error starting harvesting operation' });
            }
        });

        const queueOrderSchema = z.object({
            gameId: z.coerce.number().int().positive(),
            shipId: z.coerce.number().int().positive(),
            orderType: z.enum(['move','warp','harvest_start','harvest_stop']),
            payload: z.any().nullable().optional(),
            notBeforeTurn: z.number().int().nullable().optional()
        });
        socket.on('queue-order', async (data, callback) => {
            if (!allow(socket, 'queue')) return callback && callback({ success: false, error: 'rate_limited' });
            const parsed = queueOrderSchema.safeParse(data);
            if (!parsed.success) return callback && callback({ success: false, error: 'invalid_queue_payload', issues: parsed.error.issues });
            try {
                const { gameId, shipId, orderType, payload, notBeforeTurn } = parsed.data;
                if (!gameId || !shipId || !orderType) return callback && callback({ success: false, error: 'missing_fields' });
                const ship = await new Promise((resolve) => db.get('SELECT owner_id FROM sector_objects WHERE id = ?', [shipId], (e, r) => resolve(r)));
                if (!ship || Number(ship.owner_id) !== Number(socket.userId)) return callback && callback({ success: false, error: 'not_owner' });
                const queuedCount = await new Promise((resolve) => db.get('SELECT COUNT(1) as c FROM queued_orders WHERE ship_id = ? AND status = "queued"', [shipId], (e, r) => resolve(r?.c || 0)));
                if (queuedCount >= MAX_QUEUED_ORDERS_PER_SHIP) return callback && callback({ success: false, error: 'queue_full' });
                const seqRow = await new Promise((resolve) => db.get('SELECT COALESCE(MAX(sequence_index), 0) as maxSeq FROM queued_orders WHERE ship_id = ?', [shipId], (e, r) => resolve(r)));
                const nextSeq = Number(seqRow?.maxSeq || 0) + 1;
                await new Promise((resolve, reject) => db.run(
                    `INSERT INTO queued_orders (game_id, ship_id, sequence_index, order_type, payload, not_before_turn, status, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
                    [gameId, shipId, nextSeq, String(orderType), payload ? JSON.stringify(payload) : null, (typeof notBeforeTurn === 'number' ? notBeforeTurn : null), new Date().toISOString()],
                    (err) => err ? reject(err) : resolve()
                ));
                metrics.queued++;
                callback && callback({ success: true });
                io.to(`game-${gameId}`).emit('queue:updated', { shipId });
            } catch (e) {
                callback && callback({ success: false, error: 'server_error' });
            }
        });

        const queueListSchema = z.object({ gameId: z.coerce.number().int().positive(), shipId: z.coerce.number().int().positive() });
        socket.on('queue:list', async (data, callback) => {
            const parsed = queueListSchema.safeParse(data || {});
            if (!parsed.success) return callback && callback({ success: false, error: 'invalid_queue_list', issues: parsed.error.issues });
            try {
                const { gameId, shipId } = parsed.data;
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
            const parsed = queueListSchema.safeParse(data || {});
            if (!parsed.success) return callback && callback({ success: false, error: 'invalid_queue_clear', issues: parsed.error.issues });
            try {
                const { gameId, shipId } = parsed.data;
                if (!gameId || !shipId) return callback && callback({ success: false, error: 'missing_fields' });
                await new Promise((resolve) => db.run(`UPDATE queued_orders SET status = 'cancelled' WHERE game_id = ? AND ship_id = ? AND status = 'queued'`, [gameId, shipId], () => resolve()));
                callback && callback({ success: true });
                io.to(`game-${gameId}`).emit('queue:updated', { shipId });
            } catch {
                callback && callback({ success: false, error: 'server_error' });
            }
        });

        const queueRemoveSchema = z.object({ gameId: z.coerce.number().int().positive(), shipId: z.coerce.number().int().positive(), id: z.coerce.number().int().positive() });
        socket.on('queue:remove', async (data, callback) => {
            const parsed = queueRemoveSchema.safeParse(data || {});
            if (!parsed.success) return callback && callback({ success: false, error: 'invalid_queue_remove', issues: parsed.error.issues });
            try {
                const { gameId, shipId, id } = parsed.data;
                if (!gameId || !shipId || !id) return callback && callback({ success: false, error: 'missing_fields' });
                await new Promise((resolve) => db.run(`UPDATE queued_orders SET status = 'cancelled' WHERE id = ? AND game_id = ? AND ship_id = ? AND status = 'queued'`, [id, gameId, shipId], () => resolve()));
                callback && callback({ success: true });
                io.to(`game-${gameId}`).emit('queue:updated', { shipId });
            } catch {
                callback && callback({ success: false, error: 'server_error' });
            }
        });

        socket.on('attack-target', async () => {
            socket.emit('combat:error', { error: 'Use abilities to attack (activate-ability)' });
        });

        const abilitySchema = z.object({
            gameId: z.coerce.number().int().positive(),
            casterId: z.coerce.number().int().positive(),
            abilityKey: z.string().min(1),
            targetObjectId: z.coerce.number().int().optional(),
            targetX: z.number().int().optional(),
            targetY: z.number().int().optional(),
            params: z.any().optional()
        });
        socket.on('activate-ability', async (raw) => {
            if (!allow(socket, 'ability')) return socket.emit('ability:error', { error: 'rate_limited' });
            const parsed = abilitySchema.safeParse(raw || {});
            if (!parsed.success) return socket.emit('ability:error', { error: 'invalid_ability_payload', issues: parsed.error.issues });
            const { gameId, casterId, abilityKey, targetObjectId, targetX, targetY, params } = parsed.data;
            try {
                if (!gameId || !casterId || !abilityKey) return socket.emit('ability:error', { error: 'Missing gameId/casterId/abilityKey' });
                const caster = await new Promise((resolve) => db.get('SELECT owner_id FROM sector_objects WHERE id = ?', [casterId], (err, row) => resolve(row)));
                if (!caster) return socket.emit('ability:error', { error: 'Caster not found' });
                if (Number(caster.owner_id) !== Number(socket.userId)) return socket.emit('ability:error', { error: 'Caster not owned by player' });
                const svc = new AbilitiesService();
                const result = await svc.queueAbility({ gameId, casterId, abilityKey, targetObjectId, targetX, targetY, params });
                if (!result.success) return socket.emit('ability:error', { error: result.error });
                metrics.abilities++;
                socket.emit('ability-queued', { casterId, abilityKey, turnNumber: result.turnNumber });
            } catch (e) {
                socket.emit('ability:error', { error: 'Failed to queue ability' });
            }
        });

        // Interstellar travel via sockets (optional parity with HTTP route)
        const gateTravelSchema = z.object({
            shipId: z.coerce.number().int().positive(),
            gateId: z.coerce.number().int().positive(),
            userId: z.coerce.number().int().positive(),
            gameId: z.coerce.number().int().positive()
        });
        socket.on('interstellar:travel', async (raw) => {
            if (!allow(socket, 'travel')) return socket.emit('travel:error', { error: 'rate_limited' });
            const parsed = gateTravelSchema.safeParse(raw || {});
            if (!parsed.success) return socket.emit('travel:error', { error: 'invalid_travel_payload', issues: parsed.error.issues });
            const { shipId, gateId, userId, gameId } = parsed.data;
            try {
                // Ownership check
                const ship = await new Promise((resolve) => db.get('SELECT owner_id FROM sector_objects WHERE id = ?', [shipId], (e, r) => resolve(r)));
                if (!ship || Number(ship.owner_id) !== Number(socket.userId)) return socket.emit('travel:error', { error: 'not_owner' });
                const svc = new MovementService();
                const result = await svc.teleportThroughGate({ shipId, gateId, userId });
                if (!result.success) return socket.emit('travel:error', { error: result.error });
                metrics.travels++;
                socket.emit('interstellar:traveled', { shipId, newSectorId: result.destinationSectorId, newX: result.newX, newY: result.newY });
                socket.to(`game-${gameId}`).emit('interstellar:ship-traveled', { shipId, userId: socket.userId, newSectorId: result.destinationSectorId });
            } catch (e) {
                socket.emit('travel:error', { error: 'server_error' });
            }
        });

        socket.on('stop-harvesting', async (data) => {
            const { gameId, shipId } = data;
            try {
                const svc = new HarvestingService();
                const result = await svc.stopHarvesting({ shipId });
                if (result.success) {
                    socket.emit('harvesting-stopped', { shipId, totalHarvested: result.totalHarvested, resourceType: result.resourceType, message: `Stopped harvesting. Total collected: ${result.totalHarvested} ${result.resourceType}` });
                    socket.to(`game-${gameId}`).emit('ship-harvesting-stopped', { shipId, userId: socket.userId });
                } else {
                    socket.emit('harvesting-error', { shipId, error: result.error });
                }
            } catch (error) {
                socket.emit('harvesting-error', { shipId, error: 'Server error stopping harvesting operation' });
            }
        });

        socket.on('disconnect', () => {
            if (socket.userId) db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [new Date().toISOString(), socket.userId], () => {});
        });
    });

    function sendGameStatusUpdate({ gameId, userId, socket }) {
        db.get('SELECT * FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [gameId], (err, currentTurn) => {
            if (err || !currentTurn) return;
            db.get('SELECT locked FROM turn_locks WHERE game_id = ? AND user_id = ? AND turn_number = ?', [gameId, userId, currentTurn.turn_number], (err2, lockStatus) => {
                if (err2) return;
                socket.emit('game-status-update', {
                    currentTurn: currentTurn.turn_number,
                    turnStatus: currentTurn.status,
                    playerLocked: lockStatus?.locked || false,
                    message: `Welcome back! Current turn: ${currentTurn.turn_number}`
                });
            });
        });
    }

    function checkTurnResolution({ gameId, turnNumber }) {
        db.all('SELECT gp.user_id FROM game_players gp WHERE gp.game_id = ?', [gameId], (err, allPlayers) => {
            if (err) return;
            db.all('SELECT user_id FROM turn_locks WHERE game_id = ? AND turn_number = ? AND locked = 1', [gameId, turnNumber], (err2, lockedPlayers) => {
                if (err2) return;
                if (lockedPlayers.length === allPlayers.length) {
                    resolveTurn(gameId, turnNumber);
                }
            });
        });
    }
}

module.exports = { registerGameChannel };


