const dbDefault = require('../../db');
const { withSavepoint } = require('./savepoint');
const policyService = require('./policy.service');
const politicalCapitalService = require('./political-capital.service');
const civicNamingService = require('./civic-naming.service');
const activityService = require('./activity.service');
const { POLICY_DEFINITIONS } = policyService;

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
const MAX_SENATORS = 4;
const MAX_POLICY_SLOTS = 4;
const PILOT_CAPACITY_THRESHOLDS = [15, 25, 35];
// Kept only because existing databases define expires_turn as NOT NULL. Senate
// sessions are persistent and are closed by the player, not by this value.
const PERSISTENT_SESSION_EXPIRY = 2147483647;
const TAGS = [...new Set(SENATOR_DEFINITIONS.flatMap(d => d.tags))];

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

function unlockedCapacity(pilotCapacity, maximum) {
    return Math.min(maximum, 1 + PILOT_CAPACITY_THRESHOLDS.filter(threshold => Number(pilotCapacity) >= threshold).length);
}

async function getGovernmentCapacity(gameId, userId, currentTurn, stations, db) {
    const pilotStats = await require('./pilot.service').getPilotStats(gameId, userId, currentTurn, db);
    return {
        pilotCapacity: Number(pilotStats.capacity || 0),
        seatCapacity: stations.length ? Math.min(stations.length, unlockedCapacity(pilotStats.capacity, MAX_SENATORS)) : 0,
        policySlots: unlockedCapacity(pilotStats.capacity, MAX_POLICY_SLOTS)
    };
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
    await query(db, 'run', `INSERT OR IGNORE INTO player_political_state(game_id,user_id,institutional_influence,policy_slots,political_capital,updated_turn) VALUES(?,?,0,1,0,?)`, [gameId, userId, currentTurn]);
    const existingSenators = await query(db, 'get', `SELECT COUNT(*) AS count FROM senate_senators WHERE game_id=? AND user_id=?`, [gameId, userId]);
    if (Number(existingSenators?.count || 0) === 0) {
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
    const { policySlots } = await getGovernmentCapacity(gameId, userId, currentTurn, stations, db);
    await query(db, 'run', `UPDATE player_political_state SET institutional_influence=?, policy_slots=?, updated_turn=? WHERE game_id=? AND user_id=?`, [institutionalInfluence, policySlots, currentTurn, gameId, userId]);

    const senators = await query(db, 'all', `SELECT * FROM senate_senators WHERE game_id=? AND user_id=? AND status='active'`, [gameId, userId]);
    const totals = new Map(TAGS.map(tag => [tag, 0]));
    for (const senator of senators) {
        const happinessMultiplier = 0.5 + Math.max(0, Math.min(100, Number(senator.happiness || 0))) / 200;
        const termMultiplier = 1 + Math.max(0, Number(senator.term_number || 1) - 1) * 0.25;
        const contribution = 10 * happinessMultiplier * termMultiplier;
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
    if (tags.includes('Raider-Aligned') && isMoon) objective = { key: 'frontier_presence', title: 'Secure the frontier', description: `Win a combat engagement in ${station.sectorName || 'this system'} while maintaining the post at ${station.name}.`, target: { stationClass: 'moon-station', eventTypes: ['combat', 'raid'], scope: 'system', sectorId: station.sectorId } };
    else if (tags.includes('Industrialist') && isPlanet) objective = { key: 'industrial_presence', title: 'Strengthen local industry', description: `Complete construction at ${station.name}.`, target: { stationClass: 'planet-station', eventTypes: ['production', 'ship_build'], scope: 'station', stationId: station.id } };
    else if (tags.includes('Technocrat')) objective = { key: 'connected_administration', title: 'Improve administration', description: `Advance a fleet operation or resolve a regional incident in ${station?.sectorName || 'this system'}.`, target: { stationRequired: true, eventTypes: ['movement', 'scan', 'regional_response'], scope: 'system', sectorId: station?.sectorId } };
    else objective = { key: 'maintain_office', title: 'Maintain the office', description: `Keep the senator's assigned ${station?.stationClass || 'station'} operational through the session.`, target: { stationRequired: true } };
    const startsComplete = objective.key === 'maintain_office';
    return { ...objective, progress: { current: startsComplete && station ? 1 : 0, target: 1 }, turn: currentTurn };
}

async function openSession(gameId, userId, openedTurn, db = dbDefault) {
    const pending = await query(db, 'get', `SELECT * FROM senate_sessions WHERE game_id=? AND user_id=? AND status='open' ORDER BY id DESC LIMIT 1`, [gameId, userId]);
    if (pending) return { ...pending, newlyOpened: false };
    const existing = await query(db, 'get', `SELECT * FROM senate_sessions WHERE game_id=? AND user_id=? AND opened_turn=?`, [gameId, userId, openedTurn]);
    if (existing) return { ...existing, newlyOpened: false };
    await ensurePoliticalState(gameId, userId, openedTurn, db);
    const sessionResult = await query(db, 'run', `INSERT INTO senate_sessions(game_id,user_id,opened_turn,expires_turn,status) VALUES(?,?,?,?, 'open')`, [gameId, userId, openedTurn, PERSISTENT_SESSION_EXPIRY]);
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
    for (const def of shuffled.slice(0, 4)) {
        const preferred = def.preferredStations[0];
        await query(db, 'run', `INSERT INTO senate_candidates(session_id,definition_key,name,tags_json,station_class,rarity) VALUES(?,?,?,?,?,?)`, [sessionId, def.key, def.name, serialize(def.tags), preferred, 'common']);
    }
    const created = await query(db, 'get', `SELECT * FROM senate_sessions WHERE id=?`, [sessionId]);
    return { ...created, newlyOpened: true };
}

async function ensureOpenSession(gameId, userId, currentTurn, db = dbDefault) {
    const existing = await query(db, 'get', `SELECT * FROM senate_sessions WHERE game_id=? AND user_id=? AND status='open' ORDER BY id DESC LIMIT 1`, [gameId, userId]);
    if (existing) return existing;
    const cadenceTurn = Math.floor(Number(currentTurn) / 100) * 100;
    if (cadenceTurn < 100) return null;

    // A session resolved after one or more missed cadence boundaries consumes
    // those missed sessions. They never stack or appear immediately afterward.
    const latest = await query(db, 'get', `SELECT * FROM senate_sessions WHERE game_id=? AND user_id=? ORDER BY opened_turn DESC LIMIT 1`, [gameId, userId]);
    if (latest && (Number(latest.opened_turn) >= cadenceTurn || Number(latest.closed_turn || 0) >= cadenceTurn)) return null;
    return openSession(gameId, userId, cadenceTurn, db);
}

async function getState(gameId, userId, db = dbDefault) {
    await assertMember(gameId, userId, db);
    const currentTurn = await getCurrentTurn(gameId, db);
    await ensurePoliticalState(gameId, userId, currentTurn, db);
    const session = await ensureOpenSession(gameId, userId, currentTurn, db);
    const stations = await getStations(gameId, userId, db);
    const governmentCapacity = await getGovernmentCapacity(gameId, userId, currentTurn, stations, db);
    const stationMap = new Map(stations.map(station => [station.id, station]));
    const senators = await query(db, 'all', `SELECT * FROM senate_senators WHERE game_id=? AND user_id=? ORDER BY id`, [gameId, userId]);
    const state = await query(db, 'get', `SELECT * FROM player_political_state WHERE game_id=? AND user_id=?`, [gameId, userId]);
    const mandateRows = await query(db, 'all', `SELECT tag,value FROM player_tag_mandate WHERE game_id=? AND user_id=? ORDER BY tag`, [gameId, userId]);
    const evaluatedPolicies = await policyService.getPolicyEvaluation(gameId, userId, db, Object.fromEntries(mandateRows.map(row => [row.tag, Number(row.value || 0)])));
    const civic = await civicNamingService.getCivicNamingReadModel(gameId, userId, db);
    const objectives = session ? await query(db, 'all', `SELECT * FROM senator_objectives WHERE session_id=? ORDER BY id`, [session.id]) : [];
    const objectiveEvents = session ? await query(db, 'all', `
        SELECT event.* FROM senator_objective_events event
        JOIN senator_objectives objective ON objective.id=event.objective_id
        WHERE objective.session_id=? ORDER BY event.turn_number,event.id`, [session.id]) : [];
    const eventsByObjective = new Map();
    for (const event of objectiveEvents) {
        const list = eventsByObjective.get(Number(event.objective_id)) || [];
        list.push({ eventType: event.event_type, turnNumber: Number(event.turn_number), amount: Number(event.amount), summary: event.summary });
        eventsByObjective.set(Number(event.objective_id), list);
    }
    const candidates = session ? await query(db, 'all', `SELECT * FROM senate_candidates WHERE session_id=? ORDER BY id`, [session.id]) : [];
    return {
        currentTurn,
        session: session ? { id: Number(session.id), openedTurn: Number(session.opened_turn), status: session.status } : null,
        stations: stations.map(({ row, ...station }) => station),
        senators: senators.map(row => publicSenator(row, stationMap)),
        candidates: candidates.map(row => ({ id: Number(row.id), name: row.name, definitionKey: row.definition_key, tags: parseJson(row.tags_json, []), stationClass: row.station_class, rarity: row.rarity, selected: Boolean(row.selected) })),
        objectives: objectives.map(row => ({ id: Number(row.id), senatorId: Number(row.senator_id), key: row.objective_key, title: row.title, description: row.description, target: parseJson(row.target_json, {}), progress: parseJson(row.progress_json, {}), status: row.status, happinessReward: Number(row.happiness_reward || 0), events: eventsByObjective.get(Number(row.id)) || [] })),
        institutionalInfluence: Number(state?.institutional_influence || 0),
        pilotCapacity: governmentCapacity.pilotCapacity,
        seatCapacity: governmentCapacity.seatCapacity,
        maxSenators: MAX_SENATORS,
        policySlots: Number(state?.policy_slots || 1),
        politicalCapital: Number(state?.political_capital || 0),
        politicalCapitalLedger: civic.recentLedgerEntries,
        naming: {
            proposalCost: civicNamingService.CAPITAL_COST,
            eligibleTargets: civic.eligibleNamingTargets,
            pendingProposals: civic.pendingProposals
        },
        mandate: Object.fromEntries(mandateRows.map(row => [row.tag, Number(row.value || 0)])),
        policies: {
            available: evaluatedPolicies,
            active: evaluatedPolicies.filter(policy => policy.selected)
        }
    };
}

async function setPolicyUnchecked(gameId, userId, policyKey, active, currentTurn, db) {
    await assertMember(gameId, userId, db);
    const policy = POLICY_DEFINITIONS.find(candidate => candidate.key === policyKey);
    if (!policy) return { success: false, error: 'unknown_policy', httpStatus: 404 };
    await ensurePoliticalState(gameId, userId, currentTurn, db);
    const evaluated = await policyService.getPolicyEvaluation(gameId, userId, db);
    const current = evaluated.find(candidate => candidate.key === policyKey);
    if (active) {
        const state = await query(db, 'get', `SELECT policy_slots FROM player_political_state WHERE game_id=? AND user_id=?`, [gameId, userId]);
        if (current.selected) return { success: true, state: await getState(gameId, userId, db) };
        if (!current.eligible) {
            return { success: false, error: 'policy_mandate_requirement_not_met', unmetRequirements: current.unmetRequirements, httpStatus: 409 };
        }
        const count = await query(db, 'get', `SELECT COUNT(*) AS count FROM player_active_policies WHERE game_id=? AND user_id=? AND active=1`, [gameId, userId]);
        if (Number(count?.count || 0) >= Number(state?.policy_slots || 1)) return { success: false, error: 'policy_slots_full', httpStatus: 409 };
        const transition = await query(db, 'run', `INSERT INTO player_active_policies(game_id,user_id,policy_key,active,activated_turn) VALUES(?,?,?,1,?) ON CONFLICT(game_id,user_id,policy_key) DO UPDATE SET active=1,activated_turn=excluded.activated_turn WHERE player_active_policies.active=0`, [gameId, userId, policyKey, currentTurn]);
        if (!Number(transition.changes || 0)) return { success: true, state: await getState(gameId, userId, db) };
        await query(db, 'run', `INSERT INTO player_policy_history(game_id,user_id,policy_key,event_type,turn_number) VALUES(?,?,?,?,?)`, [gameId, userId, policyKey, 'activation', currentTurn]);
    } else {
        if (!current.selected) return { success: true, state: await getState(gameId, userId, db) };
        const transition = await query(db, 'run', `UPDATE player_active_policies SET active=0 WHERE game_id=? AND user_id=? AND policy_key=? AND active=1`, [gameId, userId, policyKey]);
        if (!Number(transition.changes || 0)) return { success: true, state: await getState(gameId, userId, db) };
        await query(db, 'run', `INSERT INTO player_policy_history(game_id,user_id,policy_key,event_type,turn_number) VALUES(?,?,?,?,?)`, [gameId, userId, policyKey, 'deactivation', currentTurn]);
    }
    return { success: true, state: await getState(gameId, userId, db) };
}

async function setPolicy(gameId, userId, policyKey, active, currentTurn, db = dbDefault) {
    return withSavepoint(db, () => setPolicyUnchecked(gameId, userId, policyKey, active, currentTurn, db));
}

async function assertMember(gameId, userId, db) {
    const row = await query(db, 'get', 'SELECT 1 AS ok FROM game_players WHERE game_id=? AND user_id=?', [gameId, userId]);
    if (!row) { const error = new Error('not_game_member'); error.statusCode = 403; throw error; }
}

async function selectCandidate(gameId, userId, candidateId, replaceSenatorId, stationId, currentTurn, db = dbDefault) {
    await assertMember(gameId, userId, db);
    const session = await ensureOpenSession(gameId, userId, currentTurn, db);
    if (!session) return { success: false, error: 'no_open_senate_session', httpStatus: 409 };
    const candidate = await query(db, 'get', `SELECT * FROM senate_candidates WHERE id=? AND session_id=? AND selected=0`, [candidateId, session.id]);
    if (!candidate) return { success: false, error: 'candidate_not_available', httpStatus: 404 };
    const stations = await getStations(gameId, userId, db);
    const { seatCapacity } = await getGovernmentCapacity(gameId, userId, currentTurn, stations, db);
    const activeCount = await query(db, 'get', `SELECT COUNT(*) AS count FROM senate_senators WHERE game_id=? AND user_id=? AND status='active'`, [gameId, userId]);
    if (!replaceSenatorId && Number(activeCount?.count || 0) >= seatCapacity) return { success: false, error: 'senate_capacity_reached', httpStatus: 409 };
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

async function closeSessionUnchecked(gameId, userId, currentTurn, db) {
    await assertMember(gameId, userId, db);
    const session = await ensureOpenSession(gameId, userId, currentTurn, db);
    if (!session) return { success: false, error: 'no_open_senate_session', httpStatus: 409 };
    const objectives = await query(db, 'all', `SELECT * FROM senator_objectives WHERE session_id=? AND status IN ('active','completed')`, [session.id]);
    for (const objective of objectives) {
        const senator = await query(db, 'get', `SELECT * FROM senate_senators WHERE id=? AND status='active'`, [objective.senator_id]);
        const progress = parseJson(objective.progress_json, {});
        const completed = Boolean(senator?.station_id && (objective.status === 'completed' || Number(progress.current || 0) >= Number(progress.target || 1)));
        await query(db, 'run', `UPDATE senator_objectives SET status=?,completed_turn=CASE WHEN ?='completed' THEN COALESCE(completed_turn,?) ELSE NULL END WHERE id=?`, [completed ? 'completed' : 'expired', completed ? 'completed' : 'expired', currentTurn, objective.id]);
        if (senator) await query(db, 'run', `UPDATE senate_senators SET happiness=MIN(100,MAX(0,happiness+?)),updated_at=CURRENT_TIMESTAMP WHERE id=?`, [completed ? Number(objective.happiness_reward || 10) : -2, senator.id]);
    }
    const active = await query(db, 'all', `SELECT * FROM senate_senators WHERE game_id=? AND user_id=? AND status='active'`, [gameId, userId]);
    const capitalAward = await politicalCapitalService.awardCapitalForSession(gameId, userId, session.id, currentTurn, db);
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
    await activityService.append(db, {
        gameId,
        userId,
        turnNumber: currentTurn,
        eventType: 'senate_session_closed',
        severity: 'info',
        summary: `Senate session concluded; gained ${capitalAward.award} political capital.`,
        data: { sessionId: Number(session.id), capitalAward: capitalAward.award }
    });
    await recalculatePoliticalState(gameId, userId, currentTurn, db);
    return { success: true, state: await getState(gameId, userId, db) };
}

async function closeSession(gameId, userId, currentTurn, db = dbDefault) {
    return withSavepoint(db, () => closeSessionUnchecked(gameId, userId, currentTurn, db));
}

async function proposeCivicNameUnchecked(gameId, userId, input, currentTurn, db) {
    await assertMember(gameId, userId, db);
    await ensurePoliticalState(gameId, userId, currentTurn, db);
    const result = await civicNamingService.proposeCivicName(gameId, userId, { ...input, submittedTurn: currentTurn }, db);
    if (!result.success) return result;
    if (!result.idempotent) {
        await activityService.append(db, {
            gameId,
            userId,
            turnNumber: currentTurn,
            eventType: 'civic_naming_proposal',
            severity: 'info',
            summary: `Naming proposal submitted: ${result.proposal.proposedName}.`,
            data: { proposalId: result.proposal.id, targetType: result.proposal.targetType, targetId: result.proposal.targetId, cost: civicNamingService.CAPITAL_COST }
        });
    }
    return { ...result, state: await getState(gameId, userId, db) };
}

async function proposeCivicName(gameId, userId, input, currentTurn, db = dbDefault) {
    return withSavepoint(db, () => proposeCivicNameUnchecked(gameId, userId, input, currentTurn, db));
}

async function openSessionsAtTurn(gameId, turnNumber, db = dbDefault) {
    if (Number(turnNumber) % 100 !== 0) return [];
    const players = await query(db, 'all', 'SELECT user_id FROM game_players WHERE game_id=?', [gameId]);
    const opened = [];
    for (const player of players) {
        const session = await openSession(gameId, player.user_id, turnNumber, db);
        if (session.newlyOpened) opened.push(session);
    }
    return opened;
}

module.exports = { SENATOR_DEFINITIONS, POLICY_DEFINITIONS, getState, selectCandidate, closeSession, setPolicy, proposeCivicName, openSessionsAtTurn, ensurePoliticalState, recalculatePoliticalState, reconcileDestroyedSenators, getActivePolicyModifiers: policyService.getActivePolicyModifiers };
