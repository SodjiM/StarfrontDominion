const { randInt, randFloat, choice } = require('../rng');

// Minerals for Asteroid-Heavy Belt — “Rubble & Riches”
// Primary: Quarzon, Mythrion; Secondary: Magnetrine, Starforged Carbon, Fluxium, Heliox Ore, Aetherium
const MINERALS = {
    primary: ['Quarzon','Mythrion'],
    secondary: ['Magnetrine','Starforged Carbon','Fluxium','Heliox Ore','Aetherium']
};

const DISPLAY = {
    name: 'Asteroid-Heavy Belt',
    description: 'Dense rubble fields and foundry riches along the belts.'
};

function plan({ sectorId, seed, rng }) {
    // Regions AAB / AC B / ABB pattern
    const base = [['A','A','B'], ['A','C','B'], ['A','B','B']];
    const turns = randInt(rng, 0, 3);
    let grid = base.map(r => r.slice());
    for (let t=0;t<turns;t++){ const n=3; const r=Array.from({length:n},()=>Array(n)); for(let i=0;i<n;i++) for(let j=0;j<n;j++) r[j][n-1-i]=grid[i][j]; grid=r; }
    if (rng() < 0.5) grid = grid.map(row => row.slice().reverse());
    if (rng() >= 0.6) { // 40% no C
        for (let i=0;i<3;i++) for (let j=0;j<3;j++) if (grid[i][j]==='C') grid[i][j] = (rng()<0.5?'A':'B');
    }
    const regions = { grid, health: { A: randInt(rng,48,56), B: randInt(rng,50,58), C: 50 } };

    const sun = { type:'sun', x:2500, y:2500 };
    const nPlanets = choice(rng, [5,6,7]);
    const planets = [];
    const bands = [[700,1200],[1400,2200],[2400,3800]];
    for (let i=0;i<nPlanets;i++) {
        const [rMin, rMax] = choice(rng, bands);
        const r = randInt(rng, rMin, rMax); const a = randFloat(rng, 0, Math.PI*2);
        planets.push({ id:`P${i}`, x:2500+Math.cos(a)*r, y:2500+Math.sin(a)*r, moons:[] });
    }
    // Belts 2..3
    const belts = []; const count = randInt(rng,2,3);
    for (let i=0;i<count;i++) {
        const width = randInt(rng,220,420);
        const sectors = width>320 ? randInt(rng,6,9) : randInt(rng,4,7);
        belts.push({ id:`B${i}`, inner: randInt(rng,1300,2200), width, sectors });
    }
    // Lanes sketch: trunk along densest belt
    const lanes = [{ cls:'trunk', width_core:190, width_shoulder:260, lane_speed:4.2, cap_base:6, headway:40, mass_limit:'heavy' }];
    return { regions, sun, planets, belts, lanes };
}

