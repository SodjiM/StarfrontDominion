const one = (db, sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (e, row) => e ? reject(e) : resolve(row || null)));
const all = (db, sql, args = []) => new Promise((resolve, reject) => db.all(sql, args, (e, rows) => e ? reject(e) : resolve(rows || [])));
const run = (db, sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function (e) { e ? reject(e) : resolve(this); }));
const integer = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0;
async function assertMember(db, gameId, userId) {
    if (!integer(gameId) || !integer(userId) || !await one(db, 'SELECT 1 FROM game_players WHERE game_id=? AND user_id=?', [gameId,userId])) {
        throw Object.assign(new Error('not_a_game_member'), { status:403 });
    }
}
async function append(db, e) {
    return (await run(db, 'INSERT INTO activity_events(game_id,user_id,turn_number,event_type,severity,summary,object_id,data) VALUES(?,?,?,?,?,?,?,?)',
        [e.gameId,e.userId,e.turnNumber,e.eventType,e.severity || 'info',String(e.summary).slice(0,300),e.objectId || null,e.data ? JSON.stringify(e.data) : null])).lastID;
}
async function open(db, { gameId, userId, limit=50, afterId=null, snapshotBoundary=null }) {
    await assertMember(db,gameId,userId);
    for (const value of [afterId,snapshotBoundary]) if (value != null && !integer(value)) throw Object.assign(new Error('invalid_cursor'),{status:400});
    const n = Math.max(1,Math.min(100,Math.floor(Number(limit)||50)));
    const read = Number((await one(db,'SELECT last_seen_event_id FROM activity_read_cursors WHERE game_id=? AND user_id=?',[gameId,userId]))?.last_seen_event_id || 0);
    const latest = Number((await one(db,'SELECT COALESCE(MAX(id),0) AS id FROM activity_events WHERE game_id=? AND user_id=?',[gameId,userId])).id);
    const boundary = snapshotBoundary == null ? latest : Math.min(Number(snapshotBoundary),latest);
    const cursor = afterId == null ? read : Number(afterId);
    const rows = await all(db,`SELECT id,turn_number AS turnNumber,event_type AS eventType,severity,summary,object_id AS objectId,created_at AS createdAt
        FROM activity_events WHERE game_id=? AND user_id=? AND id>? AND id<=? ORDER BY id ASC LIMIT ?`,[gameId,userId,cursor,boundary,n+1]);
    const hasMore = rows.length > n; const events = rows.slice(0,n);
    const unread = await one(db,`SELECT COUNT(*) AS count,
        MAX(CASE severity WHEN 'danger' THEN 2 WHEN 'warning' THEN 1 ELSE 0 END) AS severity
        FROM activity_events WHERE game_id=? AND user_id=? AND id>?`,[gameId,userId,read]);
    return {events,snapshotBoundary:boundary,pageBoundary:events.at(-1)?.id || cursor,cursor,hasMore,
        unreadCount:unread.count,severity:['info','warning','danger'][unread.severity || 0]};
}
async function ack(db,{gameId,userId,boundary}) {
    await assertMember(db,gameId,userId);
    if (!integer(boundary)) throw Object.assign(new Error('invalid_cursor'),{status:400});
    if (Number(boundary) !== 0 && !await one(db,'SELECT 1 FROM activity_events WHERE game_id=? AND user_id=? AND id=?',[gameId,userId,Number(boundary)])) {
        throw Object.assign(new Error('invalid_cursor'),{status:400});
    }
    await run(db,`INSERT INTO activity_read_cursors(game_id,user_id,last_seen_event_id) VALUES(?,?,?)
        ON CONFLICT(game_id,user_id) DO UPDATE SET last_seen_event_id=MAX(last_seen_event_id,excluded.last_seen_event_id),updated_at=CURRENT_TIMESTAMP`,[gameId,userId,Number(boundary)]);
    return {cursor:Number((await one(db,'SELECT last_seen_event_id FROM activity_read_cursors WHERE game_id=? AND user_id=?',[gameId,userId])).last_seen_event_id)};
}
async function captureOwnership(db,gameId) {
    return all(db,'SELECT o.id,o.owner_id,o.type FROM sector_objects o JOIN sectors s ON s.id=o.sector_id WHERE s.game_id=? AND o.owner_id IS NOT NULL',[gameId]);
}
// Keep legacy report responses safe even when the underlying combat row has a
// rich payload or one participant has since been destroyed.
function sanitizeCombatLogRow(row, { attackerVisible = false, targetVisible = false } = {}) {
    let data = {};
    try {
        const raw = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
        // Numeric damage is useful to the existing combat log UI. Tactical
        // distance, weapon, coordinates, and nested payloads can disclose an
        // unseen opponent, so they are intentionally excluded.
        if (Number.isFinite(Number(raw.damage))) data.damage = Number(raw.damage);
    } catch {}
    const summaries = { attack: 'Combat engagement recorded', ability: 'Ability resolved',
        effect: 'Combat effect applied', status: 'Combat status changed', kill: 'Enemy unit destroyed',
        destroyed_object: 'Unit destroyed' };
    return { id: row.id, game_id: row.game_id, turn_number: row.turn_number,
        attacker_id: attackerVisible ? row.attacker_id : null,
        target_id: targetVisible ? row.target_id : null,
        event_type: row.event_type, summary: summaries[row.event_type] || 'Combat event recorded', data: JSON.stringify(data), created_at: row.created_at };
}
async function materializeTurn(db,gameId,turnNumber,{ownership=[],movementResults=[],senateSessions=[]}={}) {
    // Called inside turn transaction. Capture ownership BEFORE combat; destroyed
    // objects may no longer exist when summaries are materialized.
    const players = await all(db,'SELECT user_id AS userId FROM game_players WHERE game_id=?',[gameId]);
    const now = await captureOwnership(db,gameId);
    const owners = new Map([...ownership,...now].map(o=>[Number(o.id),Number(o.owner_id)]));
    const combat = await all(db,'SELECT attacker_id,target_id FROM combat_logs WHERE game_id=? AND turn_number=?',[gameId,turnNumber]);
    // The current strategic map exposes every system in a joined game, so
    // regional incidents are relevant public activity for every member. When
    // persistent system-knowledge is introduced, this recipient set can be
    // narrowed without changing the incident lifecycle.
    const incidentActivity = await all(db,
        `SELECT i.id,i.title,i.region_id,i.status,i.due_turn,i.health_loss,i.applied_health_delta,
                i.created_turn,i.resolved_turn,s.name AS sector_name,r.health
         FROM region_incidents i
         JOIN sectors s ON s.id=i.sector_id
         JOIN regions r ON r.sector_id=i.sector_id AND r.region_id=i.region_id
         WHERE i.game_id=? AND (i.created_turn=? OR i.resolved_turn=?)
         ORDER BY i.id`, [gameId,turnNumber,turnNumber]);
    for (const {userId} of players) {
        if (await one(db,"SELECT 1 FROM activity_events WHERE game_id=? AND user_id=? AND turn_number=? AND event_type='turn_complete'",[gameId,userId,turnNumber])) continue;
        const add = (eventType,severity,summary,objectId=null) => append(db,{gameId,userId,turnNumber,eventType,severity,summary,objectId});
        const mine = id => owners.get(Number(id)) === Number(userId);
        const arrivals = movementResults.filter(x=>mine(x.objectId)&&x.status==='completed');
        const blocked = movementResults.filter(x=>mine(x.objectId)&&x.status==='blocked');
        for (const x of arrivals) await add('arrival','info','Ship reached its destination',x.objectId);
        for (const x of blocked) await add('movement_blocked','warning','Ship movement is blocked; retry scheduled',x.objectId);
        const harvest = await all(db,`SELECT ship_id,SUM(amount) AS amount FROM turn_harvest_events WHERE game_id=? AND turn_number=? GROUP BY ship_id`,[gameId,turnNumber]);
        for (const x of harvest.filter(x=>mine(x.ship_id))) await add('harvest','success','Harvested '+x.amount+' resources',x.ship_id);
        const involved = combat.filter(x=>mine(x.attacker_id)||mine(x.target_id));
        if (involved.length) await add('combat','warning',involved.length+' combat event(s) involved your units');
        const lost = ownership.filter(o=>Number(o.owner_id)===Number(userId)&&o.type==='ship'&&!now.some(n=>n.id===o.id&&n.type==='ship'&&Number(n.owner_id)===Number(userId)));
        if (lost.length) await add('loss','danger',lost.length+' ship(s) lost');
        const builds = await all(db,'SELECT object_id,name FROM turn_build_events WHERE game_id=? AND turn_number=? AND user_id=?',[gameId,turnNumber,userId]);
        for (const x of builds) await add('build_complete','success',x.name+' construction completed',x.object_id);
        const pilots = await all(db,'SELECT recovered,recruited FROM turn_pilot_events WHERE game_id=? AND turn_number=? AND user_id=?',[gameId,turnNumber,userId]);
        const total = pilots.reduce((n,x)=>n+Number(x.recovered||0)+Number(x.recruited||0),0);
        if (total) await add('pilots','info',total+' pilots returned to command');
        for (const incident of incidentActivity) {
            const place = `${incident.sector_name}, Region ${incident.region_id}`;
            if (Number(incident.created_turn) === Number(turnNumber)) {
                await add('region_incident','warning',`${incident.title} reported in ${place}. Resolve by turn ${incident.due_turn} or regional health falls by ${incident.health_loss}.`);
            }
            if (Number(incident.resolved_turn) === Number(turnNumber) && incident.status === 'resolved') {
                await add('region_incident_resolved','success',`${incident.title} resolved in ${place}. Regional health was protected.`);
            } else if (Number(incident.resolved_turn) === Number(turnNumber) && incident.status === 'expired') {
                await add('region_incident_expired','danger',`${incident.title} expired in ${place}. Regional health fell by ${Math.abs(Number(incident.applied_health_delta || 0))} to ${incident.health}.`);
            }
        }
        const senateSession = senateSessions.find(session => Number(session.user_id) === Number(userId));
        if (senateSession) {
            await add('senate_session', 'info', `A Senate session is available for turn ${senateSession.opened_turn}. It will remain pending until concluded.`);
        }
        // Always include quiet turns, so returning players can account for every turn.
        await add('turn_complete','info','Turn '+turnNumber+' completed');
    }
}
module.exports={append,open,ack,materializeTurn,captureOwnership,assertMember,sanitizeCombatLogRow};
