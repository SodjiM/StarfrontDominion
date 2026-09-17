const dbDefault = require('../../db');
const { withSavepoint } = require('./savepoint');

const EVENT_TYPES = new Set([
    'production', 'ship_build', 'combat', 'raid', 'trade', 'mining',
    'scan', 'movement', 'regional_response', 'pilot_generation'
]);

const query = (db, method, sql, params = []) => new Promise((resolve, reject) => {
    if (method === 'run') {
        db.run(sql, params, function(error) { return error ? reject(error) : resolve(this); });
    } else {
        db[method](sql, params, (error, value) => error ? reject(error) : resolve(value));
    }
});

function parseJson(value, fallback = {}) {
    try { return typeof value === 'string' ? JSON.parse(value || '') : (value ?? fallback); } catch { return fallback; }
}

function finiteAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : 1;
}

function matchesScope(target, event) {
    const scope = target.scope || 'domain';
    if (scope === 'station') return Number(event.stationId) === Number(target.stationId);
    if (scope === 'system') return Number(event.sectorId) === Number(target.sectorId);
    if (scope === 'region') {
        return Number(event.sectorId) === Number(target.sectorId)
            && String(event.regionId) === String(target.regionId);
    }
    return scope === 'domain';
}

class ObjectiveEventService {
    constructor(database = dbDefault) { this.db = database; }

    async recordEvent(event) {
        const type = String(event?.type || '');
        const sourceType = String(event?.sourceType || '');
        const sourceId = String(event?.sourceId ?? '');
        const gameId = Number(event?.gameId);
        const userId = Number(event?.userId);
        const turnNumber = Number(event?.turnNumber);
        if (!EVENT_TYPES.has(type)) throw new Error(`unknown_objective_event:${type}`);
        if (!sourceType || !sourceId || !Number.isInteger(gameId) || !Number.isInteger(userId) || !Number.isInteger(turnNumber)) {
            throw new Error('invalid_objective_event');
        }

        const objectives = await query(this.db, 'all', `
            SELECT objective.*
            FROM senator_objectives objective
            JOIN senate_sessions session ON session.id=objective.session_id AND session.status='open'
            JOIN senate_senators senator ON senator.id=objective.senator_id
                AND senator.game_id=? AND senator.user_id=? AND senator.status='active'
            WHERE objective.status='active'
            ORDER BY objective.id`, [gameId, userId]);
        const applied = [];
        for (const objective of objectives || []) {
            const target = parseJson(objective.target_json, {});
            if (!Array.isArray(target.eventTypes) || !target.eventTypes.includes(type) || !matchesScope(target, event)) continue;
            const amount = finiteAmount(event.amount);
            const application = await withSavepoint(this.db, async () => {
                const inserted = await query(this.db, 'run', `
                    INSERT OR IGNORE INTO senator_objective_events
                        (objective_id,game_id,user_id,event_type,source_type,source_id,turn_number,amount,summary,context_json)
                    VALUES(?,?,?,?,?,?,?,?,?,?)`, [
                    objective.id, gameId, userId, type, sourceType, sourceId, turnNumber, amount,
                    String(event.summary || 'Objective progress recorded.'), JSON.stringify(event.context || {})
                ]);
                if (Number(inserted.changes || 0) !== 1) return null;
                const current = await query(this.db, 'get', 'SELECT progress_json FROM senator_objectives WHERE id=?', [objective.id]);
                const progress = parseJson(current?.progress_json, { current: 0, target: 1 });
                progress.current = Math.min(Number(progress.target || 1), Number(progress.current || 0) + amount);
                const status = progress.current >= Number(progress.target || 1) ? 'completed' : 'active';
                await query(this.db, 'run', `
                    UPDATE senator_objectives
                    SET progress_json=?,status=?,completed_turn=CASE WHEN ?='completed' THEN COALESCE(completed_turn,?) ELSE completed_turn END
                    WHERE id=?`, [JSON.stringify(progress), status, status, turnNumber, objective.id]);
                return { objectiveId: Number(objective.id), eventType: type, amount, status };
            });
            if (application) applied.push(application);
        }
        return { applied };
    }

