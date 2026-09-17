const { placeNear, query, physicalObjects } = require('../world/physical-placement');
const nav = require('../../utils/navigation');
const scale = nav.scale;
const db = require('../../db');
const { SHIP_BLUEPRINTS, computeAllRequirements } = require('../registry/blueprints');
const { Abilities } = require('../registry/abilities');
const { CargoManager } = require('./cargo-manager');
const { STRUCTURE_TYPES } = require('../../domain/structures');
const { infrastructureDefinitionForKey } = require('../../domain/infrastructure');
const { RegionInfrastructureService } = require('../world/region-infrastructure.service');
const { InfrastructureLifecycleService } = require('./infrastructure-lifecycle.service');

async function policyAdjustedBuildTurns(gameId, userId, blueprint) {
    const baseTurns = Math.max(1, Number(blueprint.buildTimeTurns || 1));
    const { getActivePolicyModifiers } = require('./policy.service');
    const modifiers = await getActivePolicyModifiers(gameId, userId, db);
    const reduction = Math.max(0, Math.floor(Number(modifiers.shipBuildTimeReduction || 0)));
    return Math.max(1, baseTurns - reduction);
}

const STRUCTURE_BUILD_COSTS = Object.freeze({
    'storage-box': 1, 'warp-beacon': 2, 'interstellar-gate': 5,
    'sun-station': 8, 'planet-station': 6, 'moon-station': 4
});

const { withSavepoint } = require('./savepoint');

// HTTP/socket callers already hold mutation-lock for this shared connection.
class BuildService {
    buildStructure(args) { return withSavepoint(db, () => this._buildStructure(args)); }
    buildShip(args) { return withSavepoint(db, () => this._buildShip(args)); }
    cancelShipBuild(args) { return withSavepoint(db, () => this._cancelShipBuild(args)); }
    deployStructure(args) { return withSavepoint(db, () => this._deployStructure(args)); }
    deployInterstellarGate(args) { return withSavepoint(db, () => this._deployInterstellarGate(args)); }
    async _checkInfrastructureCapacity(placements) {
        const check = await new RegionInfrastructureService(db).checkPlacements(placements);
        if (check.ok) return null;
        const { ok, error, ...details } = check;
        return { success: false, httpStatus: error === 'regional_capacity_exceeded' ? 409 : 400, error, details };
    }
    async _recordBuild(gameId, userId, objectId, kind, name, turnNumber = null) {
        const turn = await new Promise((resolve) => db.get('SELECT turn_number FROM turns WHERE game_id=? ORDER BY turn_number DESC LIMIT 1', [gameId], (e, r) => resolve(r?.turn_number || 1)));
        await new Promise((resolve, reject) => db.run('INSERT INTO turn_build_events(game_id,turn_number,user_id,object_id,kind,name) VALUES(?,?,?,?,?,?)', [gameId,turnNumber || turn,userId,objectId,kind,name], (e) => e ? reject(e) : resolve()));
    }

    async canBuildShip({ gameId, userId, stationId, blueprintId, freeBuild = false }) {
        const bp = (SHIP_BLUEPRINTS || []).find(b => b.id === blueprintId);
        if (!bp) return { ok: false, reason: 'unknown_blueprint' };
        const station = await new Promise((resolve, reject) => db.get('SELECT * FROM sector_objects WHERE id=? AND owner_id=? AND type IN ("station","starbase")', [stationId, userId], (e, r) => e ? reject(e) : resolve(r || null)));
        if (!station) return { ok: false, reason: 'station_not_found' };
        gameId = gameId || await this._gameIdForStation(station);
        let stationMeta = {}; try { stationMeta = JSON.parse(station.meta || '{}') || {}; } catch {}
        const stationClass = stationMeta.stationClass || 'planet-station';
        const reasons = [];
        if (!(bp.stationClasses || []).includes(stationClass)) reasons.push({ code: 'station_class_not_allowed', stationClass });
        for (const prereq of bp.prereqs || []) {
            const exists = await new Promise((resolve, reject) => db.get(`SELECT 1 FROM sector_objects so JOIN sectors s ON s.id=so.sector_id WHERE so.owner_id=? AND s.game_id=? AND so.type='ship' AND json_extract(so.meta,'$.blueprintId')=? LIMIT 1`, [userId, gameId, prereq], (e, r) => e ? reject(e) : resolve(!!r)));
            if (!exists) reasons.push({ code: 'missing_prerequisite', prerequisite: prereq });
        }
        const cargo = await CargoManager.getObjectCargo(station.id);
        const shortages = [];
        const requirementKeys = computeAllRequirements(bp);
        for (const [resourceKey, needed] of Object.entries({ ...requirementKeys.core, ...requirementKeys.specialized })) {
            const item = cargo.items.find(i => i.resource_key === resourceKey || i.resource_name === resourceKey);
            const have = Number(item?.quantity || 0);
            if (!freeBuild && have < needed) shortages.push({ resource: resourceKey, needed, have });
        }
        if (shortages.length) reasons.push({ code: 'insufficient_resources', shortages });
        const currentTurn = await getCurrentTurnNumberServer(gameId);
        const buildTurns = await policyAdjustedBuildTurns(gameId, userId, bp);
        try {
            const stats = await require('./pilot.service').getPilotStats(gameId, userId, currentTurn, db);
            if (stats.available < Math.max(1, Number(bp.pilotCost || 1))) reasons.push({ code: 'insufficient_pilots', available: stats.available, needed: Math.max(1, Number(bp.pilotCost || 1)) });
        } catch (error) { reasons.push({ code: 'pilot_accounting_unavailable' }); }
        return { ok: reasons.length === 0, blueprint: bp, stationClass, currentTurn, completionTurn: currentTurn + buildTurns - 1, buildTurns, shortages, reasons };
    }

