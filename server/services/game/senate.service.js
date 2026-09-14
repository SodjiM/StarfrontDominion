const dbDefault = require('../../db');

const query = (db, method, sql, params = []) => new Promise((resolve, reject) => {
    if (method === 'run') {
        db.run(sql, params, function (err) { return err ? reject(err) : resolve(this); });
    } else {
        db[method](sql, params, (err, value) => err ? reject(err) : resolve(value));
    }
});

const SENATOR_DEFINITIONS = [
    { key: 'centralist_administrator', name: 'Administrator Veyra', tags: ['Centralist', 'Industrialist'], preferredStations: ['sun-station', 'planet-station'] },
    { key: 'centralist_technocrat', name: 'Director Oran', tags: ['Centralist', 'Technocrat'], preferredStations: ['sun-station', 'planet-station'] },
    { key: 'regional_humanist', name: 'Advocate Sol', tags: ['Humanist', 'Ecologist'], preferredStations: ['planet-station'] },
    { key: 'frontier_raider', name: 'Warden Kest', tags: ['Raider-Aligned', 'Security'], preferredStations: ['moon-station'] },
    { key: 'trade_magnate', name: 'Factor Ilyan', tags: ['Trade Magnate', 'Expansionist'], preferredStations: ['planet-station', 'sun-station'] },
    { key: 'frontier_technocrat', name: 'Surveyor Nera', tags: ['Technocrat', 'Expansionist'], preferredStations: ['moon-station', 'planet-station'] }
];

const STATION_INFLUENCE = { 'sun-station': 20, 'planet-station': 10, 'moon-station': 5 };
const TAGS = [...new Set(SENATOR_DEFINITIONS.flatMap(d => d.tags))];
const POLICY_DEFINITIONS = [
    { key: 'centralized_command', title: 'Centralized Command', description: 'A stronger administrative chain improves coordination across the domain.', requiredMandate: { Centralist: 7.5 }, effect: { key: 'administration', value: 0.05 } },
    { key: 'industrial_charter', title: 'Industrial Charter', description: 'Grant productive stations a formal mandate to expand ship and infrastructure output.', requiredMandate: { Industrialist: 10 }, effect: { key: 'production', value: 0.05 } },
    { key: 'technocratic_works', title: 'Technocratic Works', description: 'Prioritize technical expertise in construction, logistics, and fleet operations.', requiredMandate: { Technocrat: 10 }, effect: { key: 'build_efficiency', value: 0.05 } },
    { key: 'frontier_network', title: 'Frontier Network', description: 'Recognize moon stations and forward operators as a unified frontier service.', requiredMandate: { Security: 10 }, effect: { key: 'frontier_operations', value: 0.05 } },
    { key: 'open_exchange', title: 'Open Exchange', description: 'Protect trade routes and encourage commercial movement between regional stations.', requiredMandate: { 'Trade Magnate': 10 }, effect: { key: 'trade', value: 0.05 } },
    { key: 'regional_compacts', title: 'Regional Compacts', description: 'Formalize cooperation between stations that share a regional interest.', requiredMandate: { Humanist: 10, Ecologist: 10 }, effect: { key: 'regional_health', value: 0.05 } }
];

function parseJson(value, fallback) {
    try { return typeof value === 'string' ? JSON.parse(value || '') : (value ?? fallback); } catch { return fallback; }
}

function stationClass(row) {
    const meta = parseJson(row?.meta, {});
    return meta.stationClass || null;
}

function serialize(value) { return JSON.stringify(value ?? {}); }

async function getCurrentTurn(gameId, db) {
    const row = await query(db, 'get', 'SELECT turn_number FROM turns WHERE game_id=? ORDER BY turn_number DESC LIMIT 1', [gameId]);
    return Number(row?.turn_number || 1);
}

