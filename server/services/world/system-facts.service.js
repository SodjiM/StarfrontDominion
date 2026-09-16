const db = require('../../db');

class SystemFactsService {
    static async getSectorSummary(sectorId, viewerUserId = null) {
        const sector = await new Promise((resolve, reject) => db.get('SELECT id, game_id, archetype FROM sectors WHERE id = ?', [sectorId], (e, r) => e ? reject(e) : resolve(r || null)));
        if (!sector) return null;
        let visibilityMap = null;
        if (viewerUserId != null) {
            const membership = await new Promise((resolve, reject) => db.get(
                'SELECT 1 FROM game_players WHERE game_id = ? AND user_id = ?',
                [sector.game_id, viewerUserId],
                (e, r) => e ? reject(e) : resolve(r || null)
            ));
            if (!membership) {
                const error = new Error('not_a_game_member');
                error.status = 403;
                throw error;
            }
            const { GameWorldManager } = require('../game/game-world.service');
            visibilityMap = await GameWorldManager.computeCurrentVisibility(sector.game_id, Number(viewerUserId), Number(sector.id));
        }
        const { getArchetypeInfo } = require('./unified-archetype-registry');
        const archetypeInfo = getArchetypeInfo(sector.archetype);
        const { RegionInfrastructureService } = require('./region-infrastructure.service');
        const infrastructureStatus = await new RegionInfrastructureService(db).getSectorStatus(sectorId, { viewerUserId, visibilityMap });
        const infrastructureByRegion = new Map(infrastructureStatus.regions.map((region) => [region.id, region]));
        const mineralDisplay = (() => {
            const core = ['Ferrite Alloy','Crytite','Ardanium','Vornite','Zerothium'].map(n=>({ name:n, mult: '×1.0' }));
            const primary = (archetypeInfo.minerals?.primary || []).map(n=>({ name:n, mult:'×1.5' }));
            const secondary = (archetypeInfo.minerals?.secondary || []).map(n=>({ name:n, mult:'×0.8' }));
            return { core, primary, secondary };
        })();
        // Regions
        const regions = await new Promise((resolve) => db.all('SELECT region_id as id, health, cells_json as cells FROM regions WHERE sector_id = ?', [sectorId], (e, rows) => resolve(rows || [])));
        const pressureRows = await new Promise((resolve, reject) => db.all(
            `SELECT p.region_id,p.turn_number,p.pressure_band
             FROM region_pressure_history p
             JOIN (
                SELECT region_id,MAX(turn_number) AS latest_turn
                FROM region_pressure_history WHERE sector_id=? GROUP BY region_id
             ) latest ON latest.region_id=p.region_id AND latest.latest_turn=p.turn_number
             WHERE p.sector_id=?`,
            [sectorId, sectorId],
            (error, rows) => error ? reject(error) : resolve(rows || [])
        ));
        const pressureByRegion = new Map(pressureRows.map((row) => [String(row.region_id), row]));
        const { RegionIncidentService } = require('./region-incident.service');
        const incidentRows = await new RegionIncidentService(db).getPublicStateForSector(sectorId, viewerUserId);
        const incidentsByRegion = new Map();
        for (const incident of incidentRows) {
            const key = String(incident.regionId);
            if (!incidentsByRegion.has(key)) incidentsByRegion.set(key, []);
            const { regionId: ignoredRegionId, ...publicIncident } = incident;
            incidentsByRegion.get(key).push(publicIncident);
        }
        // Belts (sector metadata only)
        const beltSectors = await new Promise((resolve) => db.all('SELECT belt_key, sector_index, region_id, inner_radius, width, arc_start, arc_end, density, hazard FROM belt_sectors WHERE sector_id = ?', [sectorId], (e, rows) => resolve(rows || [])));
        const orbitalRings = await new Promise((resolve) => db.all('SELECT ring_index, center_x, center_y, radius, width, planet_object_id FROM orbital_rings WHERE sector_id = ? ORDER BY ring_index', [sectorId], (e, rows) => resolve(rows || [])));
        // Public wormhole geometry. Operational metadata and cross-system
        // links are intelligence and do not belong in general system facts.
        const wormholeEndpoints = await new Promise((resolve) => db.all('SELECT x, y FROM sector_objects WHERE sector_id = ? AND type = ?', [sectorId, 'wormhole'], (e, rows) => resolve(rows || [])));
        // Public lane geometry only. Capacity, speed, traffic, permits, and
        // tap queues are intentionally omitted from this general endpoint.
        const laneEdges = await new Promise((resolve) => db.all(
            `SELECT id, cls, region_id, polyline_json, width_core, width_shoulder
             FROM lane_edges WHERE sector_id = ?`,
            [sectorId], (e, rows) => resolve(rows || [])
        ));
        return {
            id: sector.id,
            archetype: sector.archetype || null,
            name: archetypeInfo.name,
            regions: regions.map(r => ({
                id: r.id,
                health: r.health,
                cells: safeJson(r.cells),
                pressure: pressureByRegion.has(String(r.id)) ? {
                    band: pressureByRegion.get(String(r.id)).pressure_band,
                    turn: Number(pressureByRegion.get(String(r.id)).turn_number)
                } : null,
                incidents: incidentsByRegion.get(String(r.id)) || [],
                infrastructure: (() => {
                    const status = infrastructureByRegion.get(String(r.id));
                    if (!status) return null;
                    // Capacity is public. Viewer-scoped load is partitioned
                    // below; total load, pressure, contributor counts, and
                    // contributor identity remain server-internal.
                    if (!status.viewer) return { capacity: status.capacity };
                    return {
                        capacity: status.capacity,
                        ownLoad: status.viewer.ownLoad,
                        visibleHostileLoad: status.viewer.visibleHostileLoad
                    };
                })()
            })),
            infrastructure: {
                version: infrastructureStatus.version,
                catalogVersion: infrastructureStatus.catalogVersion,
                defaultCapacity: infrastructureStatus.defaultCapacity,
                dimensions: infrastructureStatus.dimensions
            },
            belts: beltSectors,
            orbitalRings: orbitalRings.map(r => ({ index: r.ring_index, centerX: r.center_x, centerY: r.center_y, radius: r.radius, width: r.width, planetObjectId: r.planet_object_id })),
            wormholeEndpoints: (wormholeEndpoints || []).map(w => ({ x: w.x, y: w.y })),
            lanes: (laneEdges || []).map(e => ({
                id: e.id,
                cls: e.cls,
                region_id: e.region_id,
                polyline: safeJsonObject(e.polyline_json, []),
                width_core: e.width_core,
                width_shoulder: e.width_shoulder
            })),
            mineralDisplay
        };
    }

    static async getFacts(sectorId, viewerUserId = null) {
        return this.getSectorSummary(sectorId, viewerUserId);
    }
}

module.exports = { SystemFactsService };
function safeJson(s) { try { return JSON.parse(s || '[]'); } catch { return []; } }
function safeJsonObject(s, def=null) { try { return s ? JSON.parse(s) : def; } catch { return def; } }
