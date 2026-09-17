const crypto = require('node:crypto');
const defaultDb = require('../../db');
const navigation = require('../../utils/navigation');
const { withSavepoint } = require('../game/savepoint');
const { isLiveShip } = require('../game/combat-rules');
const { physicalObjects } = require('./physical-placement');
const { parseCells, regionAt } = require('./region-geometry');
const { resolveKey } = require('./unified-archetype-registry');

const GENERATION_VERSION = 1;
const PROTOTYPE_UTILITY_ROLE = 'courier';
const SHIP_ARRIVAL_RULE = 'ship_arrival';
const PROTOTYPE_RESOLUTION_REQUIREMENTS = Object.freeze({
    arrivalRadius: 0,
    eligibleShips: Object.freeze([Object.freeze({ roles: Object.freeze([PROTOTYPE_UTILITY_ROLE]) })])
});

const CHANCE_BY_BAND = Object.freeze({ idle: 0, low: 0.02, moderate: 0.08, high: 0.2, saturated: 0.4, overloaded: 0.65 });
const SEVERITY_BY_BAND = Object.freeze({ low: 'minor', moderate: 'minor', high: 'significant', saturated: 'severe', overloaded: 'critical' });
const RESPONSE_TURNS_BY_SEVERITY = Object.freeze({ minor: 20, significant: 15, severe: 10, critical: 6 });
const HEALTH_LOSS_BY_SEVERITY = Object.freeze({ minor: 2, significant: 4, severe: 7, critical: 10 });

const INCIDENT_DEFINITIONS = Object.freeze(Object.fromEntries([
    ['asteroid-heavy', 'debris-migration', 'Debris Migration', 'A shifting debris field is threatening navigation and industrial traffic.'],
    ['wormhole', 'aperture-instability', 'Aperture Instability', 'Local spacetime anchors are losing synchronization around an unstable aperture.'],
    ['dark-nebula', 'sensor-map-drift', 'Sensor Map Drift', 'Moving gas fronts have made regional navigation and sensor maps unreliable.'],
    ['solar', 'radiation-front', 'Radiation Front', 'Forecast radiation is placing navigation arrays and exposed infrastructure at risk.'],
    ['standard', 'navigation-instability', 'Navigation Instability', 'Regional traffic and infrastructure strain are destabilizing navigation corridors.']
].map(([archetype, key, title, summary]) => [archetype, Object.freeze({
    key,
    title,
    summary,
    utilityRole: PROTOTYPE_UTILITY_ROLE,
    resolutionRule: SHIP_ARRIVAL_RULE,
    resolutionRequirements: PROTOTYPE_RESOLUTION_REQUIREMENTS
})])));

const RESOLUTION_RULE_HANDLERS = Object.freeze({
    [SHIP_ARRIVAL_RULE]: Object.freeze({
        findCandidate: findShipArrivalCandidate,
        publicState: publicShipArrivalResolution
    })
});

function incidentChanceForBand(band) { return CHANCE_BY_BAND[String(band || '').toLowerCase()] || 0; }

function deterministicIncidentRoll(gameId, sectorId, regionId, turnNumber, incidentKey = '', pressureScore = '') {
    const input = [GENERATION_VERSION, Number(gameId), Number(sectorId), String(regionId), Number(turnNumber), String(incidentKey), String(pressureScore)].join(':');
    return crypto.createHash('sha256').update(input).digest().readUInt32BE(0) / 0x100000000;
}

function incidentDefinitionForArchetype(archetype) {
    return INCIDENT_DEFINITIONS[resolveKey(archetype)] || INCIDENT_DEFINITIONS.standard;
}

