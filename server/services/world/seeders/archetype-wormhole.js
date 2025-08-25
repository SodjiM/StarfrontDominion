const { randInt, randFloat, choice } = require('../rng');

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
    console.log(`🌌 [Seed] Persisting Wormhole Cluster for sector ${sectorId} with ${plan.planets.length} planets and ${plan.belts.length} belts; wormholes=${plan.wormholes.length}`);
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
        console.log(`🛰️ [Seed] Belt ${b.id}: inner=${b.inner} width=${b.width} sectors=${sectors}`);
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
            console.log(`   ↳ sector ${i} centroid=(${Math.round(x)},${Math.round(y)}) region=${regionId}`);
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
}

module.exports = { plan, persist };


