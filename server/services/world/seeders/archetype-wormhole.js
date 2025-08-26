const { randInt, randFloat, choice } = require('../rng');

// Wormhole Cluster — “Doors & Drift”
// Primary: Riftstone, Phasegold; Secondary: Fluxium, Tachytrium, Aetherium, Quarzon, Spectrathene
const MINERALS = {
    primary: ['Riftstone','Phasegold'],
    secondary: ['Fluxium','Tachytrium','Aetherium','Quarzon','Spectrathene']
};

const DISPLAY = {
    name: 'Wormhole Cluster',
    description: 'Hubs and throats with scheduled windows and drift trade.'
};

function plan({ sectorId, seed, rng }) {
    const hasB = (rng() < 0.2);
    const base = hasB
        ? [['A','B','A'], ['C','C','C'], ['A','B','A']]
        : [['A','C','A'], ['C','C','C'], ['A','C','A']];
    // rotate 0..3
    const turns = randInt(rng, 0, 3);
    let grid = base.map(r => r.slice());
    for (let t = 0; t < turns; t++) {
        const n = 3; const r = Array.from({length:n}, () => Array(n));
        for (let i=0;i<n;i++) for (let j=0;j<n;j++) r[j][n-1-i] = grid[i][j];
        grid = r;
    }
    if (rng() < 0.5) { grid = grid.map(row => row.slice().reverse()); }

    const regionHealth = { A: 50, C: 50 }; if (hasB) regionHealth.B = 50;
    const regions = { grid, health: regionHealth };

    // Star at center
    const sun = { type: 'sun', x: 2500, y: 2500 };

    // Planets
    const planets = [];
    const nPlanets = choice(rng, [4,5,6,7]);
    const bands = [[600,1200],[1300,2200],[2300,3800]];
    for (let i=0;i<nPlanets;i++) {
        const [rMin, rMax] = choice(rng, bands);
        const r = randInt(rng, rMin, rMax);
        const a = randFloat(rng, 0, Math.PI*2);
        planets.push({ id:`P${i}`, x: 2500 + Math.cos(a)*r, y: 2500 + Math.sin(a)*r, moons: [] });
    }

    // Belts (>=1)
    const belts = [{ id:'B0', inner: 1500, width: randInt(rng, 250, 400), sectors: randInt(rng,4,7) }];
    if (rng() < 0.4) belts.push({ id:'B1', inner: 2400, width: randInt(rng, 300, 500), sectors: randInt(rng,4,7) });

    // Wormhole endpoints and links (simple sketch)
    const hubs = randInt(rng, 3, 5);
    const fringes = randInt(rng, 2, 4);
    const microholes = randInt(rng, 2, 6);
    const links = [];
    for (let i=0;i<hubs;i++) links.push({ type:'hub', stability: randInt(rng,70,95) });
    for (let i=0;i<fringes;i++) links.push({ type:'fringe', stability: randInt(rng,35,70) });
    for (let i=0;i<microholes;i++) links.push({ type:'micro', stability: randInt(rng,10,40) });

    return { regions, sun, planets, belts, wormholes: links };
}

