const crypto = require('node:crypto');
const defaultDb = require('../../db');
const { withSavepoint } = require('../game/savepoint');
const { resolveKey } = require('./unified-archetype-registry');

const GENERATION_VERSION = 1;

const CHANCE_BY_BAND = Object.freeze({
    idle: 0,
    low: 0.02,
    moderate: 0.08,
    high: 0.2,
    saturated: 0.4,
    overloaded: 0.65
});

const SEVERITY_BY_BAND = Object.freeze({
    low: 'minor',
    moderate: 'minor',
    high: 'significant',
    saturated: 'severe',
    overloaded: 'critical'
});

const RESPONSE_TURNS_BY_SEVERITY = Object.freeze({
    minor: 5,
    significant: 4,
    severe: 3,
    critical: 2
});

const INCIDENT_DEFINITIONS = Object.freeze({
    'asteroid-heavy': Object.freeze({
        key: 'debris-migration',
        title: 'Debris Migration',
        summary: 'A shifting debris field is threatening navigation and industrial traffic.',
        utilityRole: 'engineering'
    }),
    wormhole: Object.freeze({
        key: 'aperture-instability',
        title: 'Aperture Instability',
        summary: 'Local spacetime anchors are losing synchronization around an unstable aperture.',
        utilityRole: 'science'
    }),
    'dark-nebula': Object.freeze({
        key: 'sensor-map-drift',
        title: 'Sensor Map Drift',
        summary: 'Moving gas fronts have made regional navigation and sensor maps unreliable.',
        utilityRole: 'survey'
    }),
    solar: Object.freeze({
        key: 'radiation-front',
        title: 'Radiation Front',
        summary: 'Forecast radiation is placing navigation arrays and exposed infrastructure at risk.',
        utilityRole: 'engineering'
    }),
    standard: Object.freeze({
        key: 'navigation-instability',
        title: 'Navigation Instability',
        summary: 'Regional traffic and infrastructure strain are destabilizing navigation corridors.',
        utilityRole: 'survey'
    })
});

function incidentChanceForBand(band) {
    return CHANCE_BY_BAND[String(band || '').toLowerCase()] || 0;
}

function deterministicIncidentRoll(gameId, sectorId, regionId, turnNumber, incidentKey = '', pressureScore = '') {
    const input = [
        GENERATION_VERSION,
        Number(gameId),
        Number(sectorId),
        String(regionId),
        Number(turnNumber),
        String(incidentKey),
        String(pressureScore)
    ].join(':');
    const value = crypto.createHash('sha256').update(input).digest().readUInt32BE(0);
    return value / 0x100000000;
}

function incidentDefinitionForArchetype(archetype) {
    const key = resolveKey(archetype);
    return INCIDENT_DEFINITIONS[key] || INCIDENT_DEFINITIONS.standard;
}

function severityForBand(band) {
    return SEVERITY_BY_BAND[String(band || '').toLowerCase()] || 'minor';
}

class RegionIncidentService {
    constructor(database = defaultDb) { this.db = database; }

    all(sql, params = []) {
        return new Promise((resolve, reject) => this.db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => this.db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => this.db.run(sql, params, function(error) {
            if (error) reject(error);
            else resolve({ changes: this.changes, lastID: this.lastID });
        }));
    }

    async incidentContext(incidentId, userId, expectedSectorId = null) {
        const incident = await this.get(
            `SELECT i.*,s.game_id AS sector_game_id
             FROM region_incidents i
             JOIN sectors s ON s.id=i.sector_id
             WHERE i.id=?`,
            [incidentId]
        );
        if (!incident || Number(incident.game_id) !== Number(incident.sector_game_id)) {
            return { success: false, error: 'incident_not_found' };
        }
        if (expectedSectorId != null && Number(incident.sector_id) !== Number(expectedSectorId)) {
            return { success: false, error: 'incident_not_found' };
        }
        const member = await this.get(
            'SELECT 1 FROM game_players WHERE game_id=? AND user_id=?',
            [incident.game_id, userId]
        );
        if (!member) return { success: false, error: 'not_a_game_member' };
        return { success: true, incident };
    }