async function getStations(gameId, userId, db) {
    const rows = await query(db, 'all', `
        SELECT so.*, s.name AS sector_name, s.owner_id AS sector_owner_id, parent.type AS host_type,
               parent.meta AS host_meta, parent.celestial_type AS host_celestial_type
        FROM sector_objects so
        JOIN sectors s ON s.id=so.sector_id
        LEFT JOIN sector_objects parent ON parent.id=so.parent_object_id
        WHERE s.game_id=? AND so.owner_id=? AND so.type='station'
        ORDER BY so.id`, [gameId, userId]);
    return rows.filter(row => ['sun-station', 'planet-station', 'moon-station'].includes(stationClass(row)))
        .map(row => ({
            id: Number(row.id),
            stationClass: stationClass(row),
            sectorId: Number(row.sector_id),
            sectorName: row.sector_name || null,
            parentObjectId: row.parent_object_id ? Number(row.parent_object_id) : null,
            name: parseJson(row.meta, {}).name || `${stationClass(row)} ${row.id}`,
            influence: STATION_INFLUENCE[stationClass(row)] || 0,
            row
        }));
}

function definitionFor(key) { return SENATOR_DEFINITIONS.find(def => def.key === key) || SENATOR_DEFINITIONS[0]; }

function publicSenator(row, stationMap = new Map()) {
    const tags = parseJson(row.tags_json, []);
    const station = row.station_id ? stationMap.get(Number(row.station_id)) : null;
    return {
        id: Number(row.id),
        name: row.name,
        definitionKey: row.definition_key,
        tags,
        status: row.status,
        happiness: Number(row.happiness || 0),
        termNumber: Number(row.term_number || 1),
        maxTerms: 4,
        appointedTurn: Number(row.appointed_turn || 1),
        retiredTurn: row.retired_turn == null ? null : Number(row.retired_turn),
        station: station ? { id: station.id, stationClass: station.stationClass, sectorId: station.sectorId, sectorName: station.sectorName, name: station.name } : null
    };
}

async function ensurePoliticalState(gameId, userId, currentTurn, db = dbDefault) {
    await query(db, 'run', `INSERT OR IGNORE INTO player_political_state(game_id,user_id,institutional_influence,policy_slots,political_capital,updated_turn) VALUES(?,?,0,5,0,?)`, [gameId, userId, currentTurn]);
    const active = await query(db, 'get', `SELECT COUNT(*) AS count FROM senate_senators WHERE game_id=? AND user_id=? AND status='active'`, [gameId, userId]);
    if (Number(active?.count || 0) === 0) {
        const stations = await getStations(gameId, userId, db);
        if (stations.length) {
            const station = stations[0];
            const def = SENATOR_DEFINITIONS[0];
            await query(db, 'run', `INSERT INTO senate_senators(game_id,user_id,definition_key,name,tags_json,status,happiness,term_number,appointed_turn,station_id) VALUES(?,?,?,?,?,?,?,?,?,?)`, [gameId, userId, def.key, def.name, serialize(def.tags), 'active', 50, 1, currentTurn, station.id]);
        }
    }
    await recalculatePoliticalState(gameId, userId, currentTurn, db);
}

async function reconcileDestroyedSenators(gameId, userId, currentTurn, db = dbDefault) {
    const lost = await query(db, 'all', `
        SELECT ss.id
        FROM senate_senators ss
        LEFT JOIN sector_objects station ON station.id=ss.station_id
            AND station.owner_id=ss.user_id AND station.type='station'
        WHERE ss.game_id=? AND ss.user_id=? AND ss.status='active' AND (ss.station_id IS NULL OR station.id IS NULL)`, [gameId, userId]);
    for (const senator of lost || []) {
        await query(db, 'run', `UPDATE senate_senators SET status='killed',retired_turn=?,station_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'`, [currentTurn, senator.id]);
    }
    return (lost || []).length;
}

