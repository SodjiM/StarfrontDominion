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

    // === LANE GENERATION: Diplomatic C-spine + B arterials ===
    try {
        const cellW = 5000/3, cellH = 5000/3;
        const grid = plan.regions.grid;
        const health = plan.regions.health || { A:55, B:55, C:60 };
        const labelAt = (x,y) => {
            const col = Math.max(0, Math.min(2, Math.floor(x / cellW)));
            const row = Math.max(0, Math.min(2, Math.floor(y / cellH)));
            return grid[row][col];
        };
        const majorityRegion = (poly) => {
            const counts = { A:0,B:0,C:0 };
            for (const p of poly) counts[labelAt(p.x,p.y)] = (counts[labelAt(p.x,p.y)]||0)+1;
            return ['A','B','C'].reduce((a,b)=>counts[b]>counts[a]?b:a,'A');
        };
        const insertEdge = async ({ cls, polyline, stats, permits=null, protection=null }) => {
            const regionId = majorityRegion(polyline);
            const polylineJson = JSON.stringify(polyline);
            const permitsJson = permits ? JSON.stringify(permits) : null;
            const protectionJson = protection ? JSON.stringify(protection) : null;
            const edgeId = await new Promise((resolve, reject)=>db.run(
                `INSERT INTO lane_edges (sector_id, cls, region_id, polyline_json, width_core, width_shoulder, lane_speed, cap_base, headway, mass_limit, window_json, permits_json, protection_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
                [sectorId, cls, regionId, polylineJson, stats.width_core, stats.width_shoulder, stats.lane_speed, stats.cap_base, stats.headway, stats.mass_limit, permitsJson, protectionJson],
                function(e){ return e?reject(e):resolve(this.lastID); }
            ));
            await new Promise((resolve)=>db.run('INSERT OR REPLACE INTO lane_edges_runtime (edge_id, load_cu) VALUES (?, 0)', [edgeId], ()=>resolve()));
            return edgeId;
        };
        const insertTap = async (edgeId, x, y, poiId=null) => {
            await new Promise((resolve)=>db.run(`INSERT INTO lane_taps (edge_id, x, y, poi_object_id, side) VALUES (?, ?, ?, ?, NULL)`, [edgeId, Math.round(x), Math.round(y), poiId||null], ()=>resolve()));
        };
        const point = (x,y) => ({ x: Math.round(x), y: Math.round(y) });

        // 1) C-spine trunk across y=2500
        const y = 2500;
        const spine = [point(600,y), point(1300,y), point(2500,y), point(3700,y), point(4400,y)];
        const permits = { reservedPct: 0.30, tiers: ['com','mil'] };
        const protection = (health.C >= 60) ? { arbitration: true, coreAcquireBonus: 0.6, coreTackleBonus: 0.7 } : null;
        const trunkStats = { width_core:200, width_shoulder:280, lane_speed:4.6, cap_base:7, headway:38, mass_limit:'heavy' };
        const trunkId = await insertEdge({ cls:'trunk', polyline: spine, stats: trunkStats, permits, protection });

        // taps at ends and center
        for (const p of [spine[0], spine[2], spine[spine.length-1]]) await insertTap(trunkId, p.x, p.y, null);
        // region boundary taps at ~1/3 and ~2/3
        for (const p of [point(cellW, y), point(cellW*2, y)]) await insertTap(trunkId, p.x, p.y, null);
        // extra tap when C ≥80 (near 0.25/0.75)
        if (health.C >= 80) {
            const x1 = Math.round(600 + (4400-600)*0.25), x2 = Math.round(600 + (4400-600)*0.75);
            await insertTap(trunkId, x1, y, null);
            await insertTap(trunkId, x2, y, null);
        }

        // 2) B arterials (up to 2) from B-region planets to the spine
        const bPlanets = plan.planets.filter(p => labelAt(p.x, p.y) === 'B').slice(0,2);
        for (const p of bPlanets) {
            // simple 3-point curve toward the spine
            const mid = point((p.x*2 + 2500)/3, (p.y*2 + y)/3);
            const end = point(p.x < 2500 ? 1300 : 3700, y);
            const arterial = [ point(p.x, p.y), mid, end ];
            const arterialStats = { width_core:160, width_shoulder:220, lane_speed:3.8, cap_base:5, headway:40, mass_limit:'medium' };
            const aId = await insertEdge({ cls:'arterial', polyline: arterial, stats: arterialStats, permits: null, protection: null });
            await insertTap(aId, p.x, p.y, null);
            await insertTap(aId, end.x, end.y, null);
        }
    } catch (e) {
        console.warn('Lane generation (Diplomatic) failed:', e?.message || e);
    }
}

module.exports = { plan, persist, MINERALS, DISPLAY };


