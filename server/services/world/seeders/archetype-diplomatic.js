// Diplomatic Expanse — “Auric Courts” STUB
const { randInt, randFloat, choice } = require('../rng');

const MINERALS = {
    primary: ['Aurivex','Auralite'],
    secondary: ['Luminite','Aetherium','Mythrion','Quarzon','Heliox Ore']
};

const DISPLAY = { name:'Diplomatic Expanse', 
    description:'Auric courts; arbitration corridors and permits.' 
};

function plan({ sectorId, seed, rng }) {
    const regions = { grid: [['C','B','B'],['A','C','B'],['A','C','B']], health: { A: 55, B: 55, C: 60 } };
    const sun = { x:2500, y:2500 };
    const planets=[]; const n=choice(rng,[5,6]); for(let i=0;i<n;i++){ const r=randInt(rng,700,2100); const a=randFloat(rng,0,Math.PI*2); planets.push({id:`P${i}`,x:2500+Math.cos(a)*r,y:2500+Math.sin(a)*r}); }
    const belts=[];
    return { regions, sun, planets, belts };
}

async function persist({ sectorId, plan, db }) {
    const cells=[]; for(let r=0;r<3;r++) for(let c=0;c<3;c++) cells.push({row:r,col:c,label:plan.regions.grid[r][c]});
    for(const id of Array.from(new Set(cells.map(c=>c.label)))){ const cellsJson=JSON.stringify(cells.filter(c=>c.label===id).map(c=>({row:c.row,col:c.col}))); await new Promise((resolve)=>db.run('INSERT OR REPLACE INTO regions (sector_id, region_id, cells_json, health) VALUES (?,?,?,?)',[sectorId,id,cellsJson,plan.regions.health[id]||55],()=>resolve())); }
    const metaSun=JSON.stringify({name:'Court Star', celestial:true, alwaysKnown:1});
    await new Promise((resolve)=>db.run(`INSERT INTO sector_objects (sector_id,type,celestial_type,x,y,owner_id,meta,radius) VALUES (?, 'sun','star', ?, ?, NULL, ?, 30)`,[sectorId,plan.sun.x,plan.sun.y,metaSun],()=>resolve()));
    for(const p of plan.planets){ const meta=JSON.stringify({name:p.id,celestial:true,scannable:true,alwaysKnown:1}); await new Promise((resolve)=>db.run(`INSERT INTO sector_objects (sector_id,type,celestial_type,x,y,owner_id,meta,radius) VALUES (?, 'planet','planet', ?, ?, NULL, ?, 12)`,[sectorId,Math.round(p.x),Math.round(p.y),meta],()=>resolve())); }
}

module.exports = { plan, persist, MINERALS, DISPLAY };