async function recalculatePoliticalState(gameId, userId, currentTurn, db = dbDefault) {
    await reconcileDestroyedSenators(gameId, userId, currentTurn, db);
    const stations = await getStations(gameId, userId, db);
    const institutionalInfluence = stations.reduce((sum, station) => sum + station.influence, 0);
    const policySlots = 5 + (institutionalInfluence >= 50 ? 1 : 0) + (institutionalInfluence >= 100 ? 1 : 0) + (institutionalInfluence >= 160 ? 1 : 0);
    await query(db, 'run', `UPDATE player_political_state SET institutional_influence=?, policy_slots=?, updated_turn=? WHERE game_id=? AND user_id=?`, [institutionalInfluence, policySlots, currentTurn, gameId, userId]);

    const senators = await query(db, 'all', `SELECT * FROM senate_senators WHERE game_id=? AND user_id=? AND status='active'`, [gameId, userId]);
    const totals = new Map(TAGS.map(tag => [tag, 0]));
    for (const senator of senators) {
        const happinessMultiplier = 0.5 + Math.max(0, Math.min(100, Number(senator.happiness || 0))) / 200;
        const termMultiplier = 1 + Math.max(0, Number(senator.term_number || 1) - 1) * 0.25;
        const station = stations.find(candidate => candidate.id === Number(senator.station_id));
        const postMultiplier = station?.stationClass === 'sun-station' ? 1.25 : station?.stationClass === 'moon-station' ? 0.9 : 1;
        const contribution = 10 * happinessMultiplier * termMultiplier * postMultiplier;
        for (const tag of parseJson(senator.tags_json, [])) totals.set(tag, (totals.get(tag) || 0) + contribution);
    }
    for (const tag of TAGS) {
        await query(db, 'run', `INSERT INTO player_tag_mandate(game_id,user_id,tag,value,updated_turn) VALUES(?,?,?,?,?) ON CONFLICT(game_id,user_id,tag) DO UPDATE SET value=excluded.value,updated_turn=excluded.updated_turn`, [gameId, userId, tag, Number((totals.get(tag) || 0).toFixed(2)), currentTurn]);
    }
    return { institutionalInfluence, policySlots, mandate: Object.fromEntries(totals) };
}

function objectiveFor(senator, station, currentTurn) {
    const tags = parseJson(senator.tags_json, []);
    const isMoon = station?.stationClass === 'moon-station';
    const isPlanet = station?.stationClass === 'planet-station';
    let objective;
    if (tags.includes('Raider-Aligned') && isMoon) objective = { key: 'frontier_presence', title: 'Secure the frontier', description: `Maintain a moon-station post and expand activity around ${station.name}.`, target: { stationClass: 'moon-station' } };
    else if (tags.includes('Industrialist') && isPlanet) objective = { key: 'industrial_presence', title: 'Strengthen local industry', description: `Maintain a productive planet-station post at ${station.name}.`, target: { stationClass: 'planet-station' } };
    else if (tags.includes('Technocrat')) objective = { key: 'connected_administration', title: 'Improve administration', description: 'Remain assigned to a functioning station while the domain develops.', target: { stationRequired: true } };
    else objective = { key: 'maintain_office', title: 'Maintain the office', description: `Keep the senator's assigned ${station?.stationClass || 'station'} operational through the session.`, target: { stationRequired: true } };
    const startsComplete = objective.key === 'maintain_office';
    return { ...objective, progress: { current: startsComplete && station ? 1 : 0, target: 1 }, turn: currentTurn };
}

async function recordObjectiveProgress(gameId, userId, eventKey, amount = 1, currentTurn = null, db = dbDefault) {
    const turn = currentTurn == null ? await getCurrentTurn(gameId, db) : currentTurn;
    const objectives = await query(db, 'all', `
        SELECT so.id, so.objective_key, so.progress_json
        FROM senator_objectives so
        JOIN senate_sessions session ON session.id=so.session_id AND session.status='open'
        JOIN senate_senators senator ON senator.id=so.senator_id AND senator.status='active' AND senator.game_id=? AND senator.user_id=?
        WHERE so.status='active' AND so.objective_key IN ('industrial_presence','connected_administration','frontier_presence')`, [gameId, userId]);
    const eventMap = {
        production: new Set(['industrial_presence', 'connected_administration']),
        ship_build: new Set(['industrial_presence', 'connected_administration']),
        combat: new Set(['frontier_presence']),
        raid: new Set(['frontier_presence'])
    };
    const eligible = eventMap[eventKey] || new Set();
    for (const objective of objectives) {
        if (!eligible.has(objective.objective_key)) continue;
        const progress = parseJson(objective.progress_json, { current: 0, target: 1 });
        progress.current = Math.min(Number(progress.target || 1), Number(progress.current || 0) + Math.max(0, Number(amount) || 0));
        const status = progress.current >= Number(progress.target || 1) ? 'completed' : 'active';
        await query(db, 'run', `UPDATE senator_objectives SET progress_json=?,status=?,completed_turn=CASE WHEN ?='completed' THEN COALESCE(completed_turn,?) ELSE completed_turn END WHERE id=?`, [serialize(progress), status, status, turn, objective.id]);
    }
}

