const db = require('../../../db');
const { BaseStep } = require('./base-step');

class FinalValidateStep extends BaseStep {
    constructor() { super('finalValidate'); }
    async execute(context, options = {}) {
        await require('../lane-clearance').repairLaneClearance(db,context.sectorId);
        await require('../physical-placement').validateBodies(db,context.sectorId);
        const star = await new Promise((resolve)=>db.get('SELECT id FROM sector_objects WHERE sector_id = ? AND celestial_type = "star" LIMIT 1', [context.sectorId], (e,r)=>resolve(r||null)));
        const planets = await new Promise((resolve)=>db.get('SELECT COUNT(1) as c FROM sector_objects WHERE sector_id = ? AND celestial_type = "planet"', [context.sectorId], (e,r)=>resolve(Number(r?.c||0))));
        const nodes = await new Promise((resolve)=>db.get('SELECT COUNT(1) as c FROM resource_nodes WHERE sector_id = ?', [context.sectorId], (e,r)=>resolve(Number(r?.c||0))));
        const station = await new Promise((resolve)=>db.get('SELECT id FROM sector_objects WHERE sector_id = ? AND type = "station" LIMIT 1', [context.sectorId], (e,r)=>resolve(r||null)));
        const objects = await new Promise((resolve)=>db.all('SELECT type, celestial_type, x, y, radius FROM sector_objects WHERE sector_id = ?', [context.sectorId], (e,r)=>resolve(r||[])));
        const belts = await new Promise((resolve)=>db.get('SELECT COUNT(1) as c FROM belt_sectors WHERE sector_id = ?', [context.sectorId], (e,r)=>resolve(Number(r?.c||0))));
        const orbitalRings = await new Promise((resolve)=>db.all('SELECT ring_index, center_x, center_y, radius, width, planet_object_id FROM orbital_rings WHERE sector_id = ? ORDER BY ring_index', [context.sectorId], (e,r)=>resolve(r||[])));
        const lanes = await new Promise((resolve)=>db.all('SELECT id FROM lane_edges WHERE sector_id = ?', [context.sectorId], (e,r)=>resolve(r||[])));
        const taps = await new Promise((resolve)=>db.all('SELECT edge_id FROM lane_taps WHERE edge_id IN (SELECT id FROM lane_edges WHERE sector_id = ?)', [context.sectorId], (e,r)=>resolve(r||[])));
        const failures = [];
        if (!star) failures.push('no star present');
        if (planets <= 0) failures.push('no planets present');
        if (nodes <= 0) failures.push('no resource nodes');
        if (options.createStartingObjects && !station) failures.push('no starting station');
        if (orbitalRings.length !== planets) failures.push('orbital ring count does not match planet count');
        if (orbitalRings.some((ring) => !ring.planet_object_id || Number(ring.radius) <= 0)) failures.push('invalid orbital ring assignment');
        if (objects.some((o) => Number(o.x) < 0 || Number(o.y) < 0 || Number(o.x) >= 5000 || Number(o.y) >= 5000)) failures.push('object outside sector bounds');
        if (context.archetype === 'asteroid-heavy' && planets < 5) failures.push('asteroid-heavy requires at least 5 planets');
        if (context.archetype === 'asteroid-heavy' && belts < 1) failures.push('asteroid-heavy requires belt sectors');
        if (lanes.some((l) => !taps.some((t) => Number(t.edge_id) === Number(l.id)))) failures.push('lane without taps');
        if (failures.length) throw new Error(`Validation failed: ${failures.join(', ')}`);
        const counts = objects.reduce((acc, o) => { const key = o.celestial_type || o.type; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
        const manifest = { counts, planets, resourceNodes: nodes, beltSectors: belts, orbitalRings, laneCount: lanes.length, tapCount: taps.length };
        await new Promise((resolve, reject) => db.run(
            `INSERT INTO generation_manifests (sector_id, generation_seed, generator_version, archetype, manifest_json, updated_at)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(sector_id) DO UPDATE SET generation_seed=excluded.generation_seed, generator_version=excluded.generator_version, archetype=excluded.archetype, manifest_json=excluded.manifest_json, updated_at=CURRENT_TIMESTAMP`,
            [context.sectorId, context.seed, 'physical-scale-v1', context.archetype, JSON.stringify(manifest)], (e) => e ? reject(e) : resolve()
        ));
        await new Promise((resolve)=>db.run('UPDATE sectors SET generation_completed = 1 WHERE id = ?', [context.sectorId], ()=>resolve()));
        this.result = { valid: true, ...manifest };
    }
}

module.exports = { FinalValidateStep };
