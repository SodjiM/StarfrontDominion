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
        // Travel planning: returns naive ETA and risk pips for top routes (Phase 1 minimal)
        socket.on('travel:plan', async (payload, cb) => {
            try {
                if (!allow(socket, 'travel')) return cb && cb({ success:false, error:'rate_limited' });
                const { gameId, sectorId, from, to } = payload || {};
                if (!gameId || !sectorId || !from || !to) return cb && cb({ success:false, error:'bad_request' });
                const currentTurn = await new Promise((resolve)=>db.get('SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [gameId], (e,r)=>resolve(r?.turn_number || 1)));
                const { LaneGraphService } = require('../services/world/lane-graph.service');
                const planner = new LaneGraphService(db);
                const single = await planner.planSingleLegRoutes(sectorId, from, to);
                const multi = await planner.planDijkstraRoutes(sectorId, from, to);
                // Merge, prefer best ETAs overall; include top 3
                const routes = [...single, ...multi].sort((a,b)=>a.eta-b.eta).slice(0,3);
                cb && cb({ success:true, routes, currentTurn });
            } catch (e) {
                cb && cb({ success:false, error:'server_error' });
            }
        });

        // Travel enter: queue at tap or attempt wildcat merge
        socket.on('travel:enter', async (payload, cb) => {
            try {
                if (!allow(socket, 'travel')) return cb && cb({ success:false, error:'rate_limited' });
                const { sectorId, edgeId, mode, shipId, tapId } = payload || {};
                if (!sectorId || !edgeId || !shipId) return cb && cb({ success:false, error:'bad_request' });
                if (mode === 'tap') {
                    // Read CU from ship class (default 1 CU)
                    const ship = await new Promise((resolve)=>db.get('SELECT id, meta FROM sector_objects WHERE id = ?', [shipId], (e,r)=>resolve(r||null)));
                    let cu = 1; try { const m = ship?.meta?JSON.parse(ship.meta):{}; cu = Number(m.convoyUnits||1); } catch {}
                    const targetTap = tapId ? await new Promise((resolve)=>db.get('SELECT id FROM lane_taps WHERE id = ? AND edge_id = ?', [tapId, edgeId], (e,r)=>resolve(r||null))) : await new Promise((resolve)=>db.get('SELECT id FROM lane_taps WHERE edge_id = ? ORDER BY id ASC LIMIT 1', [edgeId], (e,r)=>resolve(r||null)));
                    if (!targetTap) return cb && cb({ success:false, error:'tap_not_found' });
                    // Determine current turn and slot math for ETA
                    const sector = await new Promise((resolve)=>db.get('SELECT game_id FROM sectors WHERE id = ?', [sectorId], (e,r)=>resolve(r||null)));
                    const gameId = Number(sector?.game_id || 0);
                    const currentTurn = gameId ? await new Promise((resolve)=>db.get('SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [gameId], (e,r)=>resolve(r?.turn_number || 1))) : 1;
                    const edge = await new Promise((resolve)=>db.get('SELECT lane_speed, headway FROM lane_edges WHERE id = ?', [edgeId], (e,r)=>resolve(r||null)));
                    const slotsPerTurn = Math.max(0, Math.floor(Number(edge?.lane_speed || 0) / Math.max(1, Number(edge?.headway || 40))));
                    const slotCapacityCU = 2; // design constant
                    const ahead = await new Promise((resolve)=>db.get(`SELECT COALESCE(SUM(cu), 0) as cu FROM lane_tap_queue WHERE tap_id = ? AND status = 'queued'`, [targetTap.id], (e,r)=>resolve(Number(r?.cu || 0))));
                    const queueEtaTurns = slotsPerTurn > 0 ? Math.ceil((ahead + cu) / (slotsPerTurn * slotCapacityCU)) : 1;
                    await new Promise((resolve)=>db.run(
                        `INSERT INTO lane_tap_queue (tap_id, ship_id, cu, enqueued_turn, status) VALUES (?, ?, ?, ?, 'queued')`,
                        [targetTap.id, shipId, cu, Number(currentTurn)], ()=>resolve()));
                    return cb && cb({ success:true, queued:true, queueEtaTurns });
                } else if (mode === 'wildcat') {
                    // Wildcat merge envelope: distance-only, health/load restrictions, mishap
                    const ship = await new Promise((resolve)=>db.get('SELECT id, x, y, meta FROM sector_objects WHERE id = ?', [shipId], (e,r)=>resolve(r||null)));
                    if (!ship) return cb && cb({ success:false, error:'ship_not_found' });
                    const edge = await new Promise((resolve)=>db.get('SELECT id, region_id, polyline_json, width_core, width_shoulder, lane_speed, cap_base, headway FROM lane_edges WHERE id = ?', [edgeId], (e,r)=>resolve(r||null)));
                    if (!edge) return cb && cb({ success:false, error:'edge_not_found' });
                    const pts = (()=>{ try { return JSON.parse(edge.polyline_json||'[]'); } catch { return []; } })();
                    if (pts.length < 2) return cb && cb({ success:false, error:'bad_edge' });
                    // Capacity/load (rho)
                    const healthRow = await new Promise((resolve)=>db.get('SELECT health FROM regions WHERE sector_id = ? AND region_id = ?', [sectorId, String(edge.region_id)], (e,r)=>resolve(r||{health:50})));
                    const health = Number(healthRow?.health || 50);
                    const healthMult = health>=80?1.25:(health>=60?1.0:0.7);
                    const cap = Math.max(1, Math.floor(Number(edge.cap_base) * (Number(edge.width_core)/150) * healthMult));
                    const runtime = await new Promise((resolve)=>db.get('SELECT load_cu FROM lane_edges_runtime WHERE edge_id = ?', [edgeId], (er, r)=>resolve(r||{load_cu:0})));
                    const loadCU = Number(runtime.load_cu || 0);
                    const rho = loadCU / Math.max(1, cap);
                    if (rho >= 1.2) return cb && cb({ success:false, error:'over_capacity', rho });
                    // Geometry helpers
                    const projectToSegment = (p,a,b)=>{
                        const apx=p.x-a.x, apy=p.y-a.y; const abx=b.x-a.x, aby=b.y-a.y;
                        const ab2=abx*abx+aby*aby; const t=Math.max(0, Math.min(1, (apx*abx+apy*aby)/Math.max(1e-6,ab2)));
                        return { x:a.x+abx*t, y:a.y+aby*t, t, tx:abx/Math.sqrt(Math.max(1e-6,ab2)), ty:aby/Math.sqrt(Math.max(1e-6,ab2)) };
                    };
                    const p = { x: ship.x, y: ship.y };
                    let best = { d: Infinity, proj:null };
                    for (let i=1;i<pts.length;i++) {
                        const pr = projectToSegment(p, pts[i-1], pts[i]);
                        const d = Math.hypot(p.x-pr.x, p.y-pr.y);
                        if (d < best.d) best = { d, proj: pr };
                    }
                    const dMin = best.d; const dMax = 300; if (dMin > dMax) return cb && cb({ success:false, error:'out_of_envelope' });
                    // Envelope numbers
                    const cu = (()=>{ try { const m = ship.meta?JSON.parse(ship.meta):{}; return Number(m.convoyUnits||1); } catch { return 1; } })();
                    const base = 1; const k_d = 0.01;
                    let T_merge = base + k_d * Math.max(0, dMin - Number(edge.width_core||0));
                    // Health modifier
                    T_merge *= (health>=60?0.8:(health<=40?1.25:1.0));
                    // Congestion surcharge when rho>1
                    if (rho > 1) T_merge += Math.max(0.5, (rho-1) * 1.0);
                    const mishapBase = 0.05, m_d = 0.10;
                    let mishap = mishapBase + m_d*(dMin/dMax);
                    if (rho > 1) mishap += 0.10; // under load, riskier
                    mishap = Math.max(0, Math.min(0.4, mishap));
                    const mergeTurns = Math.max(1, Math.round(T_merge));
                    // Random mishap roll: bounce (delay)
                    if (Math.random() < mishap) {
                        return cb && cb({ success:false, error:'mishap', mishap:true, delay:1, mishapChance:mishap, mergeTurns });
                    }
                    // Normalize sStart/sEnd to param fraction if itinerary exists
                    let metaJson = { dMin, rho, mishapChance:mishap };
                    try {
                        const itin = await new Promise((resolve)=>db.get(
                            `SELECT itinerary_json FROM lane_itineraries WHERE ship_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
                            [shipId], (er, r)=>resolve(r||null)));
                        if (itin) {
                            let legs = []; try { legs = JSON.parse(itin.itinerary_json||'[]'); } catch {}
                            const leg = legs.find(L => !L.done && Number(L.edgeId) === Number(edgeId) && String(L.entry) === 'wildcat');
                            if (leg) {
                                let total = 1; if (pts.length>1) { let d=0; for(let i=1;i<pts.length;i++){ d+=Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y); } total = Math.max(1, d); }
                                metaJson.targetStartP = Math.max(0, Math.min(1, Number(leg.sStart||0) / total));
                                metaJson.targetEndP = Math.max(0, Math.min(1, Number(leg.sEnd||total) / total));
                            }
                        }
                    } catch {}
                    await new Promise((resolve)=>db.run(
                        `INSERT INTO lane_transits (edge_id, ship_id, direction, progress, cu, mode, merge_turns, entered_turn, meta)
                         VALUES (?, ?, 1, ?, ?, 'shoulder', ?, 0, ?)`,
                        [edgeId, shipId, (typeof metaJson.targetStartP==='number'?metaJson.targetStartP:0.0), cu, mergeTurns, JSON.stringify(metaJson)], ()=>resolve()));
                    await new Promise((resolve)=>db.run(`UPDATE lane_edges_runtime SET load_cu = load_cu + ? WHERE edge_id = ?`, [cu, edgeId], ()=>resolve()));
                    return cb && cb({ success:true, entered:true, mergeTurns, mishapChance:mishap, rho });
                } else {
                    return cb && cb({ success:false, error:'bad_mode' });
                }
            } catch (e) {
                cb && cb({ success:false, error:'server_error' });
            }
        });

        // Confirm a planned route: minimal single-leg itinerary persistence
        const travelConfirmSchema = z.object({
            gameId: z.coerce.number().int().positive(),
            sectorId: z.coerce.number().int().positive(),
            shipId: z.coerce.number().int().positive(),
            freshnessTurns: z.number().int().min(1).max(6).optional(),
            leg: z.object({
                edgeId: z.coerce.number().int().positive(),
                entry: z.enum(['tap','wildcat']),
                sStart: z.number(),
                sEnd: z.number(),
                mergeTurns: z.number().int().optional(),
                tapId: z.coerce.number().int().optional()
            }).optional(),
            legs: z.array(z.object({
                edgeId: z.coerce.number().int().positive(),
                entry: z.enum(['tap','wildcat']),
                sStart: z.number(),
                sEnd: z.number(),
                mergeTurns: z.number().int().optional(),
                tapId: z.coerce.number().int().optional()
            })).optional()
        });
        socket.on('travel:confirm', async (raw, cb) => {
            try {
                if (!allow(socket, 'travel')) return cb && cb({ success:false, error:'rate_limited' });
                const parsed = travelConfirmSchema.safeParse(raw || {});
                if (!parsed.success) return cb && cb({ success:false, error:'invalid_confirm_payload', issues: parsed.error.issues });
                const { gameId, sectorId, shipId, freshnessTurns, leg, legs } = parsed.data;
                // Ownership check
                const ship = await new Promise((resolve)=>db.get('SELECT owner_id, sector_id FROM sector_objects WHERE id = ?', [shipId], (e,r)=>resolve(r||null)));
                if (!ship) return cb && cb({ success:false, error:'ship_not_found' });
                if (Number(ship.owner_id) !== Number(socket.userId)) return cb && cb({ success:false, error:'not_owner' });
                if (Number(ship.sector_id) !== Number(sectorId)) return cb && cb({ success:false, error:'wrong_sector' });
                // Validate edge belongs to sector
                const legsArr = Array.isArray(legs) && legs.length ? legs : [leg];
                if (!Array.isArray(legsArr) || !legsArr.length) return cb && cb({ success:false, error:'no_legs' });
                const firstEdgeId = Number(legsArr[0].edgeId);
                const edge = await new Promise((resolve)=>db.get('SELECT id FROM lane_edges WHERE id = ? AND sector_id = ?', [firstEdgeId, sectorId], (e,r)=>resolve(r||null)));
                if (!edge) return cb && cb({ success:false, error:'edge_not_in_sector' });
                // Freshness baseline
                const currentTurn = await new Promise((resolve)=>db.get('SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [gameId], (e,r)=>resolve(r?.turn_number || 1)));
                const itinerary = legsArr.map(L => ({ edgeId: Number(L.edgeId), entry: L.entry, sStart: Number(L.sStart), sEnd: Number(L.sEnd), mergeTurns: (typeof L.mergeTurns==='number'?Number(L.mergeTurns):undefined), tapId: (typeof L.tapId==='number'?Number(L.tapId):undefined), done: false }));
                const fresh = Math.max(1, Math.min(6, Number(freshnessTurns || 3)));
                await new Promise((resolve, reject)=>db.run(
                    `INSERT INTO lane_itineraries (ship_id, sector_id, created_turn, freshness_turns, status, itinerary_json)
                     VALUES (?, ?, ?, ?, 'active', ?)`,
                    [shipId, sectorId, Number(currentTurn), fresh, JSON.stringify(itinerary)],
                    (err)=> err ? reject(err) : resolve()
                ));
                cb && cb({ success:true, stored:true, legs: itinerary.length, itinerary, createdTurn: Number(currentTurn), freshnessTurns: fresh });
            } catch (e) {
                cb && cb({ success:false, error:'server_error' });
            }
        });

        // Request soft off-ramp mid-edge
        socket.on('travel:exit', async (payload, cb) => {
            try {
                if (!allow(socket, 'travel')) return cb && cb({ success:false, error:'rate_limited' });
                const { shipId } = payload || {};
                if (!shipId) return cb && cb({ success:false, error:'bad_request' });
                const tr = await new Promise((resolve)=>db.get(`SELECT id, edge_id, cu FROM lane_transits WHERE ship_id = ? ORDER BY id DESC LIMIT 1`, [shipId], (e,r)=>resolve(r||null)));
                if (!tr) return cb && cb({ success:false, error:'not_in_lane' });
                await new Promise((resolve)=>db.run('DELETE FROM lane_transits WHERE id = ?', [tr.id], ()=>resolve()));
                await new Promise((resolve)=>db.run('UPDATE lane_edges_runtime SET load_cu = MAX(0, load_cu - ?) WHERE edge_id = ?', [tr.cu, tr.edge_id], ()=>resolve()));
                cb && cb({ success:true, exited:true });
            } catch (e) {
                cb && cb({ success:false, error:'server_error' });
            }
        });
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