async function openSession(gameId, userId, openedTurn, db = dbDefault) {
    const existing = await query(db, 'get', `SELECT * FROM senate_sessions WHERE game_id=? AND user_id=? AND opened_turn=?`, [gameId, userId, openedTurn]);
    if (existing) return existing;
    await ensurePoliticalState(gameId, userId, openedTurn, db);
    const sessionResult = await query(db, 'run', `INSERT INTO senate_sessions(game_id,user_id,opened_turn,expires_turn,status) VALUES(?,?,?,?, 'open')`, [gameId, userId, openedTurn, openedTurn + 9]);
    const sessionId = sessionResult.lastID;
    const active = await query(db, 'all', `SELECT * FROM senate_senators WHERE game_id=? AND user_id=? AND status='active'`, [gameId, userId]);
    const stations = await getStations(gameId, userId, db);
    const stationMap = new Map(stations.map(station => [station.id, station]));
    for (const senator of active) {
        const station = stationMap.get(Number(senator.station_id));
        const objective = objectiveFor(senator, station, openedTurn);
        await query(db, 'run', `INSERT INTO senator_objectives(senator_id,session_id,objective_key,title,description,target_json,progress_json,status,happiness_reward) VALUES(?,?,?,?,?,?,?,?,?)`, [senator.id, sessionId, objective.key, objective.title, objective.description, serialize(objective.target), serialize(objective.progress), 'active', 10]);
    }
    const shuffled = [...SENATOR_DEFINITIONS].sort((a, b) => `${gameId}:${userId}:${openedTurn}:${a.key}`.localeCompare(`${gameId}:${userId}:${openedTurn}:${b.key}`));
    for (const def of shuffled.slice(0, 5)) {
        const preferred = def.preferredStations[0];
        await query(db, 'run', `INSERT INTO senate_candidates(session_id,definition_key,name,tags_json,station_class,rarity) VALUES(?,?,?,?,?,?)`, [sessionId, def.key, def.name, serialize(def.tags), preferred, 'common']);
    }
    return query(db, 'get', `SELECT * FROM senate_sessions WHERE id=?`, [sessionId]);
}

async function ensureOpenSession(gameId, userId, currentTurn, db = dbDefault) {
    const existing = await query(db, 'get', `SELECT * FROM senate_sessions WHERE game_id=? AND user_id=? AND status='open' ORDER BY id DESC LIMIT 1`, [gameId, userId]);
    if (existing && Number(currentTurn) <= Number(existing.expires_turn)) return existing;
    if (existing) await query(db, 'run', `UPDATE senate_sessions SET status='expired',closed_turn=? WHERE id=?`, [currentTurn, existing.id]);
    const cadenceTurn = Math.floor(Number(currentTurn) / 100) * 100;
    if (cadenceTurn < 100 || Number(currentTurn) > cadenceTurn + 9) return null;

    // A session that was deliberately closed during this cadence must not be
    // silently recreated by a later state read in the same Senate window.
    const cadenceSession = await query(db, 'get', `SELECT * FROM senate_sessions WHERE game_id=? AND user_id=? AND opened_turn=? ORDER BY id DESC LIMIT 1`, [gameId, userId, cadenceTurn]);
    if (cadenceSession) return cadenceSession.status === 'open' ? cadenceSession : null;
    return openSession(gameId, userId, cadenceTurn, db);
}

