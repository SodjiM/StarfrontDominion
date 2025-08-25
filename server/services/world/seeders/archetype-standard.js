const { randInt, randFloat, choice } = require('../rng');

function plan({ sectorId, seed, rng }) {
    const grid = [['A','C','A'], ['C','C','C'], ['A','C','A']];
    const regions = { grid, health: { A:50, C:50 } };
    const sun = { type:'sun', x:2500, y:2500 };
    const planets = [];
    const n = randInt(rng, 5, 7);
    const bands = [[800,1400],[1500,2300],[2400,3800]];
    for (let i=0;i<n;i++) { const [rMin,rMax]=choice(rng,bands); const r=randInt(rng,rMin,rMax); const a=randFloat(rng,0,Math.PI*2); planets.push({id:`P${i}`, x:2500+Math.cos(a)*r, y:2500+Math.sin(a)*r}); }
    const belts = [{ id:'B0', inner: 1800, width: 300, sectors: 5 }];
    return { regions, sun, planets, belts };
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
        const moonCount = Math.random() < 0.6 ? 1 : 0; // occasional moon
        for (let m=0;m<moonCount;m++) {
            const dist = 18 + Math.floor(Math.random()*14);
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
    for (const b of plan.belts) {
        const sectors=b.sectors; for (let i=0;i<sectors;i++) {
            await new Promise((resolve,reject)=>db.run(
                `INSERT INTO belt_sectors (sector_id, belt_key, sector_index, region_id, inner_radius, width, arc_start, arc_end, density, hazard)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [sectorId, b.id, i, 'C', b.inner, b.width, (i/sectors)*Math.PI*2, ((i+1)/sectors)*Math.PI*2, 'med', 'low'],
                (e)=> e?reject(e):resolve()
            ));
            // Create belt centroid object for warp targeting
            const a0 = (i/sectors)*Math.PI*2; const a1 = ((i+1)/sectors)*Math.PI*2; const amid=(a0+a1)/2; const rmid=b.inner + b.width/2;
            const x = 2500 + Math.cos(amid)*rmid; const y = 2500 + Math.sin(amid)*rmid;
            const existing = await new Promise((resolve)=>db.get(
                `SELECT id FROM sector_objects WHERE sector_id = ? AND type = 'belt' AND JSON_EXTRACT(meta, '$.belt') = ? AND JSON_EXTRACT(meta, '$.sectorIndex') = ? LIMIT 1`,
                [sectorId, b.id, i], (e, r) => resolve(r)
            ));
            if (!existing) {
                const meta = JSON.stringify({ name:`Belt ${b.id}-${i}`, celestial:true, scannable:true, alwaysKnown:1, belt:b.id, sectorIndex:i });
                await new Promise((resolve,reject)=>db.run(
                    `INSERT INTO sector_objects (sector_id, type, celestial_type, x, y, owner_id, meta, radius)
                     VALUES (?, 'belt', 'belt', ?, ?, NULL, ?, 4)`,
                    [sectorId, Math.round(x), Math.round(y), meta],
                    (e)=> e?reject(e):resolve()
                ));
            }
        }
    }
}

module.exports = { plan, persist };


