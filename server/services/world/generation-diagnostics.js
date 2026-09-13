const db = require('../../db');

function query(sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

async function diagnoseSector(sectorId) {
    const sector = (await query('SELECT id, archetype, generation_seed, generation_completed FROM sectors WHERE id = ?', [sectorId]))[0];
    if (!sector) return null;
    const objects = await query('SELECT id, type, celestial_type, x, y, radius, parent_object_id, meta FROM sector_objects WHERE sector_id = ? ORDER BY id', [sectorId]);
    const nodes = await query('SELECT rn.x, rn.y, rn.size, rn.resource_amount, rt.resource_name, rn.parent_object_id FROM resource_nodes rn JOIN resource_types rt ON rt.id = rn.resource_type_id WHERE rn.sector_id = ? ORDER BY rn.id', [sectorId]);
    const belts = await query('SELECT belt_key, sector_index, region_id, inner_radius, width, arc_start, arc_end, density, hazard FROM belt_sectors WHERE sector_id = ? ORDER BY belt_key, sector_index', [sectorId]);
    const orbitalRings = await query('SELECT ring_index, center_x, center_y, radius, width, planet_object_id FROM orbital_rings WHERE sector_id = ? ORDER BY ring_index', [sectorId]);
    const lanes = await query('SELECT id, cls, region_id, polyline_json FROM lane_edges WHERE sector_id = ?', [sectorId]);
    const taps = await query('SELECT edge_id FROM lane_taps WHERE edge_id IN (SELECT id FROM lane_edges WHERE sector_id = ?)', [sectorId]);
    const boundsViolations = [...objects, ...nodes].filter((o) => Number(o.x) < 0 || Number(o.y) < 0 || Number(o.x) >= 5000 || Number(o.y) >= 5000).length;
    const resourceByMineral = {};
    const resourceByParent = { attached: 0, unassigned: 0 };
    for (const node of nodes) {
        resourceByMineral[node.resource_name] = (resourceByMineral[node.resource_name] || 0) + 1;
        resourceByParent[node.parent_object_id == null ? 'unassigned' : 'attached']++;
    }
    const laneTaps = new Map();
    for (const tap of taps) laneTaps.set(Number(tap.edge_id), (laneTaps.get(Number(tap.edge_id)) || 0) + 1);
    return {
        sector: { id: sector.id, archetype: sector.archetype, seed: sector.generation_seed, complete: !!sector.generation_completed },
        counts: objects.reduce((acc, o) => { const key = o.celestial_type || o.type; acc[key] = (acc[key] || 0) + 1; return acc; }, {}),
        resourceNodes: { total: nodes.length, byMineral: resourceByMineral, parentage: resourceByParent },
        belts: { sectors: belts.length, byBelt: belts.reduce((acc, b) => { acc[b.belt_key] = (acc[b.belt_key] || 0) + 1; return acc; }, {}) },
        orbitalRings,
        lanes: lanes.map((lane) => ({ id: lane.id, class: lane.cls, region: lane.region_id, taps: laneTaps.get(Number(lane.id)) || 0 })),
        boundsViolations
    };
}

module.exports = { diagnoseSector };