async function getState(gameId, userId, db = dbDefault) {
    const currentTurn = await getCurrentTurn(gameId, db);
    await ensurePoliticalState(gameId, userId, currentTurn, db);
    const session = await ensureOpenSession(gameId, userId, currentTurn, db);
    const stations = await getStations(gameId, userId, db);
    const stationMap = new Map(stations.map(station => [station.id, station]));
    const senators = await query(db, 'all', `SELECT * FROM senate_senators WHERE game_id=? AND user_id=? ORDER BY id`, [gameId, userId]);
    const state = await query(db, 'get', `SELECT * FROM player_political_state WHERE game_id=? AND user_id=?`, [gameId, userId]);
    const mandateRows = await query(db, 'all', `SELECT tag,value FROM player_tag_mandate WHERE game_id=? AND user_id=? ORDER BY tag`, [gameId, userId]);
    const activePolicies = await query(db, 'all', `SELECT policy_key,activated_turn FROM player_active_policies WHERE game_id=? AND user_id=? AND active=1 ORDER BY policy_key`, [gameId, userId]);
    const objectives = session ? await query(db, 'all', `SELECT * FROM senator_objectives WHERE session_id=? ORDER BY id`, [session.id]) : [];
    const candidates = session ? await query(db, 'all', `SELECT * FROM senate_candidates WHERE session_id=? ORDER BY id`, [session.id]) : [];
    return {
        currentTurn,
        session: session ? { id: Number(session.id), openedTurn: Number(session.opened_turn), expiresTurn: Number(session.expires_turn), status: session.status } : null,
        stations: stations.map(({ row, ...station }) => station),
        senators: senators.map(row => publicSenator(row, stationMap)),
        candidates: candidates.map(row => ({ id: Number(row.id), name: row.name, definitionKey: row.definition_key, tags: parseJson(row.tags_json, []), stationClass: row.station_class, rarity: row.rarity, selected: Boolean(row.selected) })),
        objectives: objectives.map(row => ({ id: Number(row.id), senatorId: Number(row.senator_id), key: row.objective_key, title: row.title, description: row.description, target: parseJson(row.target_json, {}), progress: parseJson(row.progress_json, {}), status: row.status, happinessReward: Number(row.happiness_reward || 0) })),
        institutionalInfluence: Number(state?.institutional_influence || 0),
        policySlots: Number(state?.policy_slots || 5),
        politicalCapital: Number(state?.political_capital || 0),
        mandate: Object.fromEntries(mandateRows.map(row => [row.tag, Number(row.value || 0)])),
        policies: {
            available: POLICY_DEFINITIONS,
            active: activePolicies.map(row => ({ key: row.policy_key, activatedTurn: Number(row.activated_turn) }))
        }
    };
}

function policyEligible(policy, mandate) {
    return Object.entries(policy.requiredMandate || {}).every(([tag, minimum]) => Number(mandate[tag] || 0) >= Number(minimum));
}

async function setPolicy(gameId, userId, policyKey, active, currentTurn, db = dbDefault) {
    await assertMember(gameId, userId, db);
    const policy = POLICY_DEFINITIONS.find(candidate => candidate.key === policyKey);
    if (!policy) return { success: false, error: 'unknown_policy', httpStatus: 404 };
    await ensurePoliticalState(gameId, userId, currentTurn, db);
    const mandates = await query(db, 'all', `SELECT tag,value FROM player_tag_mandate WHERE game_id=? AND user_id=?`, [gameId, userId]);
    const mandate = Object.fromEntries(mandates.map(row => [row.tag, Number(row.value || 0)]));
    if (active && !policyEligible(policy, mandate)) return { success: false, error: 'policy_mandate_requirement_not_met', httpStatus: 409 };
    if (active) {
        const state = await query(db, 'get', `SELECT policy_slots FROM player_political_state WHERE game_id=? AND user_id=?`, [gameId, userId]);
        const count = await query(db, 'get', `SELECT COUNT(*) AS count FROM player_active_policies WHERE game_id=? AND user_id=? AND active=1`, [gameId, userId]);
        const alreadyActive = await query(db, 'get', `SELECT 1 AS active FROM player_active_policies WHERE game_id=? AND user_id=? AND policy_key=? AND active=1`, [gameId, userId, policyKey]);
        if (!alreadyActive && Number(count?.count || 0) >= Number(state?.policy_slots || 5)) return { success: false, error: 'policy_slots_full', httpStatus: 409 };
        await query(db, 'run', `INSERT INTO player_active_policies(game_id,user_id,policy_key,active,activated_turn) VALUES(?,?,?,1,?) ON CONFLICT(game_id,user_id,policy_key) DO UPDATE SET active=1,activated_turn=excluded.activated_turn`, [gameId, userId, policyKey, currentTurn]);
    } else {
        await query(db, 'run', `UPDATE player_active_policies SET active=0 WHERE game_id=? AND user_id=? AND policy_key=?`, [gameId, userId, policyKey]);
    }
    return { success: true, state: await getState(gameId, userId, db) };
}

