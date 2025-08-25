// Binary Star System — “Duality & Tides” STUB
const { randInt, randFloat, choice } = require('../rng');

const MINERALS = {
    primary: ['Tachytrium','Oblivium'],
    secondary: ['Solarite','Pyronex','Auralite','Luminite','Quarzon']
};

const DISPLAY = {
    name: 'Binary Star System',
    description: 'Dual suns with tidal lanes and synchronized windows.'
};

function plan({ sectorId, seed, rng }) {
    // Simple two-sun + few planets stub
    const regions = { grid: [['A','A','B'],['A','B','B'],['A','C','B']], health: { A: 55, B: 55, C: 55 } };
    const suns = [ { x: 2400, y: 2500 }, { x: 2600, y: 2500 } ];
    const nPlanets = choice(rng, [4,5,6]);
    const planets = [];
    for (let i=0;i<nPlanets;i++) { const r = randInt(rng, 700, 2000); const a = randFloat(rng, 0, Math.PI*2); planets.push({ id:`P${i}`, x:2500+Math.cos(a)*r, y:2500+Math.sin(a)*r }); }
    const belts = [];
    return { regions, suns, planets, belts };
}

async function persist({ sectorId, plan, db }) {
    // Regions
    const cells = []; for (let r=0;r<3;r++) for (let c=0;c<3;c++) cells.push({row:r,col:c,label:plan.regions.grid[r][c]});
    for (const id of Array.from(new Set(cells.map(c=>c.label)))) {
        const cellsJson = JSON.stringify(cells.filter(c=>c.label===id).map(c=>({row:c.row,col:c.col})));
        await new Promise((resolve)=>db.run('INSERT OR REPLACE INTO regions (sector_id, region_id, cells_json, health) VALUES (?,?,?,?)',[sectorId,id,cellsJson,plan.regions.health[id]||55],()=>resolve()));
    }
    // Two suns
    const sunMeta = s=>JSON.stringify({ name:'Binary Sun', celestial:true, alwaysKnown:1 });
    for (const s of plan.suns) {
        await new Promise((resolve)=>db.run(`INSERT INTO sector_objects (sector_id, type, celestial_type, x, y, owner_id, meta, radius) VALUES (?, 'sun', 'star', ?, ?, NULL, ?, 26)`,[sectorId,s.x,s.y,sunMeta(s)],()=>resolve()));
    }
    // Planets
    for (const p of plan.planets) {
        const meta = JSON.stringify({ name:p.id, celestial:true, scannable:true, alwaysKnown:1 });
        await new Promise((resolve)=>db.run(`INSERT INTO sector_objects (sector_id, type, celestial_type, x, y, owner_id, meta, radius) VALUES (?, 'planet', 'planet', ?, ?, NULL, ?, 12)`,[sectorId,Math.round(p.x),Math.round(p.y),meta],()=>resolve()));
    }
}

module.exports = { plan, persist, MINERALS, DISPLAY };


