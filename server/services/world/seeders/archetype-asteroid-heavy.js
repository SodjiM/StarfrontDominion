const { randInt, randFloat, choice } = require('../rng');

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
    console.log(`🌌 [Seed] Persisting Asteroid-Heavy for sector ${sectorId} with ${plan.planets.length} planets and ${plan.belts.length} belts`);
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
    for (const b of plan.belts) {
        const sectors = b.sectors; const inner=b.inner; const width=b.width;
        console.log(`🛰️ [Seed] Belt ${b.id}: inner=${inner} width=${width} sectors=${sectors}`);
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
            console.log(`   ↳ sector ${i} centroid=(${Math.round(x)},${Math.round(y)}) region=${regionId}`);
        }
    }
    // Lanes minimal stub: none persisted for MVP
}

module.exports = { plan, persist };