async function persist({ sectorId, plan, db }) {
    // Persist regions
    const { grid, health } = plan.regions;
    const cells = [];
    for (let r=0;r<3;r++) for (let c=0;c<3;c++) cells.push({ row:r, col:c, label:grid[r][c] });
    const regionIds = Array.from(new Set(cells.map(c => c.label)));
    for (const id of regionIds) {
        const cellsJson = JSON.stringify(cells.filter(c => c.label === id).map(c => ({row:c.row,col:c.col})));
        await new Promise((resolve,reject)=>db.run(
            'INSERT OR REPLACE INTO regions (sector_id, region_id, cells_json, health) VALUES (?, ?, ?, ?)',
            [sectorId, id, cellsJson, health[id] ?? 50],
            (e)=> e?reject(e):resolve()
        ));
    }
    // Sun
    const sunMeta = JSON.stringify({ name:'Primary Star', celestial:true, alwaysKnown:1 });
    const sunId = await new Promise((resolve,reject)=>db.run(
        `INSERT INTO sector_objects (sector_id, type, celestial_type, x, y, owner_id, meta, radius)
         VALUES (?, 'sun', 'star', ?, ?, NULL, ?, 30)`,
        [sectorId, plan.sun.x, plan.sun.y, sunMeta], function(err){ return err?reject(err):resolve(this.lastID); }
    ));
    // Planets
    for (const p of plan.planets) {
        const meta = JSON.stringify({ name: p.id, celestial:true, scannable:true, alwaysKnown:1 });
        const planetId = await new Promise((resolve,reject)=>db.run(
            `INSERT INTO sector_objects (sector_id, type, celestial_type, x, y, owner_id, meta, radius, parent_object_id)
             VALUES (?, 'planet', 'planet', ?, ?, NULL, ?, 12, ?)`,
            [sectorId, Math.round(p.x), Math.round(p.y), meta, sunId],
            function(e){ return e?reject(e):resolve(this.lastID); }
        ));
        const moonCount = Math.random() < 0.5 ? 1 : 0;
        for (let m=0;m<moonCount;m++) {
            const dist = 18 + Math.floor(Math.random()*16);
            const ang = Math.random()*Math.PI*2;
            const mx = Math.round(p.x + Math.cos(ang)*dist);
            const my = Math.round(p.y + Math.sin(ang)*dist);
            const mMeta = JSON.stringify({ name: `${p.id}-M${m}`, celestial:true, scannable:true, alwaysKnown:1 });
            await new Promise((resolve,reject)=>db.run(
                `INSERT INTO sector_objects (sector_id, type, celestial_type, x, y, owner_id, meta, radius, parent_object_id)
                 VALUES (?, 'moon', 'moon', ?, ?, NULL, ?, 6, ?)`,
                [sectorId, mx, my, mMeta, planetId],
                (e)=> e?reject(e):resolve()
            ));
        }
    }
    // Belts sectors (metadata only) with region mapping by centroid
    const cellW = 5000/3, cellH = 5000/3;
    const labelAt = (x,y) => {
        const col = Math.max(0, Math.min(2, Math.floor(x / cellW)));
        const row = Math.max(0, Math.min(2, Math.floor(y / cellH)));
        return plan.regions.grid[row][col];
    };
    for (const b of plan.belts) {
        const sectors = b.sectors;
        for (let i=0;i<sectors;i++) {
            const a0 = (i/sectors)*Math.PI*2; const a1 = ((i+1)/sectors)*Math.PI*2;
            const amid = (a0+a1)/2; const rmid = b.inner + b.width/2;
            const x = 2500 + Math.cos(amid)*rmid;
            const y = 2500 + Math.sin(amid)*rmid;
            const regionId = labelAt(x,y);
            await new Promise((resolve,reject)=>db.run(
                `INSERT INTO belt_sectors (sector_id, belt_key, sector_index, region_id, inner_radius, width, arc_start, arc_end, density, hazard)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [sectorId, b.id, i, regionId, b.inner, b.width, a0, a1, 'med', 'med'],
                (e)=> e?reject(e):resolve()
            ));
            const existing = await new Promise((resolve)=>db.get(
                `SELECT id FROM sector_objects WHERE sector_id = ? AND type = 'belt' AND JSON_EXTRACT(meta, '$.belt') = ? AND JSON_EXTRACT(meta, '$.sectorIndex') = ? LIMIT 1`,
                [sectorId, b.id, i], (e, r) => resolve(r)
            ));
            if (!existing) {
                const meta = JSON.stringify({ name: `Belt ${b.id}-${i}`, celestial:true, scannable:true, alwaysKnown:1, belt: b.id, sectorIndex: i });
                await new Promise((resolve,reject)=>db.run(
                    `INSERT INTO sector_objects (sector_id, type, celestial_type, x, y, owner_id, meta, radius)
                     VALUES (?, 'belt', 'belt', ?, ?, NULL, ?, 4)`,
                    [sectorId, Math.round(x), Math.round(y), meta],
                    (e)=> e?reject(e):resolve()
                ));
            }
        }
    }
    // Wormhole endpoints sketch: create endpoints only (no exact coords for MVP)
    for (let i=0;i<plan.wormholes.length;i++) {
        const w = plan.wormholes[i];
        const meta = JSON.stringify({ name: `${w.type}_wormhole_${i}`, stability: w.stability, alwaysKnown:1 });
        await new Promise((resolve,reject)=>db.run(
            `INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta) VALUES (?, 'wormhole', ?, ?, NULL, ?)`,
            [sectorId, 2400 + i*10, 2400 + i*10, meta],
            (e)=> e?reject(e):resolve()
        ));
    }

    // === LANE GENERATION: Ringway + spokes; second loop if C ≥80 ===
    try {
        const grid = plan.regions.grid;
        const health = plan.regions.health || { C:50 };
        const cellW = 5000/3, cellH = 5000/3;
        const labelAt = (x,y) => { const col=Math.max(0,Math.min(2,Math.floor(x/cellW))); const row=Math.max(0,Math.min(2,Math.floor(y/cellH))); return grid[row][col]; };
        const majorityRegion = (poly) => { const c={A:0,B:0,C:0}; for (const p of poly) { const l=labelAt(p.x,p.y); c[l]=(c[l]||0)+1; } return ['A','B','C'].reduce((a,b)=>c[b]>c[a]?b:a,'A'); };
        const point = (x,y)=>({ x: Math.round(x), y: Math.round(y) });
        const insertEdge = async ({ cls, polyline, stats }) => {
            const regionId = majorityRegion(polyline);
            const edgeId = await new Promise((resolve, reject)=>db.run(
                `INSERT INTO lane_edges (sector_id, cls, region_id, polyline_json, width_core, width_shoulder, lane_speed, cap_base, headway, mass_limit, window_json, permits_json, protection_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
                [sectorId, cls, regionId, JSON.stringify(polyline), stats.width_core, stats.width_shoulder, stats.lane_speed, stats.cap_base, stats.headway, stats.mass_limit],
                function(e){ return e?reject(e):resolve(this.lastID); }
            ));
            await new Promise((resolve)=>db.run('INSERT OR REPLACE INTO lane_edges_runtime (edge_id, load_cu) VALUES (?, 0)', [edgeId], ()=>resolve()));
            return edgeId;
        };
        const insertTap = async (edgeId, x, y, poiId=null) => {
            await new Promise((resolve)=>db.run(`INSERT INTO lane_taps (edge_id, x, y, poi_object_id, side) VALUES (?, ?, ?, ?, NULL)`, [edgeId, Math.round(x), Math.round(y), poiId||null], ()=>resolve()));
        };
        const nearestIndexToPoint = (poly, qx, qy) => { let best=0,bd=Infinity; for (let i=0;i<poly.length;i++){ const p=poly[i]; const d=(p.x-qx)*(p.x-qx)+(p.y-qy)*(p.y-qy); if(d<bd){bd=d;best=i;} } return best; };

        // Ringway
        const cx=2500, cy=2500; const r1=1800; const steps=18; const ring=[];
        for (let i=0;i<steps;i++){ const a=(i/steps)*Math.PI*2; ring.push(point(cx+Math.cos(a)*r1, cy+Math.sin(a)*r1)); }
        const trunkStats = { width_core:190, width_shoulder:260, lane_speed:4.2, cap_base:6, headway:40, mass_limit:'medium' };
        const ringId = await insertEdge({ cls:'trunk', polyline: ring, stats: trunkStats });
        // Cardinal taps
        for (const i of [0, Math.floor(steps/4), Math.floor(steps/2), Math.floor(steps*3/4)]) await insertTap(ringId, ring[i].x, ring[i].y, null);
        // POI taps (wormholes/planets closest to ring points)
        const pois = await new Promise((resolve)=>db.all(`SELECT id, x, y FROM sector_objects WHERE sector_id = ? AND (celestial_type='planet' OR type='wormhole')`, [sectorId], (e,rows)=>resolve(rows||[])));
        const used = new Set();
        for (const poi of pois.slice(0,6)) { const idx = nearestIndexToPoint(ring, poi.x, poi.y); if (used.has(idx)) continue; used.add(idx); await insertTap(ringId, ring[idx].x, ring[idx].y, poi.id); }

        // Spokes 2–3 to nearest POIs
        for (const poi of pois.slice(0,3)) {
            const idx = nearestIndexToPoint(ring, poi.x, poi.y);
            const near = ring[idx];
            const spoke = [ point(near.x, near.y), point(poi.x, poi.y) ];
            const spokeStats = { width_core:160, width_shoulder:220, lane_speed:3.6, cap_base:5, headway:40, mass_limit:'light' };
            const sId = await insertEdge({ cls:'arterial', polyline: spoke, stats: spokeStats });
            await insertTap(sId, near.x, near.y, null);
            await insertTap(sId, poi.x, poi.y, poi.id);
        }

        // Second loop if C health ≥80
        if (Number(health.C||0) >= 80) {
            const r2 = r1 + 260; const ring2=[];
            for (let i=0;i<steps;i++){ const a=(i/steps)*Math.PI*2; ring2.push(point(cx+Math.cos(a)*r2, cy+Math.sin(a)*r2)); }
            const ring2Id = await insertEdge({ cls:'trunk', polyline: ring2, stats: trunkStats });
            for (const i of [Math.floor(steps/8), Math.floor(steps*3/8), Math.floor(steps*5/8), Math.floor(steps*7/8)]) await insertTap(ring2Id, ring2[i].x, ring2[i].y, null);
        }
    } catch (e) { console.warn('Lane generation (Wormhole) failed:', e?.message || e); }
}

module.exports = { plan, persist, MINERALS, DISPLAY };