function severityForBand(band) { return SEVERITY_BY_BAND[String(band || '').toLowerCase()] || 'minor'; }

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

    async resolveActiveIncidents(gameId, turnNumber) {
        const incidents = await this.all(
            `SELECT i.*,s.width,s.height
             FROM region_incidents i JOIN sectors s ON s.id=i.sector_id
             WHERE i.game_id=? AND i.status='active' AND i.target_x IS NOT NULL AND i.target_y IS NOT NULL
             ORDER BY i.id`,
            [gameId]
        );
        const resolved = [];
        const unsupported = [];
        for (const incident of incidents) {
            const handler = RESOLUTION_RULE_HANDLERS[incident.resolution_rule];
            if (!handler) {
                unsupported.push(Number(incident.id));
                continue;
            }
            const requirements = parseJsonObject(incident.resolution_requirements_json);
            const candidate = await handler.findCandidate(this, incident, requirements);
            if (!candidate) continue;
            await withSavepoint(this.db, async () => {
                const update = await this.run(
                    `UPDATE region_incidents
                     SET status='resolved',resolved_turn=?,outcome='stabilized',resolved_by_object_id=?,resolved_by_user_id=?,updated_at=CURRENT_TIMESTAMP
                     WHERE id=? AND status='active'`,
                    [turnNumber, candidate.id, candidate.owner_id, incident.id]
                );
                if (update.changes !== 1) return;
                resolved.push({
                    incidentId: Number(incident.id),
                    sectorId: Number(incident.sector_id),
                    regionId: String(incident.region_id),
                    objectId: Number(candidate.id),
                    userId: Number(candidate.owner_id)
                });
            });
        }
        return { resolved, unsupported };
    }

    async expireDueIncidents(gameId, turnNumber) {
        const due = await this.all(
            `SELECT i.id,i.sector_id,i.region_id,i.health_loss,r.health
             FROM region_incidents i JOIN regions r ON r.sector_id=i.sector_id AND r.region_id=i.region_id
             WHERE i.game_id=? AND i.status='active' AND i.due_turn<=? ORDER BY i.id`,
            [gameId, turnNumber]
        );
        const expired = [];
        for (const incident of due) {
            await withSavepoint(this.db, async () => {
                const loss = Math.max(0, Number(incident.health_loss) || 0);
                const before = Math.max(0, Number(incident.health) || 0);
                const after = Math.max(0, before - loss);
                const update = await this.run(
                    `UPDATE region_incidents
                     SET status='expired',resolved_turn=?,outcome='environmental_damage',applied_health_delta=?,updated_at=CURRENT_TIMESTAMP
                     WHERE id=? AND status='active'`,
                    [turnNumber, after - before, incident.id]
                );
                if (update.changes !== 1) return;
                await this.run('UPDATE regions SET health=?,updated_at=CURRENT_TIMESTAMP WHERE sector_id=? AND region_id=?', [after, incident.sector_id, incident.region_id]);
                expired.push({
                    incidentId: Number(incident.id),
                    sectorId: Number(incident.sector_id),
                    regionId: String(incident.region_id),
                    healthBefore: before,
                    healthAfter: after,
                    healthDelta: after - before
                });
            });
        }
        return expired;
    }

    async getPublicStateForSector(sectorId) {
        const currentTurnRow = await this.get(
            `SELECT t.turn_number FROM turns t JOIN sectors s ON s.game_id=t.game_id
             WHERE s.id=? ORDER BY t.turn_number DESC LIMIT 1`,
            [sectorId]
        );
        const currentTurn = Number(currentTurnRow?.turn_number || 1);
        const rows = await this.all(
            `SELECT id,region_id,incident_key,title,summary,utility_role,severity,status,created_turn,due_turn,
                    health_loss,applied_health_delta,resolved_turn,outcome,resolution_rule,resolution_requirements_json,target_x,target_y
             FROM region_incidents
             WHERE sector_id=? AND (status='active' OR (status IN ('resolved','expired') AND resolved_turn>=?))
             ORDER BY region_id,due_turn,id`,
            [sectorId, currentTurn - 1]
        );
        return rows.map(row => {
            const handler = RESOLUTION_RULE_HANDLERS[row.resolution_rule];
            const requirements = parseJsonObject(row.resolution_requirements_json);
            return {
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
                healthLoss: Number(row.health_loss || 0),
                turnsRemaining: row.status === 'active' ? Math.max(0, Number(row.due_turn) - currentTurn) : 0,
                resolution: handler?.publicState
                    ? handler.publicState(row, requirements)
                    : { rule: row.resolution_rule, target: { x: Number(row.target_x), y: Number(row.target_y) } },
                ...(row.status === 'resolved' || row.status === 'expired' ? {
                    resolvedTurn: Number(row.resolved_turn),
                    outcome: row.outcome,
                    ...(row.status === 'expired' ? { healthDelta: Number(row.applied_health_delta || 0) } : {})
                } : {})
            };
        });
    }

    async generateForTurn(gameId, turnNumber) {
        const snapshots = await this.all(
            `SELECT p.sector_id,p.region_id,p.turn_number,p.pressure_band,p.pressure_score,s.archetype,s.width,s.height,r.cells_json
             FROM region_pressure_history p
             JOIN sectors s ON s.id=p.sector_id
             JOIN regions r ON r.sector_id=p.sector_id AND r.region_id=p.region_id
             WHERE s.game_id=? AND p.turn_number=? ORDER BY p.sector_id,p.region_id`,
            [gameId, turnNumber]
        );
        const created = [];
        let suppressedByActiveIncident = 0;
        let skippedWithoutTarget = 0;
        for (const snapshot of snapshots) {
            const chance = incidentChanceForBand(snapshot.pressure_band);
            if (chance <= 0) continue;
            const active = await this.get(
                `SELECT id FROM region_incidents WHERE sector_id=? AND region_id=? AND status='active' LIMIT 1`,
                [snapshot.sector_id, snapshot.region_id]
            );
            if (active) {
                suppressedByActiveIncident++;
                continue;
            }
            const definition = incidentDefinitionForArchetype(snapshot.archetype);
            const roll = deterministicIncidentRoll(gameId, snapshot.sector_id, snapshot.region_id, turnNumber, definition.key, snapshot.pressure_score);
            if (roll >= chance) continue;
            const target = await this.findIncidentTarget(snapshot, definition, turnNumber);
            if (!target) {
                skippedWithoutTarget++;
                continue;
            }
            const severity = severityForBand(snapshot.pressure_band);
            const dueTurn = Number(turnNumber) + RESPONSE_TURNS_BY_SEVERITY[severity];
            const healthLoss = HEALTH_LOSS_BY_SEVERITY[severity];
            const result = await this.run(
                `INSERT OR IGNORE INTO region_incidents
                 (game_id,sector_id,region_id,incident_key,title,summary,utility_role,severity,status,created_turn,due_turn,
                  pressure_turn,pressure_band,pressure_score,generation_roll,generation_version,health_loss,resolution_rule,
                  resolution_requirements_json,target_x,target_y)
                 VALUES(?,?,?,?,?,?,?,?,'active',?,?,?,?,?,?,?,?,?,?,?,?)`,
                [gameId, snapshot.sector_id, snapshot.region_id, definition.key, definition.title, definition.summary,
                    definition.utilityRole, severity, turnNumber, dueTurn, snapshot.turn_number, snapshot.pressure_band,
                    snapshot.pressure_score, roll, GENERATION_VERSION, healthLoss, definition.resolutionRule,
                    JSON.stringify(definition.resolutionRequirements), target.x, target.y]
            );
            if (result.changes) {
                created.push({
                    id: result.lastID,
                    sectorId: Number(snapshot.sector_id),
                    regionId: String(snapshot.region_id),
                    key: definition.key,
                    severity,
                    createdTurn: Number(turnNumber),
                    dueTurn,
                    healthLoss,
                    target
                });
            }
        }
        return { gameId: Number(gameId), turnNumber: Number(turnNumber), evaluated: snapshots.length, suppressedByActiveIncident, skippedWithoutTarget, created };
    }

    async findIncidentTarget(snapshot, definition, turnNumber) {
        const cells = parseCells(snapshot.cells_json)
            .filter(cell => Number.isInteger(Number(cell.row)) && Number.isInteger(Number(cell.col)))
            .sort((a, b) => Number(a.row) - Number(b.row) || Number(a.col) - Number(b.col));
        if (!cells.length) return null;
        const width = Math.max(1, Number(snapshot.width) || 5000);
        const height = Math.max(1, Number(snapshot.height) || 5000);
        const cellWidth = width / 3;
        const cellHeight = height / 3;
        const digest = crypto.createHash('sha256').update([GENERATION_VERSION, snapshot.sector_id, snapshot.region_id, turnNumber, definition.key, 'target'].join(':')).digest();
        const start = digest.readUInt16BE(0) % cells.length;
        const xFraction = 0.2 + (digest.readUInt16BE(2) / 0xffff) * 0.6;
        const yFraction = 0.2 + (digest.readUInt16BE(4) / 0xffff) * 0.6;
        const objects = await physicalObjects(this.db, snapshot.sector_id);
        const mover = { id: null, type: 'ship', meta: { role: PROTOTYPE_UTILITY_ROLE, blueprintId: 'swift-courier' } };
        for (let offset = 0; offset < cells.length; offset += 1) {
            const cell = cells[(start + offset) % cells.length];
            const origin = {
                x: Math.round((Number(cell.col) + xFraction) * cellWidth),
                y: Math.round((Number(cell.row) + yFraction) * cellHeight)
            };
            const target = navigation.findPlacement(objects, mover, origin, {
                maxRadius: Math.max(24, Math.floor(Math.min(cellWidth, cellHeight) * 0.2)),
                accept: point => regionAt(point.x, point.y, [{ region_id: snapshot.region_id, cells_json: snapshot.cells_json }], { width, height }) === String(snapshot.region_id)
            });
            if (target) return target;
        }
        return null;
    }
}

