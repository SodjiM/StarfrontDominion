// Resource node generation with belt wedge density, mineral gating, and centroid clustering
const db = require('../../db');

// Core minerals are always available; two primaries are emphasized
const CORE_MINERALS = ['Ferrite Alloy', 'Crytite', 'Ardanium', 'Vornite', 'Zerothium'];
const DEFAULT_PRIMARIES = ['Fluxium', 'Auralite'];

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

async function spawnNodesForSector(sectorId) {
    const sectorRow = await new Promise((resolve) => db.get('SELECT id, archetype FROM sectors WHERE id = ?', [sectorId], (e, r) => resolve(r || null)));
    const archetypeKey = sectorRow?.archetype || 'standard';

    // Load region health for gating
    const regionHealth = new Map();
    const regions = await new Promise((resolve) => db.all('SELECT region_id, health FROM regions WHERE sector_id = ?', [sectorId], (e, rows) => resolve(rows || [])));
    for (const r of regions) regionHealth.set(String(r.region_id), Number(r.health || 50));

    // Load mineral rules/weights per region (may include gated secondaries)
    const rules = await new Promise((resolve) => db.all('SELECT region_id, mineral_name, weight, gated, unlock_threshold FROM mineral_rules WHERE sector_id = ?', [sectorId], (e, rows) => resolve(rows || [])));
    const byRegion = new Map();
    for (const r of rules) {
        const key = String(r.region_id);
        if (!byRegion.has(key)) byRegion.set(key, new Map());
        byRegion.get(key).set(r.mineral_name, { weight: Number(r.weight || 0), gated: !!r.gated, unlock: r.unlock_threshold != null ? Number(r.unlock_threshold) : null });
    }

    // Belt wedge geometry and density hints
    const beltSectors = await new Promise((resolve) => db.all(
        'SELECT id, belt_key, sector_index, region_id, inner_radius, width, arc_start, arc_end, density FROM belt_sectors WHERE sector_id = ? ORDER BY belt_key, sector_index',
        [sectorId],
        (e, rows) => resolve(rows || [])
    ));

    // Helper: map mineral name -> resource_type id
    const getTypeId = async (name) => new Promise((resolve) => db.get('SELECT id FROM resource_types WHERE resource_name = ?', [name], (e, r) => resolve(r?.id || null)));

    // Determine primaries (could vary by archetype later). Keep simple default for now.
    const primaryMinerals = DEFAULT_PRIMARIES;

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
        const health = regionHealth.get(String(s.region_id)) ?? 50;
        const densityKey = String(s.density || 'med').toLowerCase();
        const base = DENSITY_BASE[densityKey] ?? DENSITY_BASE.med;
        // Slight health modulation (0.8x at 20hp → 1.2x at 80hp)
        const healthFactor = 0.8 + clamp(health, 0, 100) * 0.004;
        let nodeCount = Math.max(3, Math.round(base * healthFactor));

        // Build mineral weight bag
        const weights = new Map();
        // Core five always present
        for (const m of CORE_MINERALS) weights.set(m, (weights.get(m) || 0) + 1.0);
        // Primaries boosted
        for (const m of primaryMinerals) weights.set(m, (weights.get(m) || 0) + 3.0);
        // Region rules overlay
        const regionRules = byRegion.get(String(s.region_id));
        if (regionRules) {
            for (const [mineral, cfg] of regionRules.entries()) {
                const threshold = (cfg.unlock != null ? cfg.unlock : 55);
                if (cfg.gated && health < threshold) {
                    // Defer spawn for gated minerals below threshold
                    continue;
                }
                weights.set(mineral, (weights.get(mineral) || 0) + Math.max(0, Number(cfg.weight || 0)));
            }
        }
        // If no weights, skip this wedge
        const entries = Array.from(weights.entries()).filter(([, w]) => w > 0);
        if (entries.length === 0) continue;

        // Ensure a visible pocket near wedge centroid: cluster 40% of nodes near centroid
        const a0 = Number(s.arc_start), a1 = Number(s.arc_end);
        const amid = (a0 + a1) / 2;
        const rmid = Number(s.inner_radius) + Number(s.width) / 2;
        const clusterCount = Math.max(5, Math.floor(nodeCount * 0.5));
        const remainder = Math.max(0, nodeCount - clusterCount);

        // Spawn helper
        const spawnAtPolar = async (radius, angle, mineralName, asCluster = false) => {
            const resTypeId = await getTypeId(mineralName);
            if (!resTypeId) return;
            const x = 2500 + Math.round(Math.cos(angle) * radius);
            const y = 2500 + Math.round(Math.sin(angle) * radius);
            const size = 1 + Math.floor(Math.random() * 2);
            const amt = 160 + Math.floor(Math.random() * 220);
            const parentKey = `${s.belt_key}-${s.sector_index}`;
            const parentId = asCluster && beltCentroids.has(parentKey) ? beltCentroids.get(parentKey) : null;
            const meta = JSON.stringify({ mineral: mineralName, resourceType: mineralName, category: 'mineral' });
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
            let r = Math.random() * total;
            for (const [name, w] of entries) { r -= w; if (r <= 0) return name; }
            return entries[entries.length - 1][0];
        };

        // Cluster around centroid (tight angular and radial jitter)
        for (let i = 0; i < clusterCount; i++) {
            // Tight jitter: ensure many fall within ±25 tiles of centroid
            const dr = (Math.random() - 0.5) * 30; // ±15 tiles
            const da = (Math.random() - 0.5) * (a1 - a0) * 0.08; // tighter sector
            const rr = clamp(rmid + dr, Number(s.inner_radius), Number(s.inner_radius) + Number(s.width));
            const aa = clamp(amid + da, a0, a1);
            // First few: guarantee mix of core + primary for immediate visibility
            let mineralName;
            if (i === 0 && primaryMinerals.length > 0) mineralName = primaryMinerals[Math.floor(Math.random() * primaryMinerals.length)];
            else if (i === 1) mineralName = CORE_MINERALS[Math.floor(Math.random() * CORE_MINERALS.length)];
            else mineralName = pickMineral();
            await spawnAtPolar(rr, aa, mineralName, true);
        }

        // Guaranteed test nodes within ±25 tiles of centroid
        for (let g = 0; g < 4; g++) {
            const dr = (Math.random() - 0.5) * 50; // ±25 tiles
            const da = (Math.random() - 0.5) * (a1 - a0) * 0.04;
            const rr = clamp(rmid + dr, Number(s.inner_radius), Number(s.inner_radius) + Number(s.width));
            const aa = clamp(amid + da, a0, a1);
            const mn = g % 2 === 0 ? (primaryMinerals[Math.floor(Math.random() * primaryMinerals.length)] || CORE_MINERALS[0]) : CORE_MINERALS[Math.floor(Math.random() * CORE_MINERALS.length)];
            await spawnAtPolar(rr, aa, mn, true);
        }

        // Spread the rest across the wedge bounds
        for (let i = 0; i < remainder; i++) {
            const rr = Number(s.inner_radius) + Math.floor(Math.random() * Math.max(1, Number(s.width)));
            const aa = a0 + Math.random() * Math.max(0.0001, (a1 - a0));
            await spawnAtPolar(rr, aa, pickMineral());
        }
    }

    return { success: true };
}

module.exports = { spawnNodesForSector };

