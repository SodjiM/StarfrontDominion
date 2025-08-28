const db = require('../../db');
const { SHIP_BLUEPRINTS, computeAllRequirements } = require('../registry/blueprints');
const { Abilities } = require('../registry/abilities');
const { CargoManager } = require('./cargo-manager');
const { STRUCTURE_TYPES } = require('../../domain/structures');

class BuildService {
    // Skeleton: will encapsulate ship/structure build flows
    async canBuildShip({ gameId, userId, sectorId, blueprintId }) {
        const bp = (SHIP_BLUEPRINTS || []).find(b => b.id === blueprintId);
        if (!bp) return { ok: false, reason: 'unknown_blueprint' };
        // Placeholder pre-checks; actual logic will be ported from routes soon
        return { ok: true, blueprint: bp };
    }

    async buildStructure({ stationId, structureType, cost, userId }) {
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
        const consumed = await CargoManager.removeResourceFromCargo(stationId, 'rock', cost, false);
        if (!consumed?.success) {
            return { success: false, httpStatus: 400, error: consumed?.error || 'Insufficient resources' };
        }

        // Ensure resource type exists
        const resourceTypeId = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM resource_types WHERE resource_name = ?', [structureType], (typeErr, resourceType) => {
                if (typeErr) return reject(typeErr);
                if (resourceType) return resolve(resourceType.id);
                db.run(
                    'INSERT INTO resource_types (resource_name, category, base_size, base_value, description, icon_emoji, color_hex) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [structureType, 'structure', 5, 10, structureTemplate.description, structureTemplate.emoji, '#64b5f6'],
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
        return { success: true, structureName: structureTemplate.name };
    }

    async deployStructure({ shipId, structureType, userId }) {
        const structureTemplate = STRUCTURE_TYPES[structureType];
        if (!structureTemplate) return { success: false, httpStatus: 400, error: 'Invalid structure type' };

        // Verify ship ownership
        const ship = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM sector_objects WHERE id = ? AND owner_id = ? AND type = ?', [shipId, userId, 'ship'], (err, row) => err ? reject(err) : resolve(row || null));
        });
        if (!ship) return { success: false, httpStatus: 404, error: 'Ship not found or not owned by player' };

        // Remove from ship cargo first
        const removed = await CargoManager.removeResourceFromCargo(shipId, structureType, 1, true);
        if (!removed?.success) return { success: false, httpStatus: 400, error: removed?.error || 'Structure not found in ship cargo' };

        // Anchored stations special handling
        if (['sun-station', 'planet-station', 'moon-station'].includes(structureType)) {
            const requiredType = structureTemplate.anchorType;
            const celestialObjects = await new Promise((resolve, reject) => {
                db.all(`SELECT id, x, y, radius, type FROM sector_objects WHERE sector_id = ? AND type = ?`, [ship.sector_id, requiredType], (e, rows) => e ? reject(e) : resolve(rows || []));
            });
            if (!celestialObjects || celestialObjects.length === 0) {
                return { success: false, httpStatus: 400, error: `No ${requiredType} present in this sector` };
            }
            const candidate = celestialObjects.find(o => {
                const dx = ship.x - o.x; const dy = ship.y - o.y; const dist = Math.sqrt(dx*dx + dy*dy);
                return dist <= ((o.radius || 1) + 1);
            });
            if (!candidate) return { success: false, httpStatus: 400, error: `Must be adjacent to a ${requiredType} to deploy this station` };
            const exists = await new Promise((resolve, reject) => db.get(`SELECT id FROM sector_objects WHERE type = 'station' AND parent_object_id = ? LIMIT 1`, [candidate.id], (e, r) => e ? reject(e) : resolve(!!r)));
            if (exists) return { success: false, httpStatus: 400, error: 'This celestial object already has a station anchored' };
            let vx = ship.x - candidate.x; let vy = ship.y - candidate.y; if (vx === 0 && vy === 0) vx = 1;
            const len = Math.sqrt(vx*vx + vy*vy) || 1; const ring = (candidate.radius || 1) + 1;
            const deployX = Math.round(candidate.x + vx/len * ring); const deployY = Math.round(candidate.y + vy/len * ring);
            const stationMeta = JSON.stringify({
                name: `${structureTemplate.name} ${Math.floor(Math.random() * 1000)}`,
                stationClass: structureType,
                anchoredToType: requiredType,
                anchoredToId: candidate.id,
                hp: 150,
                maxHp: 150,
                cargoCapacity: structureTemplate.cargoCapacity || 50
            });
            const newStationId = await new Promise((resolve, reject) => {
                db.run(`INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta, parent_object_id) VALUES (?, 'station', ?, ?, ?, ?, ?)`, [ship.sector_id, deployX, deployY, userId, stationMeta, candidate.id], function(err){ if (err) return reject(err); resolve(this.lastID); });
            });
            let warning = null;
            try { await CargoManager.initializeObjectCargo(newStationId, structureTemplate.cargoCapacity || 50); } catch (_) { warning = 'Station deployed but cargo initialization failed'; }
            return { success: true, structureName: structureTemplate.name, structureId: newStationId, warning };
        }