    async _gameIdForStation(station) {
        return new Promise((resolve, reject) => db.get('SELECT game_id FROM sectors WHERE id=?', [station.sector_id], (e, row) => e ? reject(e) : resolve(row?.game_id || null)));
    }

    async listShipBuilds({ stationId, userId, includeCompleted = false }) {
        const station = await new Promise((resolve, reject) => db.get('SELECT id, sector_id FROM sector_objects WHERE id=? AND owner_id=? AND type IN ("station","starbase")', [stationId, userId], (e, r) => e ? reject(e) : resolve(r || null)));
        if (!station) return { success: false, httpStatus: 404, error: 'Station not found or not owned by player' };
        const statuses = includeCompleted ? `status IN ('queued','blocked','completed','cancelled')` : `status IN ('queued','blocked')`;
        const builds = await new Promise((resolve, reject) => db.all(`SELECT id, blueprint_id AS blueprintId, ship_name AS shipName, pilot_cost AS pilotCost, start_turn AS startTurn, completion_turn AS completionTurn, status, status_reason AS statusReason, created_at AS createdAt, completed_at AS completedAt FROM ship_builds WHERE station_id=? AND user_id=? AND ${statuses} ORDER BY CASE WHEN status IN ('queued','blocked') THEN 0 ELSE 1 END, completion_turn, id`, [stationId, userId], (e, rows) => e ? reject(e) : resolve(rows || [])));
        return { success: true, builds };
    }

    async _refundBuildCosts(build) {
        let target = await new Promise((resolve, reject) => db.get('SELECT id FROM sector_objects WHERE id=? AND owner_id=? AND type IN ("station","starbase")', [build.station_id, build.user_id], (e, r) => e ? reject(e) : resolve(r || null)));
        if (!target) target = await new Promise((resolve, reject) => db.get(`SELECT so.id FROM sector_objects so JOIN sectors s ON s.id=so.sector_id WHERE so.owner_id=? AND so.type IN ('station','starbase') AND s.game_id=? ORDER BY so.id LIMIT 1`, [build.user_id, build.game_id], (e, r) => e ? reject(e) : resolve(r || null)));
        if (!target) return { success: false, reason: 'no_refund_station' };
        let costs = {};
        try { costs = JSON.parse(build.resource_costs || '{}') || {}; } catch {}
        for (const [resourceKey, quantity] of Object.entries(costs)) {
            const result = await CargoManager.addResourceToCargo(target.id, resourceKey, Number(quantity));
            if (!result?.success) return { success: false, reason: 'refund_cargo_full' };
        }
        return { success: true, targetStationId: target.id, refunded: costs };
    }

