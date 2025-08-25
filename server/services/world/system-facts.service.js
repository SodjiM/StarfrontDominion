const db = require('../../db');

class SystemFactsService {
    static async getSectorSummary(sectorId) {
        const sector = await new Promise((resolve) => db.get('SELECT id, archetype FROM sectors WHERE id = ?', [sectorId], (e, r) => resolve(r || null)));
        if (!sector) return null;
        const { getArchetypeInfo } = require('./unified-archetype-registry');
        const archetypeInfo = getArchetypeInfo(sector.archetype);
        const mineralDisplay = (() => {
            const core = ['Ferrite Alloy','Crytite','Ardanium','Vornite','Zerothium'].map(n=>({ name:n, mult: '×1.0' }));
            const primary = (archetypeInfo.minerals?.primary || []).map(n=>({ name:n, mult:'×1.5' }));
            const secondary = (archetypeInfo.minerals?.secondary || []).map(n=>({ name:n, mult:'×0.8' }));
            return { core, primary, secondary };
        })();
        // Regions
        const regions = await new Promise((resolve) => db.all('SELECT region_id as id, health, cells_json as cells FROM regions WHERE sector_id = ?', [sectorId], (e, rows) => resolve(rows || [])));
        // Belts (sector metadata only)
        const beltSectors = await new Promise((resolve) => db.all('SELECT belt_key, sector_index, region_id, inner_radius, width, arc_start, arc_end, density, hazard FROM belt_sectors WHERE sector_id = ?', [sectorId], (e, rows) => resolve(rows || [])));
        // Wormholes (links summary)
        const wormholes = await new Promise((resolve) => db.all('SELECT id, a_object_id, b_object_id, external_sector_id, stability, mass_limit, cooldown FROM wormhole_links WHERE sector_id = ?', [sectorId], (e, rows) => resolve(rows || [])));
        // Wormhole endpoints (objects)
        const wormholeEndpoints = await new Promise((resolve) => db.all('SELECT id, x, y, meta FROM sector_objects WHERE sector_id = ? AND type = ?', [sectorId, 'wormhole'], (e, rows) => resolve(rows || [])));
        // Mineral counts (sector-wide, category=mineral)
        const mineralCounts = await new Promise((resolve) => db.all(
            `SELECT rt.resource_name as name, COUNT(rn.id) as count
             FROM resource_nodes rn
             JOIN resource_types rt ON rn.resource_type_id = rt.id
             WHERE rn.sector_id = ? AND rt.category = 'mineral'
             GROUP BY rn.resource_type_id
             ORDER BY count DESC`,
            [sectorId], (e, rows) => resolve(rows || [])
        ));
        // Lanes and taps (read-only overlay)
        const laneEdges = await new Promise((resolve) => db.all(
            `SELECT id, cls, region_id, polyline_json, width_core, width_shoulder, lane_speed, cap_base, headway, mass_limit, window_json, permits_json, protection_json
             FROM lane_edges WHERE sector_id = ?`,
            [sectorId], (e, rows) => resolve(rows || [])
        ));
        const laneTaps = await new Promise((resolve) => db.all(
            `SELECT id, edge_id, x, y, poi_object_id, side FROM lane_taps WHERE edge_id IN (
                 SELECT id FROM lane_edges WHERE sector_id = ?
             )`,
            [sectorId], (e, rows) => resolve(rows || [])
        ));
        const tapsByEdge = {};
        for (const t of (laneTaps || [])) {
            (tapsByEdge[t.edge_id] = tapsByEdge[t.edge_id] || []).push({ id: t.id, x: t.x, y: t.y, poi_object_id: t.poi_object_id, side: t.side });
        }
        return {
            id: sector.id,
            archetype: sector.archetype || null,
            name: archetypeInfo.name,
            regions: regions.map(r => ({ id: r.id, health: r.health, cells: safeJson(r.cells) })),
            belts: beltSectors,
            wormholes,
            wormholeEndpoints: (wormholeEndpoints || []).map(w => ({ id: w.id, x: w.x, y: w.y, meta: safeJson(w.meta) })),
            lanes: (laneEdges || []).map(e => ({
                id: e.id,
                cls: e.cls,
                region_id: e.region_id,
                polyline: safeJsonObject(e.polyline_json, []),
                width_core: e.width_core,
                width_shoulder: e.width_shoulder,
                lane_speed: e.lane_speed,
                cap_base: e.cap_base,
                headway: e.headway,
                mass_limit: e.mass_limit,
                window: safeJsonObject(e.window_json, null),
                permits: safeJsonObject(e.permits_json, null),
                protection: safeJsonObject(e.protection_json, null)
            })),
            laneTapsByEdge: tapsByEdge,
            minerals: mineralCounts,
            mineralDisplay
        };
    }

    static async getFacts(sectorId) {
        return this.getSectorSummary(sectorId);
    }
}

module.exports = { SystemFactsService };
function safeJson(s) { try { return JSON.parse(s || '[]'); } catch { return []; } }
function safeJsonObject(s, def=null) { try { return s ? JSON.parse(s) : def; } catch { return def; } }