        // Generic non-anchored structure
        const deployX = ship.x + (Math.random() < 0.5 ? -1 : 1);
        const deployY = ship.y + (Math.random() < 0.5 ? -1 : 1);
        const structureMeta = JSON.stringify({
            name: `${structureTemplate.name} ${Math.floor(Math.random() * 1000)}`,
            structureType: structureType,
            hp: 100,
            maxHp: 100,
            cargoCapacity: structureTemplate.cargoCapacity || 0,
            publicAccess: structureTemplate.publicAccess || false
        });
        const dbStructureType = structureType === 'warp-beacon' ? 'warp-beacon' : 'storage-structure';
        const structureId = await new Promise((resolve, reject) => {
            db.run('INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta) VALUES (?, ?, ?, ?, ?, ?)', [ship.sector_id, dbStructureType, deployX, deployY, userId, structureMeta], function(err){ if (err) return reject(err); resolve(this.lastID); });
        });
        let warning = null;
        if (structureTemplate.cargoCapacity > 0) {
            try { await CargoManager.initializeObjectCargo(structureId, structureTemplate.cargoCapacity); } catch(_) { warning = 'Structure deployed but cargo initialization failed'; }
        }
        return { success: true, structureName: structureTemplate.name, structureId, warning };
    }

    async deployInterstellarGate({ shipId, destinationSectorId, userId }) {
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

        // Remove gate item from ship cargo
        const removed = await CargoManager.removeResourceFromCargo(shipId, 'interstellar-gate', 1, true);
        if (!removed?.success) return { success: false, httpStatus: 400, error: removed?.error || 'Interstellar gate not found in ship cargo' };

        const gatePairId = `gate_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        // Gate slots and duplicate connection check
        const originSector = await new Promise((resolve) => db.get('SELECT gate_slots, gates_used FROM sectors WHERE id = ?', [ship.sector_id], (e, row) => resolve(row || null)));
        const destSector = await new Promise((resolve) => db.get('SELECT gate_slots, gates_used FROM sectors WHERE id = ?', [destinationSectorId], (e, row) => resolve(row || null)));
        if (!originSector) return { success: false, httpStatus: 400, error: 'origin_sector_not_found' };
        if (!destSector) return { success: false, httpStatus: 400, error: 'destination_sector_not_found' };
        if ((originSector.gates_used || 0) >= (originSector.gate_slots || 3)) return { success: false, httpStatus: 400, error: 'origin_gate_slots_full' };
        if ((destSector.gates_used || 0) >= (destSector.gate_slots || 3)) return { success: false, httpStatus: 400, error: 'dest_gate_slots_full' };
        const exists = await new Promise((resolve, reject) => db.get(`SELECT 1 FROM sector_objects WHERE sector_id = ? AND type='interstellar-gate' AND json_extract(meta,'$.destinationSectorId') = ? LIMIT 1`, [ship.sector_id, destinationSectorId], (e, r) => e ? reject(e) : resolve(!!r)));
        if (exists) return { success: false, httpStatus: 400, error: 'connection_already_exists' };

        // Create origin gate
        const originGateX = ship.x + (Math.random() < 0.5 ? -1 : 1);
        const originGateY = ship.y + (Math.random() < 0.5 ? -1 : 1);
        const originGateMeta = JSON.stringify({
            name: `Interstellar Gate to ${destinationSector.name}`,
            structureType: 'interstellar-gate', hp: 200, maxHp: 200, publicAccess: true,
            gatePairId, destinationSectorId, destinationSectorName: destinationSector.name, isOriginGate: true
        });
        const originGateId = await new Promise((resolve, reject) => {
            db.run('INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta) VALUES (?, ?, ?, ?, ?, ?)', [ship.sector_id, 'interstellar-gate', originGateX, originGateY, userId, originGateMeta], function(err){ if (err) return reject(err); resolve(this.lastID); });
        });

        // Create destination gate near center
        const destGateX = 2500 + Math.floor(Math.random() * 100) - 50;
        const destGateY = 2500 + Math.floor(Math.random() * 100) - 50;
        const destGateMeta = JSON.stringify({
            name: `Interstellar Gate to ${ship.sector_id === destinationSector.id ? 'Origin' : 'Sector ' + ship.sector_id}`,
            structureType: 'interstellar-gate', hp: 200, maxHp: 200, publicAccess: true,
            gatePairId, destinationSectorId: ship.sector_id, destinationSectorName: 'Origin Sector', isOriginGate: false
        });
        const destGateId = await new Promise((resolve, reject) => {
            db.run('INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta) VALUES (?, ?, ?, ?, ?, ?)', [destinationSectorId, 'interstellar-gate', destGateX, destGateY, userId, destGateMeta], function(err){ if (err) return reject(err); resolve(this.lastID); });
        });
        // Increment gates_used for both sectors
        await new Promise((resolve) => db.run('UPDATE sectors SET gates_used = gates_used + 1 WHERE id IN (?, ?)', [ship.sector_id, destinationSectorId], () => resolve()));
        return { success: true, structureName: 'Interstellar Gate', originGateId, destGateId, gatePairId };
    }

    async buildShip({ stationId, blueprintId, userId, freeBuild }) {
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

        // Pilot capacity enforcement (best effort)
        try {
            const gameId = station.game_id || await new Promise((resolve) => db.get('SELECT game_id FROM sectors WHERE id = ?', [station.sector_id], (e,row)=>resolve(row?.game_id)));
            const currentTurn = await getCurrentTurnNumberServer(gameId);
            const stats = await computePilotStats(gameId, userId, currentTurn);
            const pilotCost = 1;
            if ((stats.available || 0) < pilotCost) {
                return { success: false, httpStatus: 400, error: 'No available pilots to command a new ship' };
            }
        } catch (_) {
            // non-fatal
        }

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

        // Create ship adjacent to station
        const shipName = `${blueprint.name} ${Math.floor(Math.random() * 1000)}`;
        const shipMetaObj = {
            name: shipName,
            ...blueprint,
            shipType: blueprint.class,
            blueprintId: blueprint.id
        };
        if (!Array.isArray(shipMetaObj.abilities)) shipMetaObj.abilities = [];
        shipMetaObj.abilities = shipMetaObj.abilities.filter(k => !!Abilities[k]);
        const shipMeta = JSON.stringify(shipMetaObj);

        const spawnX = station.x + (Math.random() < 0.5 ? -1 : 1);
        const spawnY = station.y + (Math.random() < 0.5 ? -1 : 1);
        const shipId = await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta, scan_range, movement_speed, can_active_scan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [station.sector_id, 'ship', spawnX, spawnY, userId, shipMeta, shipMetaObj.scanRange, shipMetaObj.movementSpeed, shipMetaObj.canActiveScan ? 1 : 0],
                function(err) {
                    if (err) return reject(err);
                    resolve(this.lastID);
                }
            );
        });

        let warning = null;
        try {
            await CargoManager.initializeShipCargo(shipId, shipMetaObj.cargoCapacity);
        } catch (_) {
            warning = 'Ship created but cargo initialization failed';
        }

        return { success: true, shipName, shipId, consumed: resourceMap, warning };
    }
}

module.exports = { BuildService };

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