async function findShipArrivalCandidate(service, incident, requirements) {
    requirements = normalizeShipArrivalRequirements(requirements, incident.utility_role);
    const radius = Math.max(0, Number(requirements.arrivalRadius) || 0);
    const candidates = await service.all(
        `SELECT so.* FROM sector_objects so
         JOIN game_players gp ON gp.game_id=? AND gp.user_id=so.owner_id
         WHERE so.sector_id=? AND so.type='ship' ORDER BY so.id`,
        [incident.game_id, incident.sector_id]
    );
    return candidates.find(ship => {
        const meta = parseJsonObject(ship.meta);
        if (!isLiveShip(ship) || meta.disabled === true || meta.operational === false) return false;
        if (!matchesEligibleShip(ship, meta, requirements.eligibleShips)) return false;
        return Math.hypot(Number(ship.x) - Number(incident.target_x), Number(ship.y) - Number(incident.target_y)) <= radius;
    }) || null;
}

function matchesEligibleShip(ship, meta, selectors) {
    const eligible = Array.isArray(selectors) && selectors.length ? selectors : [{}];
    return eligible.some(selector => {
        const roles = Array.isArray(selector.roles) ? selector.roles.map(String) : [];
        const blueprintIds = Array.isArray(selector.blueprintIds) ? selector.blueprintIds.map(String) : [];
        const objectIds = Array.isArray(selector.objectIds) ? selector.objectIds.map(Number) : [];
        if (roles.length && !roles.includes(String(meta.role || ''))) return false;
        if (blueprintIds.length && !blueprintIds.includes(String(meta.blueprintId || ''))) return false;
        if (objectIds.length && !objectIds.includes(Number(ship.id))) return false;
        return true;
    });
}