    async _cancelShipBuild({ buildId, userId }) {
        const build = await new Promise((resolve, reject) => db.get(`SELECT b.*, s.owner_id AS station_owner, s.type AS station_type FROM ship_builds b LEFT JOIN sector_objects s ON s.id=b.station_id WHERE b.id=? AND b.user_id=?`, [buildId, userId], (e, r) => e ? reject(e) : resolve(r || null)));
        if (!build) return { success: false, httpStatus: 404, error: 'Build not found' };
        if (!['queued', 'blocked'].includes(build.status)) return { success: false, httpStatus: 400, error: 'Build is no longer cancellable' };
        const refund = await this._refundBuildCosts(build);
        if (!refund.success) return { success: false, httpStatus: 409, error: 'No owned station can accept the resource refund' };
        await require('./pilot.service').releasePilots(build.game_id, userId, build.pilot_cost, db);
        await new Promise((resolve, reject) => db.run(`UPDATE ship_builds SET status='cancelled',status_reason='cancelled_by_user',completed_at=CURRENT_TIMESTAMP WHERE id=?`, [buildId], e => e ? reject(e) : resolve()));
        return { success: true, buildId, refunded: refund.refunded, refundStationId: refund.targetStationId };
    }

    async _buildStructure({ stationId, structureType, userId }) {
        const structureTemplate = STRUCTURE_TYPES[structureType];
        if (!structureTemplate) {
            return { success: false, httpStatus: 400, error: 'Invalid structure type' };
        }
        // Verify station ownership
        const station = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM sector_objects WHERE id = ? AND owner_id = ? AND type IN ("starbase","station")', [stationId, userId], (err, row) => err ? reject(err) : resolve(row || null));
        });
        if (!station) return { success: false, httpStatus: 404, error: 'Station not found or not owned by player' };

        // Consume resources (rock only, as per route)
        const serverCost = STRUCTURE_BUILD_COSTS[structureType] ?? 1;
        const consumed = await CargoManager.consumeResourcesAtomic(stationId, { rock: serverCost }, false);
        if (!consumed?.success) {
            return { success: false, httpStatus: 400, error: consumed?.error || 'Insufficient resources' };
        }

        // Ensure resource type exists
        const resourceTypeId = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM resource_types WHERE resource_key = ? OR resource_name = ? LIMIT 1', [structureType, structureType], (typeErr, resourceType) => {
                if (typeErr) return reject(typeErr);
                if (resourceType) return resolve(resourceType.id);
                db.run(
                    'INSERT INTO resource_types (resource_key, resource_name, category, base_size, base_value, description, icon_emoji, color_hex) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [structureType, structureType, 'structure', 5, 10, structureTemplate.description, structureTemplate.emoji, '#64b5f6'],
                    function(insertErr) {
                        if (insertErr) return reject(insertErr);
                        resolve(this.lastID);
                    }
                );
            });
        });

        // Add the structure item to station cargo
        const addResult = await CargoManager.addResourceToCargo(stationId, structureType, 1, false);
        if (!addResult?.success) {
            return { success: false, httpStatus: 500, error: 'Failed to add structure to cargo' };
        }
        const gameId = await new Promise((resolve) => db.get('SELECT game_id FROM sectors WHERE id=(SELECT sector_id FROM sector_objects WHERE id=?)', [stationId], (e,r)=>resolve(r?.game_id)));
        await this._recordBuild(gameId, userId, stationId, 'structure', structureTemplate.name);
        return { success: true, structureName: structureTemplate.name };
    }

    async _deployStructure({ shipId, structureType, userId, anchorObjectId }) {
        const structureTemplate = STRUCTURE_TYPES[structureType];
        if (!structureTemplate) return { success: false, httpStatus: 400, error: 'Invalid structure type' };
        if (structureTemplate.requiresSectorSelection) {
            return { success: false, httpStatus: 400, error: 'This deployable requires the dedicated deployment flow' };
        }

        // Verify ship ownership
        const ship = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM sector_objects WHERE id = ? AND owner_id = ? AND type = ?', [shipId, userId, 'ship'], (err, row) => err ? reject(err) : resolve(row || null));
        });
        if (!ship) return { success: false, httpStatus: 404, error: 'Ship not found or not owned by player' };

        // Anchored stations special handling
        if (['sun-station', 'planet-station', 'moon-station'].includes(structureType)) {
            const requiredType = structureTemplate.anchorType;
            if (anchorObjectId == null) {
                return { success: false, httpStatus: 400, error: 'A celestial anchor must be selected' };
            }
            const celestialObjects = await new Promise((resolve, reject) => {
                db.all(`SELECT id, x, y, radius, type, celestial_type
                        FROM sector_objects
                        WHERE sector_id = ? AND celestial_type = ?`, [ship.sector_id, requiredType], (e, rows) => e ? reject(e) : resolve(rows || []));
            });
            if (!celestialObjects || celestialObjects.length === 0) {
                return { success: false, httpStatus: 400, error: `No ${requiredType} present in this sector` };
            }
            const nearby = celestialObjects.filter(o => {
                const dx = ship.x - o.x; const dy = ship.y - o.y; const dist = Math.sqrt(dx*dx + dy*dy);
                return scale.gap(ship,o) <= 30;
            });
            const candidate = nearby.find(o => Number(o.id) === Number(anchorObjectId));
            if (!candidate) return { success: false, httpStatus: 400, error: `Must be within 30 tiles of a ${requiredType} surface to deploy this station` };
            const exists = await new Promise((resolve, reject) => db.get(`SELECT id FROM sector_objects WHERE type = 'station' AND parent_object_id = ? LIMIT 1`, [candidate.id], (e, r) => e ? reject(e) : resolve(!!r)));
            if (exists) return { success: false, httpStatus: 400, error: 'This celestial object already has a station anchored' };
            let placement;
            try { placement=await placeNear(db,ship.sector_id,{type:'station',meta:{stationClass:structureType}},candidate,{anchored:true,maxRadius:40}); }
            catch { return {success:false,httpStatus:400,error:'No clear space for station footprint near this body'}; }
            const {x:deployX,y:deployY}=placement;
            const removed = await CargoManager.removeResourceFromCargo(shipId, structureType, 1, true);
            if (!removed?.success) return { success: false, httpStatus: 400, error: removed?.error || 'Structure not found in ship cargo' };
            const stationMeta = JSON.stringify({
                name: `${structureTemplate.name} ${Math.floor(Math.random() * 1000)}`,
                stationClass: structureType,
                hp: 150,
                maxHp: 150,
                cargoCapacity: structureTemplate.cargoCapacity || 50,
                hostGameplayType: (() => { try { const m = JSON.parse(candidate.meta || '{}'); return m.gameplayType || m.visualType || null; } catch { return null; } })()
            });
            const newStationId = await new Promise((resolve, reject) => {
                db.run(`INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta, parent_object_id) VALUES (?, 'station', ?, ?, ?, ?, ?)`, [ship.sector_id, deployX, deployY, userId, stationMeta, candidate.id], function(err){ if (err) return reject(err); resolve(this.lastID); });
            });
            await CargoManager.initializeObjectCargo(newStationId, structureTemplate.cargoCapacity || 50);
            return { success: true, structureName: structureTemplate.name, structureId: newStationId };
        }

        // Generic non-anchored structure
        let placement;
        try { placement=await placeNear(db,ship.sector_id,{type:'storage-structure',meta:{structureType}},ship,{maxRadius:10}); }
        catch { return {success:false,httpStatus:400,error:'No clear space for deployable footprint'}; }
        const {x:deployX,y:deployY}=placement;
        const structureMeta = JSON.stringify({
            name: `${structureTemplate.name} ${Math.floor(Math.random() * 1000)}`,
            structureType: structureType,
            hp: 100,
            maxHp: 100,
            cargoCapacity: structureTemplate.cargoCapacity || 0,
            publicAccess: structureTemplate.publicAccess || false
        });
        const dbStructureType = structureType === 'warp-beacon' ? 'warp-beacon' : 'storage-structure';
        if (infrastructureDefinitionForKey(structureType)) {
            const capacityFailure = await this._checkInfrastructureCapacity([{
                sectorId: ship.sector_id,
                x: deployX,
                y: deployY,
                infrastructureKey: structureType
            }]);
            if (capacityFailure) return capacityFailure;
        }
        const removed = await CargoManager.removeResourceFromCargo(shipId, structureType, 1, true);
        if (!removed?.success) return { success: false, httpStatus: 400, error: removed?.error || 'Structure not found in ship cargo' };
        const structureId = await new Promise((resolve, reject) => {
            db.run('INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta) VALUES (?, ?, ?, ?, ?, ?)', [ship.sector_id, dbStructureType, deployX, deployY, userId, structureMeta], function(err){ if (err) return reject(err); resolve(this.lastID); });
        });
        if (structureTemplate.cargoCapacity > 0) {
            await CargoManager.initializeObjectCargo(structureId, structureTemplate.cargoCapacity);
        }
        return { success: true, structureName: structureTemplate.name, structureId };
    }

    async _deployInterstellarGate({ shipId, destinationSectorId, userId }) {
        // Verify ship
        const ship = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM sector_objects WHERE id = ? AND owner_id = ? AND type = ?', [shipId, userId, 'ship'], (err, row) => err ? reject(err) : resolve(row || null));
        });
        if (!ship) return { success: false, httpStatus: 404, error: 'Ship not found or not owned by player' };

        // Verify destination sector
        const destinationSector = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM sectors WHERE id = ?', [destinationSectorId], (err, row) => err ? reject(err) : resolve(row || null));
        });
        if (!destinationSector) return { success: false, httpStatus: 404, error: 'Destination sector not found' };

        const gatePairId = `gate_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        // Gate slots and duplicate connection check
        const originSector = await new Promise((resolve) => db.get('SELECT id, game_id, gate_slots, gates_used FROM sectors WHERE id = ?', [ship.sector_id], (e, row) => resolve(row || null)));
        const destSector = await new Promise((resolve) => db.get('SELECT id, game_id, gate_slots, gates_used FROM sectors WHERE id = ?', [destinationSectorId], (e, row) => resolve(row || null)));
        if (!originSector) return { success: false, httpStatus: 400, error: 'origin_sector_not_found' };
        if (!destSector) return { success: false, httpStatus: 400, error: 'destination_sector_not_found' };
        if (Number(originSector.id) === Number(destSector.id)) return { success: false, httpStatus: 400, error: 'same_sector_gate_not_allowed' };
        if (Number(originSector.game_id) !== Number(destSector.game_id)) return { success: false, httpStatus: 400, error: 'cross_game_gate_not_allowed' };
        const exists = await new Promise((resolve, reject) => db.get(
            `SELECT 1 FROM sector_objects
             WHERE type='interstellar-gate' AND (
                (sector_id=? AND json_extract(meta,'$.destinationSectorId')=?) OR
                (sector_id=? AND json_extract(meta,'$.destinationSectorId')=?)
             ) LIMIT 1`,
            [ship.sector_id, destinationSectorId, destinationSectorId, ship.sector_id],
            (e, r) => e ? reject(e) : resolve(!!r)
        ));
        if (exists) return { success: false, httpStatus: 400, error: 'connection_already_exists' };

        let originPoint,destinationPoint;
        try {
            originPoint=await placeNear(db,ship.sector_id,{type:'interstellar-gate'},ship,{maxRadius:20});
            const destinationObjects=await physicalObjects(db,destinationSectorId);
            destinationPoint=nav.findPlacement(destinationObjects,{type:'interstellar-gate'},{x:2500,y:2500},{maxRadius:600});
            if(!destinationPoint)throw new Error('blocked');
        } catch { return {success:false,httpStatus:400,error:'No clear space for both gate footprints'}; }
        const capacityFailure = await this._checkInfrastructureCapacity([
            { sectorId: ship.sector_id, x: originPoint.x, y: originPoint.y, infrastructureKey: 'interstellar-gate' },
            { sectorId: destinationSectorId, x: destinationPoint.x, y: destinationPoint.y, infrastructureKey: 'interstellar-gate' }
        ]);
        if (capacityFailure) return capacityFailure;
        const lifecycle = new InfrastructureLifecycleService(db);
        const pairReservation = await lifecycle.createGateReservation({
            pairId: gatePairId,
            gameId: originSector.game_id,
            originSectorId: ship.sector_id,
            destinationSectorId
        });
        if (!pairReservation.ok) return { success: false, httpStatus: 409, error: pairReservation.error };
        const slotReservation = await lifecycle.reserveGatePairSlots(gatePairId, pairReservation.sectorAId, pairReservation.sectorBId);
        if (!slotReservation.ok) {
            const error = Number(slotReservation.sectorId) === Number(ship.sector_id) ? 'origin_gate_slots_full' : 'dest_gate_slots_full';
            return { success: false, httpStatus: 409, error };
        }
        // Create origin gate
        const {x:originGateX,y:originGateY}=originPoint;
        const originGateMeta = JSON.stringify({
            name: `Interstellar Gate to ${destinationSector.name}`,
            structureType: 'interstellar-gate', hp: 200, maxHp: 200, publicAccess: true,
            gatePairId, destinationSectorId, destinationSectorName: destinationSector.name, isOriginGate: true
        });
        const originGateId = await new Promise((resolve, reject) => {
            db.run('INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta) VALUES (?, ?, ?, ?, ?, ?)', [ship.sector_id, 'interstellar-gate', originGateX, originGateY, userId, originGateMeta], function(err){ if (err) return reject(err); resolve(this.lastID); });
        });

        // Create destination gate near center
        const {x:destGateX,y:destGateY}=destinationPoint;
        const destGateMeta = JSON.stringify({
            name: `Interstellar Gate to ${ship.sector_id === destinationSector.id ? 'Origin' : 'Sector ' + ship.sector_id}`,
            structureType: 'interstellar-gate', hp: 200, maxHp: 200, publicAccess: true,
            gatePairId, destinationSectorId: ship.sector_id, destinationSectorName: 'Origin Sector', isOriginGate: false
        });
        const destGateId = await new Promise((resolve, reject) => {
            db.run('INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta) VALUES (?, ?, ?, ?, ?, ?)', [destinationSectorId, 'interstellar-gate', destGateX, destGateY, userId, destGateMeta], function(err){ if (err) return reject(err); resolve(this.lastID); });
        });
        const removed = await CargoManager.removeResourceFromCargo(shipId, 'interstellar-gate', 1, true);
        if (!removed?.success) return { success: false, httpStatus: 400, error: removed?.error || 'Interstellar gate not found in ship cargo' };
        await lifecycle.finalizeGatePair(gatePairId, {
            sectorAId: ship.sector_id,
            gateAObjectId: originGateId,
            gateBObjectId: destGateId
        });
        return { success: true, structureName: 'Interstellar Gate', originGateId, destGateId, gatePairId };
    }

    async _buildShip({ stationId, blueprintId, userId, freeBuild, clientOrderId = null }) {
        // Validate blueprint
        const blueprint = (SHIP_BLUEPRINTS || []).find(b => b.id === blueprintId);
        if (!blueprint) {
            return { success: false, httpStatus: 400, error: 'Invalid blueprint' };
        }

        // Verify station ownership
        const station = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM sector_objects WHERE id = ? AND owner_id = ? AND type IN ("starbase","station")', [stationId, userId], (err, row) => err ? reject(err) : resolve(row || null));
        });
        if (!station) return { success: false, httpStatus: 404, error: 'Station not found or not owned by player' };

        const gameId = station.game_id || await new Promise((resolve, reject) => db.get('SELECT game_id FROM sectors WHERE id = ?', [station.sector_id], (e,row)=>e ? reject(e) : resolve(row?.game_id)));
        if (clientOrderId) {
            const existing = await new Promise((resolve, reject) => db.get('SELECT id AS buildId, ship_name AS shipName, completion_turn AS completionTurn, status FROM ship_builds WHERE user_id=? AND client_order_id=?', [userId, clientOrderId], (e, r) => e ? reject(e) : resolve(r || null)));
            if (existing) return { success: true, queued: existing.status !== 'completed', duplicate: true, ...existing };
        }
        const currentTurn = await getCurrentTurnNumberServer(gameId);
        const stationMeta = (() => { try { return JSON.parse(station.meta || '{}') || {}; } catch { return {}; } })();
        const stationClass = stationMeta.stationClass || 'planet-station';
        if (!(blueprint.stationClasses || []).includes(stationClass)) return { success: false, httpStatus: 400, error: `This station cannot build ${blueprint.class} ships` };
        for (const prereq of blueprint.prereqs || []) {
            const exists = await new Promise((resolve, reject) => db.get(`SELECT 1 FROM sector_objects so JOIN sectors s ON s.id=so.sector_id WHERE so.owner_id=? AND s.game_id=? AND so.type='ship' AND json_extract(so.meta,'$.blueprintId')=? LIMIT 1`, [userId, gameId, prereq], (e, r) => e ? reject(e) : resolve(!!r)));
            if (!exists) return { success: false, httpStatus: 400, error: `Missing prerequisite: ${prereq}` };
        }
        const pilotCost = Math.max(1, Number(blueprint.pilotCost || 1));
        const reserved = await require('./pilot.service').reservePilots(gameId, userId, pilotCost, currentTurn, db);
        if (!reserved.success) return { success: false, httpStatus: 400, error: 'No available pilots to command a new ship' };

        // Compute requirements map
        const reqs = computeAllRequirements(blueprint);
        const resourceMap = { ...reqs.core, ...reqs.specialized };

        // Consume resources unless free build in dev
        const devMode = process.env.SF_DEV_MODE === '1' || process.env.NODE_ENV === 'development';
        const allowFree = !!freeBuild && devMode;
        if (!allowFree) {
            const consumed = await CargoManager.consumeResourcesAtomic(stationId, resourceMap, false);
            if (!consumed?.success) {
                return { success: false, httpStatus: 400, error: 'Insufficient resources', details: consumed?.shortages };
            }
        }

        const shipName = `${blueprint.name} ${Math.floor(Math.random() * 1000)}`;
        const buildTurns = await policyAdjustedBuildTurns(gameId, userId, blueprint);
        const completionTurn = currentTurn + buildTurns - 1;
        const buildId = await new Promise((resolve, reject) => db.run(`INSERT INTO ship_builds(game_id,station_id,user_id,blueprint_id,ship_name,pilot_cost,start_turn,completion_turn,status,resource_costs,client_order_id) VALUES(?,?,?,?,?,?,?,?,'queued',?,?)`, [gameId,station.id,userId,blueprint.id,shipName,pilotCost,currentTurn,completionTurn,JSON.stringify(allowFree ? {} : resourceMap),clientOrderId], function(e) { e ? reject(e) : resolve(this.lastID); }));
        return { success: true, queued: true, buildId, shipName, completionTurn, buildTurns, consumed: allowFree ? {} : resourceMap };
    }

    async completeDueShipBuilds(gameId, turnNumber) {
        const builds = await new Promise((resolve, reject) => db.all(`SELECT b.*, s.sector_id, s.x, s.y, s.meta AS station_meta FROM ship_builds b LEFT JOIN sector_objects s ON s.id=b.station_id WHERE b.game_id=? AND b.status IN ('queued','blocked') AND b.completion_turn<=? AND (b.status='queued' OR b.status_reason='no_launch_space') ORDER BY b.id`, [gameId, turnNumber], (e, rows) => e ? reject(e) : resolve(rows || [])));
        const completed = [];
        for (const build of builds) {
            if (!build.sector_id) {
                const refund = await this._refundBuildCosts(build);
                if (refund.success) {
                    await require('./pilot.service').releasePilots(build.game_id, build.user_id, build.pilot_cost, db);
                    await new Promise((resolve, reject) => db.run(`UPDATE ship_builds SET status='cancelled',status_reason='station_destroyed',completed_at=CURRENT_TIMESTAMP WHERE id=?`, [build.id], e => e ? reject(e) : resolve()));
                } else {
                    await new Promise((resolve, reject) => db.run(`UPDATE ship_builds SET status='blocked',status_reason='station_destroyed_no_refund' WHERE id=?`, [build.id], e => e ? reject(e) : resolve()));
                }
                continue;
            }
            const blueprint = SHIP_BLUEPRINTS.find(bp => bp.id === build.blueprint_id);
            if (!blueprint) throw new Error(`Unknown blueprint in ship build ${build.id}`);
            let spawnPoint;
            try { spawnPoint = await placeNear(db, build.sector_id, { type: 'ship', meta: { blueprintId: blueprint.id, shipClass: blueprint.class } }, { ...build, type: 'station', meta: build.station_meta }, { maxRadius: 20 }); }
            catch { await new Promise((resolve, reject) => db.run(`UPDATE ship_builds SET status='blocked',status_reason='no_launch_space' WHERE id=?`, [build.id], e => e ? reject(e) : resolve())); continue; }
            const shipMetaObj = {
                name: build.ship_name, blueprintId: blueprint.id, shipClass: blueprint.class, role: blueprint.role, homeStationId: build.station_id,
                maxHp: blueprint.maxHp, hp: blueprint.maxHp, scanRange: blueprint.scanRange,
                movementSpeed: blueprint.movementSpeed, warpSpeed: blueprint.warpSpeed,
                cargoCapacity: blueprint.cargoCapacity, harvestRate: blueprint.harvestRate,
                maxEnergy: blueprint.maxEnergy, energy: blueprint.maxEnergy, energyRegen: blueprint.energyRegen,
                pilotCost: blueprint.pilotCost, abilities: (blueprint.abilities || []).filter(k => !!Abilities[k])
            };
            const shipId = await new Promise((resolve, reject) => db.run('INSERT INTO sector_objects (sector_id,type,x,y,owner_id,meta,scan_range,movement_speed,can_active_scan) VALUES (?,?,?,?,?,?,?,?,?)', [build.sector_id, 'ship', spawnPoint.x, spawnPoint.y, build.user_id, JSON.stringify(shipMetaObj), blueprint.scanRange, blueprint.movementSpeed, 0], function(e) { e ? reject(e) : resolve(this.lastID); }));
            await CargoManager.initializeShipCargo(shipId, blueprint.cargoCapacity);
            await new Promise((resolve, reject) => db.run(`UPDATE ship_builds SET status='completed',completed_at=CURRENT_TIMESTAMP,status_reason=NULL WHERE id=?`, [build.id], e => e ? reject(e) : resolve()));
            await this._recordBuild(gameId, build.user_id, shipId, 'ship', build.ship_name, turnNumber);
            completed.push({ buildId: build.id, shipId, shipName: build.ship_name });
        }
        return completed;
    }

    async processShipUpkeep(gameId, turnNumber) {
        const ships = await new Promise((resolve, reject) => db.all(`SELECT so.id, so.meta FROM sector_objects so JOIN sectors s ON s.id=so.sector_id WHERE s.game_id=? AND so.type='ship'`, [gameId], (e, rows) => e ? reject(e) : resolve(rows || [])));
        const results = [];
        for (const ship of ships) {
            let meta = {}; try { meta = JSON.parse(ship.meta || '{}') || {}; } catch {}
            const blueprint = SHIP_BLUEPRINTS.find(bp => bp.id === meta.blueprintId);
            const upkeep = Object.fromEntries(Object.entries(blueprint?.upkeep || {}).filter(([, amount]) => Number(amount) > 0));
            if (!Object.keys(upkeep).length || !meta.homeStationId) continue;
            const consumed = await CargoManager.consumeResourcesAtomic(meta.homeStationId, upkeep, false);
            meta.upkeepStatus = consumed?.success ? 'paid' : 'starved';
            meta.upkeepLastTurn = turnNumber;
            await new Promise((resolve, reject) => db.run('UPDATE sector_objects SET meta=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [JSON.stringify(meta), ship.id], e => e ? reject(e) : resolve()));
            results.push({ shipId: ship.id, status: meta.upkeepStatus });
        }
        return results;
    }
}

module.exports = { BuildService, STRUCTURE_BUILD_COSTS };

// Local copies of helpers used by build path
async function getCurrentTurnNumberServer(gameId) {
    return new Promise((resolve) => db.get(
        'SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1',
        [gameId],
        (e, r) => resolve(r ? r.turn_number : 1)
    ));
}

async function computePilotStats(gameId, userId, currentTurn) {
    const stationRows = await new Promise((resolve) => {
        db.all(
            `SELECT so.meta FROM sector_objects so
             JOIN sectors s ON s.id = so.sector_id
             WHERE s.game_id = ? AND so.owner_id = ? AND so.type = 'station'`,
            [gameId, userId],
            (e, rows) => resolve(rows || [])
        );
    });
    let capacity = 5;
    for (const r of stationRows) {
        try {
            const meta = JSON.parse(r.meta || '{}');
            const cls = meta.stationClass;
            if (cls === 'sun-station') capacity += 10;
            else if (cls === 'planet-station' || !cls) capacity += 5;
            else if (cls === 'moon-station') capacity += 3;
        } catch {}
    }
    const shipRows = await new Promise((resolve) => {
        db.all(
            `SELECT so.meta FROM sector_objects so
             JOIN sectors s ON s.id = so.sector_id
             WHERE s.game_id = ? AND so.owner_id = ? AND so.type = 'ship'`,
            [gameId, userId],
            (e, rows) => resolve(rows || [])
        );
    });
    let active = 0;
    for (const r of shipRows) {
        try { const m = JSON.parse(r.meta || '{}'); active += Number(m.pilotCost || 1); } catch { active += 1; }
    }
    const deadRows = await new Promise((resolve) => {
        db.all(
            `SELECT respawn_turn as turn, SUM(count) as qty
             FROM dead_pilots_queue
             WHERE game_id = ? AND user_id = ? AND respawn_turn > ?
             GROUP BY respawn_turn ORDER BY respawn_turn ASC`,
            [gameId, userId, currentTurn],
            (e, rows) => resolve(rows || [])
        );
    });
    const dead = (deadRows || []).reduce((sum, r) => sum + Number(r.qty || 0), 0);
    const available = Math.max(0, capacity - active - dead);
    return { capacity, active, dead, available };
}