    beginResponse({ incidentId, userId, turnNumber, sectorId = null }) {
        return withSavepoint(this.db, async () => {
            if (!validIdentifier(incidentId) || !validIdentifier(userId) || !validTurn(turnNumber)) {
                return { success: false, error: 'invalid_incident_response' };
            }
            const context = await this.incidentContext(incidentId, userId, sectorId);
            if (!context.success) return context;
            if (context.incident.status !== 'active') return { success: false, error: 'incident_not_active' };
            const existing = await this.get(
                'SELECT * FROM region_incident_responses WHERE incident_id=? AND user_id=?',
                [incidentId, userId]
            );
            if (existing?.status === 'active') return { success: true, response: publicResponse(existing) };
            if (existing?.status === 'completed') return { success: false, error: 'response_already_completed' };
            if (existing?.status === 'cancelled') {
                await this.run(
                    `UPDATE region_incident_responses
                     SET status='active',started_turn=?,completed_turn=NULL,outcome=NULL,updated_at=CURRENT_TIMESTAMP
                     WHERE id=? AND status='cancelled'`,
                    [turnNumber, existing.id]
                );
                const restarted = await this.get('SELECT * FROM region_incident_responses WHERE id=?', [existing.id]);
                return { success: true, restarted: true, response: publicResponse(restarted) };
            }
            const result = await this.run(
                `INSERT OR IGNORE INTO region_incident_responses
                 (incident_id,game_id,user_id,status,started_turn)
                 VALUES(?,?,?,'active',?)`,
                [incidentId, context.incident.game_id, userId, turnNumber]
            );
            const response = await this.get(
                'SELECT * FROM region_incident_responses WHERE incident_id=? AND user_id=?',
                [incidentId, userId]
            );
            return { success: true, response: publicResponse(response) };
        });
    }

    cancelResponse({ incidentId, userId, turnNumber, sectorId = null }) {
        return withSavepoint(this.db, async () => {
            if (!validIdentifier(incidentId) || !validIdentifier(userId) || !validTurn(turnNumber)) {
                return { success: false, error: 'invalid_incident_response' };
            }
            const context = await this.incidentContext(incidentId, userId, sectorId);
            if (!context.success) return context;
            const response = await this.get(
                'SELECT * FROM region_incident_responses WHERE incident_id=? AND user_id=?',
                [incidentId, userId]
            );
            if (!response) return { success: false, error: 'response_not_found' };
            if (response.status === 'cancelled') return { success: true, response: publicResponse(response) };
            if (response.status === 'completed') return { success: false, error: 'response_already_completed' };
            await this.run(
                `UPDATE region_incident_responses
                 SET status='cancelled',completed_turn=?,outcome='cancelled_by_responder',updated_at=CURRENT_TIMESTAMP
                 WHERE id=? AND status='active'`,
                [turnNumber, response.id]
            );
            const cancelled = await this.get('SELECT * FROM region_incident_responses WHERE id=?', [response.id]);
            return { success: true, response: publicResponse(cancelled) };
        });
    }

    completeResponse({ incidentId, userId, turnNumber, outcome = 'stabilized' }) {
        return withSavepoint(this.db, async () => {
            if (!validIdentifier(incidentId) || !validIdentifier(userId) || !validTurn(turnNumber)) {
                return { success: false, error: 'invalid_incident_response' };
            }
            if (outcome !== 'stabilized') return { success: false, error: 'invalid_incident_outcome' };
            const context = await this.incidentContext(incidentId, userId);
            if (!context.success) return context;
            const response = await this.get(
                'SELECT * FROM region_incident_responses WHERE incident_id=? AND user_id=?',
                [incidentId, userId]
            );
            if (context.incident.status === 'resolved' && response?.status === 'completed') {
                return {
                    success: true,
                    incidentId: Number(incidentId),
                    status: 'resolved',
                    outcome: context.incident.outcome,
                    resolvedTurn: Number(context.incident.resolved_turn)
                };
            }
            if (context.incident.status !== 'active') return { success: false, error: 'incident_not_active' };
            if (!response || response.status !== 'active') return { success: false, error: 'active_response_required' };
            const incidentUpdate = await this.run(
                `UPDATE region_incidents
                 SET status='resolved',resolved_turn=?,outcome=?,updated_at=CURRENT_TIMESTAMP
                 WHERE id=? AND status='active'`,
                [turnNumber, outcome, incidentId]
            );
            if (incidentUpdate.changes !== 1) return { success: false, error: 'incident_not_active' };
            await this.run(
                `UPDATE region_incident_responses
                 SET status='completed',completed_turn=?,outcome=?,updated_at=CURRENT_TIMESTAMP
                 WHERE id=? AND status='active'`,
                [turnNumber, outcome, response.id]
            );
            await this.run(
                `UPDATE region_incident_responses
                 SET status='cancelled',completed_turn=?,outcome='resolved_by_another_response',updated_at=CURRENT_TIMESTAMP
                 WHERE incident_id=? AND id<>? AND status='active'`,
                [turnNumber, incidentId, response.id]
            );
            return { success: true, incidentId: Number(incidentId), status: 'resolved', outcome, resolvedTurn: Number(turnNumber) };
        });
    }