async function persist({ sectorId, plan, db }) {
    const { grid, health } = plan.regions;
    const cells = []; for (let r=0;r<3;r++) for (let c=0;c<3;c++) cells.push({row:r,col:c,label:grid[r][c]});
    const regionIds = Array.from(new Set(cells.map(c=>c.label)));
    for (const id of regionIds) {
        const cellsJson = JSON.stringify(cells.filter(c=>c.label===id).map(c=>({row:c.row,col:c.col})));
        await new Promise((resolve,reject)=>db.run(
            'INSERT OR REPLACE INTO regions (sector_id, region_id, cells_json, health) VALUES (?, ?, ?, ?)',
            [sectorId, id, cellsJson, (health[id] ?? 50)],
            (e)=> e?reject(e):resolve()
        ));
    }
    const sunMeta = JSON.stringify({ name:'Primary Star', celestial:true, alwaysKnown:1 });
    const sunId = await new Promise((resolve,reject)=>db.run(
        `INSERT INTO sector_objects (sector_id, type, celestial_type, x, y, owner_id, meta, radius)
         VALUES (?, 'sun', 'star', ?, ?, NULL, ?, 30)`,
        [sectorId, plan.sun.x, plan.sun.y, sunMeta], function(err){ return err?reject(err):resolve(this.lastID); }
    ));
    for (const p of plan.planets) {
        const meta = JSON.stringify({ name:p.id, celestial:true, scannable:true, alwaysKnown:1 });
        const planetId = await new Promise((resolve,reject)=>db.run(
            `INSERT INTO sector_objects (sector_id, type, celestial_type, x, y, owner_id, meta, radius, parent_object_id)
             VALUES (?, 'planet', 'planet', ?, ?, NULL, ?, 12, ?)`,
            [sectorId, Math.round(p.x), Math.round(p.y), meta, sunId],
            function(e){ return e?reject(e):resolve(this.lastID); }
        ));
        // Moons 0..2
        const moonCount = randInt(Math.random, 0, 3);
        for (let m=0;m<moonCount;m++) {
            const dist = randInt(Math.random, 18, 35);
            const ang = randFloat(Math.random, 0, Math.PI*2);
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
    // Belt sectors: map to region by centroid
    const cellW = 5000/3, cellH = 5000/3;
    const labelAt = (x,y, grid) => {
        const col = Math.max(0, Math.min(2, Math.floor(x / cellW)));
        const row = Math.max(0, Math.min(2, Math.floor(y / cellH)));
        return grid[row][col];
    };
    const highDensityCountsByBelt = new Map();
    for (const b of plan.belts) {
        const sectors = b.sectors; const inner=b.inner; const width=b.width;
        for (let i=0;i<sectors;i++) {
            const a0 = (i/sectors)*Math.PI*2; const a1 = ((i+1)/sectors)*Math.PI*2;
            const amid = (a0+a1)/2; const rmid = inner + width/2;
            const x = 2500 + Math.cos(amid)*rmid; const y = 2500 + Math.sin(amid)*rmid;
            const regionId = labelAt(x,y, plan.regions.grid);
            await new Promise((resolve,reject)=>db.run(
                `INSERT INTO belt_sectors (sector_id, belt_key, sector_index, region_id, inner_radius, width, arc_start, arc_end, density, hazard)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [sectorId, b.id, i, regionId, inner, width, a0, a1, (regionId==='A'?'high':'med'), (regionId==='A'?'med':'low')],
                (e)=> e?reject(e):resolve()
            ));
            if (regionId === 'A') {
                highDensityCountsByBelt.set(b.id, (highDensityCountsByBelt.get(b.id) || 0) + 1);
            }
            // Create belt centroid POI for warp targeting
            // Avoid duplicate centroid objects if seeding runs twice
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
    // --- Lane generation (Asteroid-Heavy archetype-specific) ---
    // Heuristics: pick densest belt (by count of 'A' region sectors) for trunk; add 1–2 arterials to central planet.
    try {
        // Fetch belt centroid POIs and planets for tap placement and arterial anchors
        const beltPOIs = await new Promise((resolve)=>db.all(
            `SELECT id, x, y, meta FROM sector_objects WHERE sector_id = ? AND type = 'belt'`,
            [sectorId], (e, rows) => resolve(rows || [])
        ));
        const planetsPOIs = await new Promise((resolve)=>db.all(
            `SELECT id, x, y, meta FROM sector_objects WHERE sector_id = ? AND celestial_type = 'planet'`,
            [sectorId], (e, rows) => resolve(rows || [])
        ));

        function parseMeta(m){ try { return JSON.parse(m || '{}'); } catch { return {}; } }
        const center = { x: 2500, y: 2500 };
        const anchorPlanet = planetsPOIs.reduce((best, p) => {
            const d = (p.x-center.x)*(p.x-center.x)+(p.y-center.y)*(p.y-center.y);
            return (!best || d < best.d) ? { p, d } : best;
        }, null)?.p || planetsPOIs[0];

        // Pick densest belt id
        let trunkBeltId = null; let maxHigh = -1;
        for (const b of plan.belts) {
            const c = highDensityCountsByBelt.get(b.id) || 0;
            if (c > maxHigh) { maxHigh = c; trunkBeltId = b.id; }
        }
        if (!trunkBeltId && plan.belts.length) trunkBeltId = plan.belts[0].id;

        // Build trunk polyline along the chosen belt: sample evenly around the ring following belt POIs order
        const trunkPoints = [];
        const trunkPOIs = (beltPOIs || []).filter(b=>parseMeta(b.meta).belt===trunkBeltId)
            .sort((a,b)=>{
                const aa = Math.atan2(a.y-center.y, a.x-center.x);
                const bb = Math.atan2(b.y-center.y, b.x-center.x);
                return aa-bb;
            });
        const sampleEvery = Math.max(1, Math.floor(trunkPOIs.length / 12));
        for (let i=0;i<trunkPOIs.length;i+=sampleEvery) trunkPoints.push({ x: trunkPOIs[i].x, y: trunkPOIs[i].y });
        if (trunkPoints.length >= 3) {
            // Close minor gaps by ensuring last != first
            if (Math.hypot(trunkPoints[0].x - trunkPoints[trunkPoints.length-1].x, trunkPoints[0].y - trunkPoints[trunkPoints.length-1].y) > 400) {
                trunkPoints.push({ x: trunkPoints[0].x, y: trunkPoints[0].y });
            }
        }
        const majorityRegion = (pts) => {
            const counts = { A:0, B:0, C:0 };
            for (const pt of pts) { const id = labelAt(pt.x, pt.y, plan.regions.grid); counts[id] = (counts[id]||0)+1; }
            return (['A','B','C'].reduce((a,b)=> counts[b] > counts[a] ? b : a, 'A'));
        };

        async function insertLaneEdge({ cls, points, width_core, width_shoulder, lane_speed, cap_base, headway, mass_limit }) {
            if (!points || points.length < 2) return null;
            const polylineJson = JSON.stringify(points);
            const region_id = majorityRegion(points);
            const edgeId = await new Promise((resolve, reject)=>db.run(
                `INSERT INTO lane_edges (sector_id, cls, region_id, polyline_json, width_core, width_shoulder, lane_speed, cap_base, headway, mass_limit, window_json, permits_json, protection_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
                [sectorId, cls, region_id, polylineJson, 190, 260, 4.2, 6, 40, 'heavy'],
                function(e){ return e?reject(e):resolve(this.lastID); }
            ));
            await new Promise((resolve)=>db.run(`INSERT OR REPLACE INTO lane_edges_runtime (edge_id, load_cu) VALUES (?, 0)`, [edgeId], ()=>resolve()));
            return edgeId;
        }

        async function insertTap(edgeId, x, y, poiId=null) {
            await new Promise((resolve)=>db.run(
                `INSERT INTO lane_taps (edge_id, x, y, poi_object_id, side) VALUES (?, ?, ?, ?, NULL)`,
                [edgeId, Math.round(x), Math.round(y), poiId || null], ()=>resolve()
            ));
        }

        function cumulativeDistance(points){ let d=0; const acc=[0]; for(let i=1;i<points.length;i++){ d+=Math.hypot(points[i].x-points[i-1].x, points[i].y-points[i-1].y); acc.push(d);} return { total:d, acc }; }
        function pointAtDistance(points, acc, dist){ if (dist<=0) return points[0]; const total=acc[acc.length-1]; if (dist>=total) return points[points.length-1]; let i=1; while (i<acc.length && acc[i]<dist) i++; const t=(dist-acc[i-1])/Math.max(1e-6,(acc[i]-acc[i-1])); return { x: points[i-1].x+(points[i].x-points[i-1].x)*t, y: points[i-1].y+(points[i].y-points[i-1].y)*t } }

        // Insert trunk edge
        let trunkEdgeId = null;
        if (trunkPoints.length >= 2) {
            trunkEdgeId = await insertLaneEdge({ cls:'trunk', points: trunkPoints, width_core:190, width_shoulder:260, lane_speed:4.2, cap_base:6, headway:40, mass_limit:'heavy' });
            // Place taps every ~1000 tiles
            const cd = cumulativeDistance(trunkPoints);
            const interval = 1000; const tapsCount = Math.max(2, Math.floor(cd.total / interval));
            for (let i=1;i<=tapsCount;i++) { const p = pointAtDistance(trunkPoints, cd.acc, i*interval); await insertTap(trunkEdgeId, p.x, p.y, null); }
            // Taps at nearby belt POIs
            for (const b of trunkPOIs) { await insertTap(trunkEdgeId, b.x, b.y, b.id); }
        }

        // Build 1–2 arterials: from anchor planet to nearest trunk point(s)
        if (anchorPlanet && trunkPoints.length >= 2) {
            const nearest = trunkPoints.reduce((best, p)=>{ const d=Math.hypot(p.x-anchorPlanet.x, p.y-anchorPlanet.y); return (!best||d<best.d)?{p,d}:best; }, null).p;
            const mid = { x: (anchorPlanet.x*2 + nearest.x)/3, y: (anchorPlanet.y*2 + nearest.y)/3 }; // gentle curve
            const arterialPts = [ { x: anchorPlanet.x, y: anchorPlanet.y }, mid, { x: nearest.x, y: nearest.y } ];
            const arterialEdgeId = await insertLaneEdge({ cls:'arterial', points: arterialPts, width_core:160, width_shoulder:220, lane_speed:3.6, cap_base:5, headway:40, mass_limit:'medium' });
            if (arterialEdgeId) {
                await insertTap(arterialEdgeId, anchorPlanet.x, anchorPlanet.y, anchorPlanet.id);
                await insertTap(arterialEdgeId, nearest.x, nearest.y, null);
                // Optionally a mid tap
                await insertTap(arterialEdgeId, mid.x, mid.y, null);
            }
        }

    } catch (e) {
        // Lane generation error silently handled
    }
}

module.exports = { plan, persist, MINERALS, DISPLAY };