function normalizeShipArrivalRequirements(parsed, fallbackRole = PROTOTYPE_UTILITY_ROLE) {
    return {
        arrivalRadius: Math.max(0, Number(parsed.arrivalRadius) || 0),
        eligibleShips: Array.isArray(parsed.eligibleShips) && parsed.eligibleShips.length
            ? parsed.eligibleShips
            : [{ roles: [fallbackRole || PROTOTYPE_UTILITY_ROLE] }]
    };
}

function publicShipArrivalResolution(row, requirements) {
    requirements = normalizeShipArrivalRequirements(requirements, row.utility_role);
    return {
        rule: row.resolution_rule || SHIP_ARRIVAL_RULE,
        target: { x: Number(row.target_x), y: Number(row.target_y), radius: requirements.arrivalRadius },
        eligibleShips: requirements.eligibleShips.map(selector => ({
            ...(Array.isArray(selector.roles) ? { roles: selector.roles.map(String) } : {}),
            ...(Array.isArray(selector.blueprintIds) ? { blueprintIds: selector.blueprintIds.map(String) } : {})
        }))
    };
}

function parseJsonObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

module.exports = {
    RegionIncidentService,
    GENERATION_VERSION,
    PROTOTYPE_UTILITY_ROLE,
    SHIP_ARRIVAL_RULE,
    PROTOTYPE_RESOLUTION_REQUIREMENTS,
    RESPONSE_TURNS_BY_SEVERITY,
    HEALTH_LOSS_BY_SEVERITY,
    incidentChanceForBand,
    deterministicIncidentRoll,
    incidentDefinitionForArchetype,
    severityForBand,
    matchesEligibleShip
};