    async getPublicStateForSector(sectorId, viewerUserId = null) {
        const currentTurnRow = await this.get(
            `SELECT t.turn_number
             FROM turns t JOIN sectors s ON s.game_id=t.game_id
             WHERE s.id=? ORDER BY t.turn_number DESC LIMIT 1`,
            [sectorId]
        );
        const currentTurn = Number(currentTurnRow?.turn_number || 1);
        const rows = await this.all(
            `SELECT i.id,i.region_id,i.incident_key,i.title,i.summary,i.utility_role,i.severity,
                    i.status,i.created_turn,i.due_turn,i.resolved_turn,i.outcome,
                    SUM(CASE WHEN r.status='active' THEN 1 ELSE 0 END) AS active_response_count,
                    MAX(CASE WHEN r.user_id=? AND r.status='active' THEN 1 ELSE 0 END) AS viewer_responding
             FROM region_incidents i
             LEFT JOIN region_incident_responses r ON r.incident_id=i.id
             WHERE i.sector_id=?
               AND (i.status='active' OR (i.status='resolved' AND i.resolved_turn>=?))
             GROUP BY i.id
             ORDER BY i.region_id,i.due_turn,i.id`,
            [viewerUserId, sectorId, currentTurn - 1]
        );
        return rows.map(row => ({
            id: Number(row.id),
            regionId: String(row.region_id),
            key: row.incident_key,
            title: row.title,
            summary: row.summary,
            utilityRole: row.utility_role,
            severity: row.severity,
            status: row.status,
            createdTurn: Number(row.created_turn),
            dueTurn: Number(row.due_turn),
            ...(row.status === 'resolved' ? {
                resolvedTurn: Number(row.resolved_turn),
                outcome: row.outcome,
                response: { status: 'resolved', viewerResponding: false }
            } : {
                response: {
                    status: Number(row.active_response_count) > 0 ? 'responding' : 'unanswered',
                    viewerResponding: Number(row.viewer_responding) === 1
                }
            })
        }));
    }

    async generateForTurn(gameId, turnNumber) {
        const snapshots = await this.all(
            `SELECT p.sector_id,p.region_id,p.turn_number,p.pressure_band,p.pressure_score,s.archetype
             FROM region_pressure_history p
             JOIN sectors s ON s.id=p.sector_id
             WHERE s.game_id=? AND p.turn_number=?
             ORDER BY p.sector_id,p.region_id`,
            [gameId, turnNumber]
        );
        const created = [];
        let suppressedByActiveIncident = 0;
        for (const snapshot of snapshots) {
            const chance = incidentChanceForBand(snapshot.pressure_band);
            if (chance <= 0) continue;
            const active = await this.get(
                `SELECT id FROM region_incidents
                 WHERE sector_id=? AND region_id=? AND status='active' LIMIT 1`,
                [snapshot.sector_id, snapshot.region_id]
            );
            if (active) {
                suppressedByActiveIncident++;
                continue;
            }
            const definition = incidentDefinitionForArchetype(snapshot.archetype);
            const roll = deterministicIncidentRoll(
                gameId,
                snapshot.sector_id,
                snapshot.region_id,
                turnNumber,
                definition.key,
                snapshot.pressure_score
            );
            if (roll >= chance) continue;
            const severity = severityForBand(snapshot.pressure_band);
            const dueTurn = Number(turnNumber) + RESPONSE_TURNS_BY_SEVERITY[severity];
            const result = await this.run(
                `INSERT OR IGNORE INTO region_incidents
                 (game_id,sector_id,region_id,incident_key,title,summary,utility_role,severity,status,
                  created_turn,due_turn,pressure_turn,pressure_band,pressure_score,generation_roll,generation_version)
                 VALUES(?,?,?,?,?,?,?,?, 'active', ?,?,?,?,?,?,?)`,
                [
                    gameId, snapshot.sector_id, snapshot.region_id,
                    definition.key, definition.title, definition.summary, definition.utilityRole, severity,
                    turnNumber, dueTurn, snapshot.turn_number, snapshot.pressure_band,
                    snapshot.pressure_score, roll, GENERATION_VERSION
                ]
            );
            if (result.changes) {
                created.push({
                    id: result.lastID,
                    sectorId: Number(snapshot.sector_id),
                    regionId: String(snapshot.region_id),
                    key: definition.key,
                    severity,
                    createdTurn: Number(turnNumber),
                    dueTurn
                });
            }
        }
        return {
            gameId: Number(gameId),
            turnNumber: Number(turnNumber),
            evaluated: snapshots.length,
            suppressedByActiveIncident,
            created
        };
    }
}

function publicResponse(row) {
    return {
        id: Number(row.id),
        incidentId: Number(row.incident_id),
        status: row.status,
        startedTurn: Number(row.started_turn),
        completedTurn: row.completed_turn == null ? null : Number(row.completed_turn),
        outcome: row.outcome || null
    };
}

function validIdentifier(value) {
    return Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function validTurn(value) {
    return Number.isSafeInteger(Number(value)) && Number(value) >= 0;
}

module.exports = {
    RegionIncidentService,
    GENERATION_VERSION,
    incidentChanceForBand,
    deterministicIncidentRoll,
    incidentDefinitionForArchetype,
    severityForBand
};