async function assertMember(gameId, userId, db) {
    const row = await query(db, 'get', 'SELECT 1 AS ok FROM game_players WHERE game_id=? AND user_id=?', [gameId, userId]);
    if (!row) { const error = new Error('not_game_member'); error.statusCode = 403; throw error; }
}

async function assignSenator(gameId, userId, senatorId, stationId, currentTurn, db = dbDefault) {
    await assertMember(gameId, userId, db);
    const session = await ensureOpenSession(gameId, userId, currentTurn, db);
    if (!session) return { success: false, error: 'no_open_senate_session', httpStatus: 409 };
    const senator = await query(db, 'get', `SELECT * FROM senate_senators WHERE id=? AND game_id=? AND user_id=? AND status='active'`, [senatorId, gameId, userId]);
    const station = await query(db, 'get', `SELECT so.* FROM sector_objects so JOIN sectors s ON s.id=so.sector_id WHERE so.id=? AND so.owner_id=? AND s.game_id=? AND so.type='station'`, [stationId, userId, gameId]);
    if (!senator || !station || !['sun-station', 'planet-station', 'moon-station'].includes(stationClass(station))) return { success: false, error: 'invalid_senator_or_station', httpStatus: 400 };
    const occupied = await query(db, 'get', `SELECT id FROM senate_senators WHERE game_id=? AND station_id=? AND status='active' AND id<>?`, [gameId, stationId, senatorId]);
    if (occupied) return { success: false, error: 'station_already_hosts_senator', httpStatus: 409 };
    await query(db, 'run', `UPDATE senate_senators SET station_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, [stationId, senatorId]);
    await recalculatePoliticalState(gameId, userId, currentTurn, db);
    return { success: true, state: await getState(gameId, userId, db) };
}

async function selectCandidate(gameId, userId, candidateId, replaceSenatorId, stationId, currentTurn, db = dbDefault) {
    await assertMember(gameId, userId, db);
    const session = await ensureOpenSession(gameId, userId, currentTurn, db);
    if (!session) return { success: false, error: 'no_open_senate_session', httpStatus: 409 };
    const candidate = await query(db, 'get', `SELECT * FROM senate_candidates WHERE id=? AND session_id=? AND selected=0`, [candidateId, session.id]);
    if (!candidate) return { success: false, error: 'candidate_not_available', httpStatus: 404 };
    const activeCount = await query(db, 'get', `SELECT COUNT(*) AS count FROM senate_senators WHERE game_id=? AND user_id=? AND status='active'`, [gameId, userId]);
    if (!replaceSenatorId && Number(activeCount?.count || 0) >= 5) return { success: false, error: 'senate_capacity_reached', httpStatus: 409 };
    const station = await query(db, 'get', `SELECT so.* FROM sector_objects so JOIN sectors s ON s.id=so.sector_id WHERE so.id=? AND so.owner_id=? AND s.game_id=? AND so.type='station'`, [stationId, userId, gameId]);
    if (!station || !['sun-station', 'planet-station', 'moon-station'].includes(stationClass(station))) return { success: false, error: 'invalid_hosting_station', httpStatus: 400 };
    const occupied = await query(db, 'get', `SELECT id FROM senate_senators WHERE game_id=? AND station_id=? AND status='active'`, [gameId, stationId]);
    if (occupied && Number(occupied.id) !== Number(replaceSenatorId)) return { success: false, error: 'station_already_hosts_senator', httpStatus: 409 };
    if (replaceSenatorId) {
        const old = await query(db, 'get', `SELECT id FROM senate_senators WHERE id=? AND game_id=? AND user_id=? AND status='active'`, [replaceSenatorId, gameId, userId]);
        if (!old) return { success: false, error: 'replacement_senator_not_found', httpStatus: 404 };
        await query(db, 'run', `UPDATE senate_senators SET status='retired',retired_turn=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, [currentTurn, replaceSenatorId]);
    }
    await query(db, 'run', `INSERT INTO senate_senators(game_id,user_id,definition_key,name,tags_json,status,happiness,term_number,appointed_turn,station_id) VALUES(?,?,?,?,?,?,?,?,?,?)`, [gameId, userId, candidate.definition_key, candidate.name, candidate.tags_json, 'active', 50, 1, currentTurn, stationId]);
    await query(db, 'run', `UPDATE senate_candidates SET selected=1 WHERE id=?`, [candidateId]);
    await recalculatePoliticalState(gameId, userId, currentTurn, db);
    return { success: true, state: await getState(gameId, userId, db) };
}