    async processTurn(gameId, turnNumber) {
        const events = [];
        const builds = await query(this.db, 'all', `
            SELECT event.*, object.sector_id, object.type AS object_type, object.meta AS object_meta
            FROM turn_build_events event
            LEFT JOIN sector_objects object ON object.id=event.object_id
            WHERE event.game_id=? AND event.turn_number=? ORDER BY event.id`, [gameId, turnNumber]);
        for (const row of builds || []) {
            const meta = parseJson(row.object_meta, {});
            events.push({
                gameId, userId: Number(row.user_id), turnNumber, sourceType: 'turn_build', sourceId: row.id,
                type: row.kind === 'ship' ? 'ship_build' : 'production', stationId: row.object_type === 'station' ? row.object_id : meta.homeStationId,
                sectorId: row.sector_id, summary: `${row.name} completed at the senator's station.`, context: { kind: row.kind }
            });
        }

        const harvests = await query(this.db, 'all', `
            SELECT event.*, ship.owner_id AS user_id, ship.sector_id, resource.resource_name
            FROM turn_harvest_events event
            JOIN sector_objects ship ON ship.id=event.ship_id
            LEFT JOIN resource_types resource ON resource.id=event.resource_type_id
            WHERE event.game_id=? AND event.turn_number=? ORDER BY event.id`, [gameId, turnNumber]);
        for (const row of harvests || []) events.push({
            gameId, userId: Number(row.user_id), turnNumber, sourceType: 'turn_harvest', sourceId: row.id,
            type: 'mining', amount: Number(row.amount || 1), sectorId: row.sector_id,
            summary: `Harvested ${row.amount} ${row.resource_name || 'resources'} in the senator's system.`
        });

        const movements = await query(this.db, 'all', `
            SELECT history.*, object.owner_id AS user_id
            FROM movement_history history
            JOIN sector_objects object ON object.id=history.object_id
            WHERE history.game_id=? AND history.turn_number=? ORDER BY history.id`, [gameId, turnNumber]);
        for (const row of movements || []) events.push({
            gameId, userId: Number(row.user_id), turnNumber, sourceType: 'movement_history', sourceId: row.id,
            type: 'movement', sectorId: row.sector_id,
            summary: `A fleet operation advanced in the senator's system.`
        });

        const combats = await query(this.db, 'all', `
            SELECT log.*, attacker.owner_id AS user_id, attacker.sector_id
            FROM combat_logs log
            JOIN sector_objects attacker ON attacker.id=log.attacker_id
            WHERE log.game_id=? AND log.turn_number=?
              AND (log.event_type='kill' OR (log.event_type='attack' AND CASE WHEN json_valid(log.data) THEN COALESCE(json_extract(log.data,'$.damage'),0) ELSE 0 END>0))
            ORDER BY log.id`, [gameId, turnNumber]);
        for (const row of combats || []) events.push({
            gameId, userId: Number(row.user_id), turnNumber, sourceType: 'combat_log', sourceId: row.id,
            type: 'combat', sectorId: row.sector_id,
            summary: row.event_type === 'kill' ? `Your forces destroyed a target in the senator's system.` : `Your forces dealt damage in the senator's system.`
        });

        const responses = await query(this.db, 'all', `
            SELECT id,sector_id,region_id,resolved_by_user_id AS user_id,title
            FROM region_incidents
            WHERE game_id=? AND resolved_turn=? AND status='resolved' AND resolved_by_user_id IS NOT NULL
            ORDER BY id`, [gameId, turnNumber]);
        for (const row of responses || []) events.push({
            gameId, userId: Number(row.user_id), turnNumber, sourceType: 'region_incident', sourceId: row.id,
            type: 'regional_response', sectorId: row.sector_id, regionId: row.region_id,
            summary: `Resolved ${row.title || 'a regional incident'} in the senator's system.`
        });

        const pilots = await query(this.db, 'all', `
            SELECT * FROM turn_pilot_events WHERE game_id=? AND turn_number=? ORDER BY id`, [gameId, turnNumber]);
        for (const row of pilots || []) events.push({
            gameId, userId: Number(row.user_id), turnNumber, sourceType: 'turn_pilot', sourceId: row.id,
            type: 'pilot_generation', amount: Number(row.recovered || 0) + Number(row.recruited || 0),
            summary: `${Number(row.recovered || 0) + Number(row.recruited || 0)} pilots joined or returned to service.`
        });

        const applied = [];
        for (const event of events) {
            const result = await this.recordEvent(event);
            applied.push(...result.applied);
        }
        return { processed: events.length, applied };
    }
}

module.exports = { EVENT_TYPES, ObjectiveEventService, matchesScope };
