// Resource node generation with seeded system profiles, regional abundance,
// belt wedge density, and centroid clustering.
const db = require('../../db');
const { createRngStreams, randFloat, randInt, choice } = require('./rng');
const { CORE_MINERALS } = require('./mineral-catalog');
const { createResourceProfile } = require('./resource-profile');
const { getArchetypeContract } = require('./unified-archetype-registry');

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

async function spawnNodesForSector(sectorId, options = {}) {
    const sectorRow = await new Promise((resolve) => db.get('SELECT id, archetype, generation_seed FROM sectors WHERE id = ?', [sectorId], (e, r) => resolve(r || null)));
    const archetypeKey = sectorRow?.archetype || 'standard';
    const rng = options.rng || createRngStreams(options.seed ?? sectorRow?.generation_seed ?? sectorId).resources;
    const sun = await new Promise((resolve) => db.get('SELECT x, y FROM sector_objects WHERE sector_id = ? AND celestial_type = "star" ORDER BY id LIMIT 1', [sectorId], (e, r) => resolve(r || { x: 2500, y: 2500 })));
    const center = { x: Number(sun.x || 2500), y: Number(sun.y || 2500) };

    // Legacy regional rules may still bias abundance, but regional health no
    // longer gates whether a generated system has access to a mineral.
    const rules = await new Promise((resolve) => db.all('SELECT region_id, mineral_name, weight FROM mineral_rules WHERE sector_id = ?', [sectorId], (e, rows) => resolve(rows || [])));
    const byRegion = new Map();
    for (const r of rules) {
        const key = String(r.region_id);
        if (!byRegion.has(key)) byRegion.set(key, new Map());
        byRegion.get(key).set(r.mineral_name, { weight: Number(r.weight || 0) });
    }

    // Belt wedge geometry and density hints
    const beltSectors = await new Promise((resolve) => db.all(
        'SELECT id, belt_key, sector_index, region_id, inner_radius, width, arc_start, arc_end, density FROM belt_sectors WHERE sector_id = ? ORDER BY belt_key, sector_index',
        [sectorId],
        (e, rows) => resolve(rows || [])
    ));

    // Helper: map mineral name -> resource_type id
    const getTypeId = async (name) => new Promise((resolve) => db.get('SELECT id FROM resource_types WHERE resource_key = ? OR resource_name = ? LIMIT 1', [name, name], (e, r) => resolve(r?.id || null)));

    const streams = createRngStreams(options.seed ?? sectorRow?.generation_seed ?? sectorId);
    const contract = getArchetypeContract(archetypeKey);
    const resourceProfile = options.resourceProfile || createResourceProfile({
        archetypeKey: contract.key,
        signatureMinerals: contract.signatureMinerals,
        randomSpecialtyCount: contract.randomSpecialtyCount,
        rng: streams.resourceProfile
    });
    const primaryMinerals = resourceProfile.signatureMinerals;
    const secondaryMinerals = resourceProfile.randomSpecialties;

    // Node count per density tier
    const DENSITY_BASE = { high: 8, med: 5, low: 3 };

    // Clean existing nodes in this sector before respawn
    await new Promise((resolve) => db.run('DELETE FROM resource_nodes WHERE sector_id = ?', [sectorId], () => resolve()));

    // Try to map belt sector centroid objects for parent linkage
    const beltCentroids = new Map(); // key `${belt_key}-${sector_index}` -> object id
    const centroidRows = await new Promise((resolve) => db.all(
        `SELECT id, x, y, meta FROM sector_objects WHERE sector_id = ? AND type = 'belt'`,
        [sectorId], (e, rows) => resolve(rows || [])
    ));
    for (const row of centroidRows) {
        let m = {}; try { m = row.meta ? JSON.parse(row.meta) : {}; } catch {}
        const key = `${m.belt}-${m.sectorIndex}`;
        if (m.belt != null && m.sectorIndex != null) beltCentroids.set(key, row.id);
    }

    // For each belt wedge, build weighted bag and spawn nodes
    for (const s of beltSectors) {
        const densityKey = String(s.density || 'med').toLowerCase();
        const base = DENSITY_BASE[densityKey] ?? DENSITY_BASE.med;
        const nodeCount = Math.max(3, base);

        // Build mineral weight bag
        const weights = new Map();
        // Allowed set: core + archetype primaries + secondaries
        const allowed = new Set([...CORE_MINERALS, ...primaryMinerals, ...secondaryMinerals]);
        // Core five always present
        for (const m of CORE_MINERALS) if (allowed.has(m)) weights.set(m, (weights.get(m) || 0) + 1.0);
        // Primaries boosted
        for (const m of primaryMinerals) if (allowed.has(m)) weights.set(m, (weights.get(m) || 0) + 3.0);
        // Secondaries light weight
        for (const m of secondaryMinerals) if (allowed.has(m)) weights.set(m, (weights.get(m) || 0) + 1.5);
        // Region rules overlay
        const regionRules = byRegion.get(String(s.region_id));
        if (regionRules) {
            for (const [mineral, cfg] of regionRules.entries()) {
                if (allowed.has(mineral)) weights.set(mineral, (weights.get(mineral) || 0) + Math.max(0, Number(cfg.weight || 0)));
            }
        }
        // If no weights, skip this wedge
        const entries = Array.from(weights.entries()).filter(([, w]) => w > 0);
        if (entries.length === 0) continue;

        // Ensure a visible pocket near wedge centroid: cluster 40% of nodes near centroid
        const a0 = Number(s.arc_start), a1 = Number(s.arc_end);
        const amid = (a0 + a1) / 2;
        const rmid = Number(s.inner_radius) + Number(s.width) / 2;
        const clusterCount = Math.max(3, Math.floor(nodeCount * 0.4));
        const remainder = Math.max(0, nodeCount - clusterCount);
        const pocketAngle = randFloat(rng, -0.18, 0.18);
        const pocketRadius = randFloat(rng, -Math.min(80, Number(s.width) * 0.2), Math.min(80, Number(s.width) * 0.2));

        // Spawn helper
        const spawnAtPolar = async (radius, angle, mineralName, asCluster = false) => {
            const resTypeId = await getTypeId(mineralName);
            if (!resTypeId) return;
            const x = Math.max(1, Math.min(4999, Math.round(center.x + Math.cos(angle) * radius)));
            const y = Math.max(1, Math.min(4999, Math.round(center.y + Math.sin(angle) * radius)));
            const size = 2;
            const amt = randInt(rng, 160, 379);
            const parentKey = `${s.belt_key}-${s.sector_index}`;
            const parentId = beltCentroids.get(parentKey) || null;
            const meta = JSON.stringify({ mineral: mineralName, resourceType: mineralName, category: 'mineral', fieldType: 'asteroid-hub', belt: s.belt_key, sectorIndex: s.sector_index });
            await new Promise((resolve, reject) => db.run(
                `INSERT INTO resource_nodes (sector_id, parent_object_id, resource_type_id, x, y, size, resource_amount, max_resource, harvest_difficulty, is_depleted, meta)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1.0, 0, ?)`,
                [sectorId, parentId, resTypeId, x, y, size, amt, amt, meta],
                (err)=> err?reject(err):resolve()
            ));
        };

        const pickMineral = () => {
            // Weighted pick
            const total = entries.reduce((acc, [, w]) => acc + w, 0);
            let r = rng() * total;
            for (const [name, w] of entries) { r -= w; if (r <= 0) return name; }
            return entries[entries.length - 1][0];
        };

        // Cluster around centroid (tight angular and radial jitter)
        for (let i = 0; i < clusterCount; i++) {
            // Tight jitter: ensure many fall within ±25 tiles of centroid
            const dr = pocketRadius + (rng() - 0.5) * 70;
            const da = pocketAngle + (rng() - 0.5) * (a1 - a0) * 0.18;
            const rr = clamp(rmid + dr, Number(s.inner_radius), Number(s.inner_radius) + Number(s.width));
            const aa = clamp(amid + da, a0, a1);
            // First few: guarantee mix of core + primary for immediate visibility
            let mineralName;
            if (i === 0 && primaryMinerals.length > 0) mineralName = choice(rng, primaryMinerals);
            else if (i === 1) mineralName = choice(rng, CORE_MINERALS);
            else mineralName = pickMineral();
            await spawnAtPolar(rr, aa, mineralName, true);
        }

        // Guarantee a small primary/core foothold without making every pocket identical.
        for (let g = 0; g < 2; g++) {
            const dr = pocketRadius + (rng() - 0.5) * 100;
            const da = pocketAngle + (rng() - 0.5) * (a1 - a0) * 0.12;
            const rr = clamp(rmid + dr, Number(s.inner_radius), Number(s.inner_radius) + Number(s.width));
            const aa = clamp(amid + da, a0, a1);
            const mn = g % 2 === 0 ? (choice(rng, primaryMinerals) || CORE_MINERALS[0]) : choice(rng, CORE_MINERALS);
            await spawnAtPolar(rr, aa, mn, true);
        }

        // Spread the rest across the wedge bounds
        for (let i = 0; i < remainder; i++) {
            const rr = Number(s.inner_radius) + randFloat(rng, 0, Math.max(1, Number(s.width)));
            const aa = randFloat(rng, a0, a1);
            await spawnAtPolar(rr, aa, pickMineral());
        }
    }

    // Asteroid-heavy systems also carry a light background of small pockets
    // throughout the orbital scaffold. Dense, parented nodes above remain the
    // recognizable mining hubs; these are low-yield exploration finds.
    if (archetypeKey === 'asteroid-heavy') {
        const rings = await new Promise((resolve) => db.all('SELECT radius FROM orbital_rings WHERE sector_id = ? ORDER BY ring_index', [sectorId], (e, rows) => resolve(rows || [])));
        const diffuseCount = randInt(rng, 12, 22);
        const diffuseMinerals = [...CORE_MINERALS, ...primaryMinerals, ...primaryMinerals];
        for (let i = 0; i < diffuseCount; i++) {
            const baseRadius = rings.length ? Number(choice(rng, rings).radius) : randInt(rng, 500, 2300);
            const radius = clamp(baseRadius + randFloat(rng, -180, 180), 350, 2380);
            const angle = randFloat(rng, 0, Math.PI * 2);
            const mineral = choice(rng, diffuseMinerals);
            const typeId = await getTypeId(mineral);
            if (!typeId) continue;
            const x = Math.max(1, Math.min(4999, Math.round(center.x + Math.cos(angle) * radius)));
            const y = Math.max(1, Math.min(4999, Math.round(center.y + Math.sin(angle) * radius)));
            const amount = randInt(rng, 55, 145);
            const meta = JSON.stringify({ mineral, resourceType: mineral, category: 'mineral', fieldType: 'diffuse-pocket' });
            await new Promise((resolve, reject) => db.run(
                `INSERT INTO resource_nodes (sector_id, parent_object_id, resource_type_id, x, y, size, resource_amount, max_resource, harvest_difficulty, is_depleted, meta)
                 VALUES (?, NULL, ?, ?, ?, 2, ?, ?, 1.0, 0, ?)`,
                [sectorId, typeId, x, y, amount, amount, meta], (e) => e ? reject(e) : resolve()
            ));
        }
    }

    const count=await new Promise((resolve,reject)=>db.get('SELECT COUNT(*) n FROM resource_nodes WHERE sector_id=?',[sectorId],(e,r)=>e?reject(e):resolve(r.n)));
    if(!count) {
        // Archetypes without belts still need accessible mining pockets.
        const planets=await new Promise((resolve,reject)=>db.all("SELECT x,y,radius FROM sector_objects WHERE sector_id=? AND celestial_type='planet'",[sectorId],(e,r)=>e?reject(e):resolve(r||[])));
        for(const planet of planets)for(let i=0;i<5;i++) {
            const typeId=await getTypeId(CORE_MINERALS[i]); if(!typeId)continue;
            const angle=randFloat(rng,0,Math.PI*2),distance=Number(planet.radius)+60+randInt(rng,0,50);
            const x=Math.round(planet.x+Math.cos(angle)*distance),y=Math.round(planet.y+Math.sin(angle)*distance);
            await new Promise((resolve,reject)=>db.run('INSERT INTO resource_nodes(sector_id,resource_type_id,x,y,size,resource_amount,max_resource,harvest_difficulty,is_depleted,meta) VALUES(?,?,?,?,2,120,120,1,0,?)',[sectorId,typeId,x,y,JSON.stringify({resourceType:CORE_MINERALS[i],fieldType:'planetary-pocket'})],e=>e?reject(e):resolve()));
        }
    }

    // A generated resource profile is a system-level availability guarantee,
    // not merely a weighting hint. Fill any minerals missed by random node
    // placement, including specialty access in archetypes without belts.
    const presentRows = await new Promise((resolve, reject) => db.all(
        `SELECT DISTINCT rt.resource_name
           FROM resource_nodes rn
           JOIN resource_types rt ON rt.id = rn.resource_type_id
          WHERE rn.sector_id = ?`,
        [sectorId], (e, rows) => e ? reject(e) : resolve(rows || [])
    ));
    const present = new Set(presentRows.map((row) => row.resource_name));
    const missing = resourceProfile.availableMinerals.filter((mineral) => !present.has(mineral));
    if (missing.length) {
        const anchors = await new Promise((resolve, reject) => db.all(
            `SELECT x, y, radius FROM sector_objects
              WHERE sector_id = ? AND celestial_type = 'planet'
              ORDER BY id`,
            [sectorId], (e, rows) => e ? reject(e) : resolve(rows || [])
        ));
        for (let i = 0; i < missing.length; i++) {
            const mineral = missing[i];
            const typeId = await getTypeId(mineral);
            if (!typeId) throw new Error(`Missing resource type for generated mineral ${mineral}`);
            const anchor = anchors.length ? anchors[i % anchors.length] : center;
            const ring = Number(anchor.radius || 12) + 85 + Math.floor(i / Math.max(1, anchors.length)) * 18;
            const angle = randFloat(rng, 0, Math.PI * 2);
            const x = Math.max(1, Math.min(4999, Math.round(Number(anchor.x) + Math.cos(angle) * ring)));
            const y = Math.max(1, Math.min(4999, Math.round(Number(anchor.y) + Math.sin(angle) * ring)));
            const amount = randInt(rng, 100, 160);
            const meta = JSON.stringify({ mineral, resourceType: mineral, category: 'mineral', fieldType: 'profile-guarantee' });
            await new Promise((resolve, reject) => db.run(
                `INSERT INTO resource_nodes
                    (sector_id, resource_type_id, x, y, size, resource_amount, max_resource, harvest_difficulty, is_depleted, meta)
                 VALUES (?, ?, ?, ?, 2, ?, ?, 1.0, 0, ?)`,
                [sectorId, typeId, x, y, amount, amount, meta],
                (e) => e ? reject(e) : resolve()
            ));
        }
    }

    return { success: true, resourceProfile };
}

module.exports = { spawnNodesForSector };