async function closeSession(gameId, userId, currentTurn, db = dbDefault) {
    await assertMember(gameId, userId, db);
    const session = await ensureOpenSession(gameId, userId, currentTurn, db);
    if (!session) return { success: false, error: 'no_open_senate_session', httpStatus: 409 };
    const objectives = await query(db, 'all', `SELECT * FROM senator_objectives WHERE session_id=? AND status='active'`, [session.id]);
    for (const objective of objectives) {
        const senator = await query(db, 'get', `SELECT * FROM senate_senators WHERE id=? AND status='active'`, [objective.senator_id]);
        const progress = parseJson(objective.progress_json, {});
        const completed = Boolean(senator?.station_id && Number(progress.current || 0) >= Number(progress.target || 1));
        await query(db, 'run', `UPDATE senator_objectives SET status=?,completed_turn=? WHERE id=?`, [completed ? 'completed' : 'expired', completed ? currentTurn : null, objective.id]);
        if (senator) await query(db, 'run', `UPDATE senate_senators SET happiness=MIN(100,MAX(0,happiness+?)),updated_at=CURRENT_TIMESTAMP WHERE id=?`, [completed ? Number(objective.happiness_reward || 10) : -2, senator.id]);
    }
    const active = await query(db, 'all', `SELECT * FROM senate_senators WHERE game_id=? AND user_id=? AND status='active'`, [gameId, userId]);
    for (const senator of active) {
        if (Number(senator.appointed_turn) < Number(session.opened_turn)) {
            if (Number(senator.term_number) >= 4) {
                await query(db, 'run', `UPDATE senate_senators SET status='retired',retired_turn=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, [currentTurn, senator.id]);
            } else {
                await query(db, 'run', `UPDATE senate_senators SET term_number=term_number+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`, [senator.id]);
            }
        }
    }
    await query(db, 'run', `UPDATE senate_sessions SET status='closed',closed_turn=? WHERE id=?`, [currentTurn, session.id]);
    await recalculatePoliticalState(gameId, userId, currentTurn, db);
    return { success: true, state: await getState(gameId, userId, db) };
}

async function openSessionsAtTurn(gameId, turnNumber, db = dbDefault) {
    if (Number(turnNumber) % 100 !== 0) return [];
    const players = await query(db, 'all', 'SELECT user_id FROM game_players WHERE game_id=?', [gameId]);
    const opened = [];
    for (const player of players) opened.push(await openSession(gameId, player.user_id, turnNumber, db));
    return opened;
}

module.exports = { SENATOR_DEFINITIONS, POLICY_DEFINITIONS, getState, assignSenator, selectCandidate, closeSession, setPolicy, recordObjectiveProgress, openSessionsAtTurn, ensurePoliticalState, recalculatePoliticalState, reconcileDestroyedSenators };
