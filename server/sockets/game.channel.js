const { AbilitiesService } = require('../services/game/abilities.service');
const { HarvestingService } = require('../services/game/harvesting.service');
const { MovementService } = require('../services/game/movement.service');
const { QueuedActionService } = require('../services/game/queued-action.service');
const { z } = require('zod');

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
    const queuedActions = new QueuedActionService(db);

    io.on('connection', (socket) => {
        require('../middleware/auth').guardSocket(socket, db);
        const { computePathBresenham } = require('../utils/path');
        const {LaneTravelService}=require('../services/game/lane-travel.service');
        const laneService=new LaneTravelService(db);
        const plannedRoutes=new Map();
        // Travel planning: returns naive ETA and risk pips for top routes (Phase 1 minimal)
        socket.on('travel:plan', async (payload, cb) => {
            try {
                if (!allow(socket, 'travel')) return cb && cb({ success:false, error:'rate_limited' });
                const { gameId, sectorId } = payload || {};
                let to=payload?.to;
                const controlledShip=await laneService.get('SELECT id,x,y,meta,sector_id FROM sector_objects WHERE id=?',[payload?.shipId]);
                if(controlledShip && payload?.targetObjectId)to=await laneService.destinationNear(controlledShip,Number(payload.targetObjectId));
                if(!controlledShip || !require('../utils/navigation').validPoint(to))return cb && cb({success:false,error:'invalid_destination'});
                const blockingTarget=await laneService.get('SELECT id FROM sector_objects WHERE sector_id=? AND x=? AND y=? AND id!=?',[sectorId,to.x,to.y,controlledShip.id]);
                if(blockingTarget)to=await laneService.destinationNear(controlledShip,blockingTarget.id);
                const from={x:controlledShip.x,y:controlledShip.y};
                const shipId = Number(payload?.shipId || 0);
                if (!gameId || !sectorId || !from || !to) return cb && cb({ success:false, error:'bad_request' });
                const currentTurn = await new Promise((resolve)=>db.get('SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [gameId], (e,r)=>resolve(r?.turn_number || 1)));
                const { LaneGraphService } = require('../services/world/lane-graph.service');
                const planner = new LaneGraphService(db);
                // Ship-specific warp speed multiplier (default 1)
                let warpMult = 1;
                if (shipId) {
                    try {
                        const shipRow = await new Promise((resolve)=>db.get('SELECT meta FROM sector_objects WHERE id = ?', [shipId], (e,r)=>resolve(r||null)));
                        const meta = shipRow?.meta ? JSON.parse(shipRow.meta) : {};
                        warpMult = Number(meta.warpSpeedMultiplier || meta.warpSpeed || 1) || 1;
                    } catch {}
                }
                const opts = { warpMult, impulseSpeed:Math.max(1,Number(JSON.parse(controlledShip.meta||'{}').movementSpeed)||1) };
                const single = await planner.planSingleLegRoutes(sectorId, from, to, opts);
                const multi = await planner.planDijkstraRoutes(sectorId, from, to, opts);
                // Merge and filter out degenerate routes (missing legs or all zero-length)
                const merged = [...single, ...multi];
                const isNonZero = (legs)=>Array.isArray(legs) && legs.some(L => Math.abs(Number(L.sEnd||0) - Number(L.sStart||0)) > 1e-6);
                const filtered = merged.filter(r => isNonZero(r.legs));
                // Prefer best ETAs overall; include top 3
                plannedRoutes.clear();
                const routes = filtered.sort((a,b)=>a.eta-b.eta).slice(0,3).map(r=>{const routeId=require('node:crypto').randomUUID();plannedRoutes.set(routeId,{legs:r.legs,dest:to,shipId,sectorId,gameId,turn:currentTurn,at:Date.now()});return {...r,routeId};});
                cb && cb({ success:true, routes, currentTurn });
            } catch (e) {
                cb && cb({ success:false, error:'server_error' });
            }
        });

        socket.on('travel:confirm',async(payload,cb)=>{
            if(!allow(socket,'travel'))return cb?.({success:false,error:'rate_limited'});
            const plan=plannedRoutes.get(payload?.routeId);
            if(!plan || Date.now()-plan.at>300000 || Number(payload.shipId)!==Number(plan.shipId) || Number(payload.sectorId)!==Number(plan.sectorId) || Number(payload.gameId)!==Number(plan.gameId))return cb?.({success:false,error:'route_expired_replan'});
            const current=await laneService.get('SELECT turn_number FROM turns WHERE game_id=? ORDER BY turn_number DESC LIMIT 1',[plan.gameId]);
            if(current?.turn_number!==plan.turn)return cb?.({success:false,error:'route_expired_replan'});
            if (payload?.queue) {
                try {
                    const queued = await queuedActions.enqueue({
                        gameId: plan.gameId,
                        shipId: plan.shipId,
                        actionType: 'warp.lane',
                        payload: { sectorId: plan.sectorId, legs: plan.legs, destination: plan.dest },
                        clientOrderId: payload.clientOrderId || null
                    });
                    plannedRoutes.delete(payload.routeId);
                    if (!queued.duplicate) io.to(`game-${plan.gameId}`).emit('queue:updated', { shipId: plan.shipId });
                    return cb?.({ success: true, queued: true, duplicate: queued.duplicate, order: queued.order });
                } catch (e) {
                    return cb?.({ success: false, error: e?.message || 'queue_warp_failed' });
                }
            }
            const result=await laneService.confirm(plan.shipId,plan.sectorId,plan.legs,plan.dest,plan.turn);
            plannedRoutes.delete(payload.routeId);cb?.(result);
        });
        socket.on('travel:start',async(payload,cb)=>{
            const row=await laneService.get("SELECT id FROM lane_itineraries WHERE ship_id=? AND status='active'",[payload.shipId]);
            cb?.(row?{success:true,started:true}:{success:false,error:'confirm_route_first'});
        });
        socket.on('travel:enter',(_payload,cb)=>cb?.({success:false,error:'confirm_route_first'}));
        for(const event of ['travel:cancel','travel:exit'])socket.on(event,async(payload,cb)=>{
            cb?.(await laneService.cancel(payload.shipId));
            socket.emit('travel:cancelled',{shipId:payload.shipId});
        });

        // Basic chat: game-wide, direct messages, and group channels (with persistence)
        socket.on('chat:send', async (msg, callback) => {
            try {
                const gameId = Number(msg.gameId);
                const fromUserId = Number(msg.fromUserId || socket.userId);
                const toUserId = msg.toUserId != null ? Number(msg.toUserId) : null;
                const channelId = msg.channelId != null ? Number(msg.channelId) : null;
                const text = String(msg.text || '').slice(0, 500);
                if (!gameId || !fromUserId || !text) {
                    socket.emit('chat:error', { message: 'Invalid chat payload' });
                    return callback && callback({ success: false, error: 'invalid_chat_payload' });
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
                callback && callback({ success: true, message: payload });
            } catch (e) {
                console.error('chat:send error:', e);
                socket.emit('chat:error', { message: 'Failed to send message' });
                callback && callback({ success: false, error: 'chat_send_failed' });
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
            if(socket.gameId) socket.leave(`game-${socket.gameId}`);
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

        socket.on('lock-turn', async (gameId,userId,turnNumber)=>{
            await laneService.run('INSERT OR REPLACE INTO turn_locks(game_id,user_id,turn_number,locked,locked_at) VALUES(?,?,?,?,?)',[gameId,userId,turnNumber,1,new Date().toISOString()]);
            io.to(`game-${gameId}`).emit('player-locked-turn',{userId,turnNumber});
            const counts=await laneService.get(`SELECT (SELECT COUNT(*) FROM game_players WHERE game_id=?) AS players,(SELECT COUNT(*) FROM turn_locks WHERE game_id=? AND turn_number=? AND locked=1) AS locked`,[gameId,gameId,turnNumber]);
            // Enqueue resolution after this command releases the connection lock.
            if(counts.players>0 && counts.players===counts.locked)void resolveTurn(gameId,turnNumber);
        });
        socket.on('unlock-turn', async(gameId,userId,turnNumber)=>{
            await laneService.run('INSERT OR REPLACE INTO turn_locks(game_id,user_id,turn_number,locked,locked_at) VALUES(?,?,?,?,?)',[gameId,userId,turnNumber,0,new Date().toISOString()]);
            io.to(`game-${gameId}`).emit('player-unlocked-turn',{userId,turnNumber});
        });

        const moveSchema = z.object({gameId:z.coerce.number().int().positive(),shipId:z.coerce.number().int().positive(),destinationX:z.number().int(),destinationY:z.number().int()});
        socket.on('move-ship', async(raw,cb)=>{
            if(!allow(socket,'move')) return socket.emit('error',{message:'rate_limited'});
            try {
                const p=moveSchema.parse(raw);
                const {NavigationService}=require('../services/game/navigation.service');
                const result=await new NavigationService(db).order(p.shipId,{x:p.destinationX,y:p.destinationY},{userId:socket.userId,gameId:p.gameId});
                socket.emit('movement-confirmed',result); if(typeof cb==='function')cb(result);
            } catch(e){socket.emit('error',{message:e.message});if(typeof cb==='function')cb({success:false,error:e.message});}
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
        socket.on('warp-ship', () => socket.emit('error',{message:'Use warp lane travel to choose a route.'}));

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
            actionType: z.string().min(1).optional(),
            // Kept temporarily so older clients can migrate without losing commands.
            orderType: z.string().min(1).optional(),
            payload: z.any().nullable().optional(),
            notBeforeTurn: z.coerce.number().int().nullable().optional(),
            clientOrderId: z.string().min(1).max(100).optional()
        });
        socket.on('queue-order', async (data, callback) => {
            if (!allow(socket, 'queue')) return callback && callback({ success: false, error: 'rate_limited' });
            const parsed = queueOrderSchema.safeParse(data);
            if (!parsed.success) return callback && callback({ success: false, error: 'invalid_queue_payload', issues: parsed.error.issues });
            try {
                const { gameId, shipId, payload, notBeforeTurn, clientOrderId } = parsed.data;
                const requestedType = parsed.data.actionType || parsed.data.orderType;
                const aliases = { move: 'movement.move', harvest_start: 'harvest.start', harvest_stop: 'harvest.stop', ability: 'combat.ability' };
                const actionType = aliases[requestedType] || requestedType;
                if (!gameId || !shipId || !actionType) return callback && callback({ success: false, error: 'missing_fields' });
                const ship = await new Promise((resolve) => db.get(
                    `SELECT so.owner_id, s.game_id
                     FROM sector_objects so JOIN sectors s ON s.id = so.sector_id
                     JOIN game_players gp ON gp.game_id = s.game_id AND gp.user_id = ?
                     WHERE so.id = ?`, [socket.userId, shipId], (e, r) => resolve(r)
                ));
                if (!ship || Number(ship.owner_id) !== Number(socket.userId)) return callback && callback({ success: false, error: 'not_owner' });
                if (Number(ship.game_id) !== Number(gameId)) return callback && callback({ success: false, error: 'wrong_game' });
                const result = await queuedActions.enqueue({ gameId, shipId, actionType, payload, notBeforeTurn, clientOrderId });
                metrics.queued++;
                callback && callback({ success: true, duplicate: result.duplicate, order: result.order });
                if (!result.duplicate) io.to(`game-${gameId}`).emit('queue:updated', { shipId });
            } catch (e) {
                callback && callback({ success: false, error: e?.message || 'server_error' });
            }
        });

        const queueListSchema = z.object({ gameId: z.coerce.number().int().positive(), shipId: z.coerce.number().int().positive(), history: z.boolean().optional() });
        socket.on('queue:list', async (data, callback) => {
            const parsed = queueListSchema.safeParse(data || {});
            if (!parsed.success) return callback && callback({ success: false, error: 'invalid_queue_list', issues: parsed.error.issues });
            try {
                const { gameId, shipId, history } = parsed.data;
                if (!gameId || !shipId) return callback && callback({ success: false, error: 'missing_fields' });
                const rows = await queuedActions.list(gameId, shipId, { history: Boolean(history) });
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
                const result = await queuedActions.cancel({ gameId, shipId });
                callback && callback({ success: true, changed: result.changed });
                io.to(`game-${gameId}`).emit('queue:updated', { shipId });
            } catch {
                callback && callback({ success: false, error: 'server_error' });
            }
        });

        socket.on('queue:replace', async (data, callback) => {
            const parsed = queueOrderSchema.safeParse(data || {});
            if (!parsed.success) return callback?.({ success: false, error: 'invalid_queue_replace', issues: parsed.error.issues });
            try {
                const { gameId, shipId, payload, clientOrderId } = parsed.data;
                const requestedType = parsed.data.actionType || parsed.data.orderType;
                const aliases = { move: 'movement.move', harvest_start: 'harvest.start', harvest_stop: 'harvest.stop', ability: 'combat.ability' };
                const actionType = aliases[requestedType] || requestedType;
                const result = await queuedActions.replace({ gameId, shipId, actionType, payload, clientOrderId });
                callback?.({ success: true, duplicate: result.duplicate, order: result.order });
                if (!result.duplicate) io.to(`game-${gameId}`).emit('queue:updated', { shipId });
            } catch (e) { callback?.({ success: false, error: e?.message || 'server_error' }); }
        });

        // Remove the last queued item (highest sequence_index) for a ship
        const queuePopSchema = z.object({ gameId: z.coerce.number().int().positive(), shipId: z.coerce.number().int().positive() });
        socket.on('queue:pop-last', async (data, callback) => {
            const parsed = queuePopSchema.safeParse(data || {});
            if (!parsed.success) return callback && callback({ success: false, error: 'invalid_queue_pop', issues: parsed.error.issues });
            try {
                const { gameId, shipId } = parsed.data;
                const row = await new Promise((resolve)=>db.get(
                    `SELECT id FROM queued_orders WHERE game_id = ? AND ship_id = ? AND status IN ('queued','waiting') ORDER BY sequence_index DESC, id DESC LIMIT 1`,
                    [gameId, shipId], (e, r)=>resolve(r||null)));
                if (!row) return callback && callback({ success: true, popped: false });
                await queuedActions.cancel({ gameId, shipId, id: row.id });
                callback && callback({ success: true, popped: true, id: row.id });
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
                const result = await queuedActions.cancel({ gameId, shipId, id });
                callback && callback({ success: true });
                io.to(`game-${gameId}`).emit('queue:updated', { shipId });
            } catch {
                callback && callback({ success: false, error: 'server_error' });
            }
        });

        socket.on('queue:actions', async (data, callback) => {
            try {
                const gameId = Number(data?.gameId || socket.gameId);
                const shipId = Number(data?.shipId);
                const ship = await new Promise((resolve) => db.get(
                    `SELECT so.* FROM sector_objects so JOIN sectors s ON s.id = so.sector_id WHERE so.id = ? AND s.game_id = ? AND so.type = 'ship'`,
                    [shipId, gameId], (e, r) => resolve(r || null)
                ));
                if (!ship) return callback?.({ success: false, error: 'ship_not_found' });
                callback?.({ success: true, actions: await queuedActions.registry.listForShip(ship) });
            } catch (e) { callback?.({ success: false, error: e?.message || 'server_error' }); }
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

        // Active lane transits in a sector for visualization
        const lanesActiveSchema = z.object({ sectorId: z.coerce.number().int().positive() });
        socket.on('lanes:active', async (raw, cb) => {
            try {
                const parsed = lanesActiveSchema.safeParse(raw || {});
                if (!parsed.success) return cb && cb({ success:false, error:'invalid_payload', issues: parsed.error.issues });
                const { sectorId } = parsed.data;
                const rows = await new Promise((resolve)=>db.all(
                    `SELECT lt.edge_id as edgeId, lt.ship_id as shipId, lt.progress as progress, lt.mode as mode, lt.merge_turns as mergeTurns
                     FROM lane_transits lt
                     WHERE lt.edge_id IN (SELECT id FROM lane_edges WHERE sector_id = ?)`,
                    [sectorId], (e, r)=>resolve(r||[])));
                cb && cb({ success:true, transits: rows });
            } catch (e) {
                cb && cb({ success:false, error:'server_error' });
            }
        });

        // Movement/warp status for a ship (for UI overlays)
        const movementStatusSchema = z.object({ shipId: z.coerce.number().int().positive() });
        socket.on('movement:status', async (raw, cb) => {
            try {
                const parsed = movementStatusSchema.safeParse(raw || {});
                if (!parsed.success) return cb && cb({ success:false, error:'invalid_payload', issues: parsed.error.issues });
                const { shipId } = parsed.data;
                const order = await new Promise((resolve)=>db.get(
                    `SELECT status, warp_preparation_turns as prep, meta
                     FROM movement_orders WHERE object_id = ?
                     AND status IN ('warp_preparing','active','blocked')
                     ORDER BY created_at DESC LIMIT 1`,
                    [shipId], (e,r)=>resolve(r||null)));
                if (!order) return cb && cb({ success:true, status:null });
                let required = 0; try { const m = order.meta?JSON.parse(order.meta):{}; if (typeof m.warpPreparationTurns==='number') required = Math.max(0, Math.floor(m.warpPreparationTurns)); } catch {}
                cb && cb({ success:true, status: order.status, preparationTurns: Number(order.prep||0), requiredPreparationTurns: required });
            } catch (e) {
                cb && cb({ success:false, error:'server_error' });
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
