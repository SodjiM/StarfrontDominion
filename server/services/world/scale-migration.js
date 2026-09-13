const nav=require('../../utils/navigation');
const {query,run,clearResourceOverlaps,validateBodies}=require('./physical-placement');
const {repairLaneClearance}=require('./lane-clearance');
const celestial=require('../../../client/render/celestial-types');
const {VERSION}=nav.scale;

function planMigration(source) {
    const objects=source.map(o=>({...o,meta:{...nav.scale.metaOf(o)}}));
    const old=new Map(source.map(o=>[o.id,o]));
    const stars=objects.filter(o=>['star','sun'].includes(o.celestial_type||o.type)).sort((a,b)=>a.id-b.id);
    const center=stars.length?{x:stars.reduce((s,o)=>s+o.x,0)/stars.length,y:stars.reduce((s,o)=>s+o.y,0)/stars.length}:{x:2500,y:2500};
    const planets=objects.filter(o=>(o.celestial_type||o.type)==='planet').sort((a,b)=>(a.meta.orbitalRing??a.id)-(b.meta.orbitalRing??b.id));
    const placed=[],rings=[];
    for(let i=0;i<stars.length;i++) {
        Object.assign(stars[i],{x:Math.round(center.x+(i-(stars.length-1)/2)*420),y:Math.round(center.y),radius:140});
        placed.push(stars[i]);
    }
    let orbit=stars.length>1?700:550, previousEnvelope=0;
    for(let i=0;i<planets.length;i++) {
        const p=planets[i],style=celestial.resolve(p),giant=style.key==='gasGiant';
        p.radius=giant?60:30;
        const moons=objects.filter(o=>(o.celestial_type||o.type)==='moon'&&o.parent_object_id===p.id).sort((a,b)=>a.id-b.id);
        // Compact legacy systems retain every planet. Satellite radii still satisfy surface clearance.
        const distance=giant?(planets.length>5?100:130):80;
        const envelope=Math.max(p.radius+30,moons.length?distance+9:0);
        if(i)orbit+=Math.max(planets.length>5?0:400,previousEnvelope+envelope+60);
        previousEnvelope=envelope;
        const angle=Number.isFinite(p.meta.orbitAngle)?p.meta.orbitAngle:Math.atan2(p.y-center.y,p.x-center.x);
        Object.assign(p,{x:Math.round(center.x+Math.cos(angle)*orbit),y:Math.round(center.y+Math.sin(angle)*orbit)});
        Object.assign(p.meta,{orbitRadius:orbit,orbitAngle:angle,orbitalRing:i,satelliteEnvelope:envelope});
        if(center.x-orbit-envelope<100||center.y-orbit-envelope<100||center.x+orbit+envelope>4899||center.y+orbit+envelope>4899)throw new Error('legacy_system_envelopes_do_not_fit');
        placed.push(p);
        const phase=moons[0]?.meta.orbitAngle||0;
        for(let j=0;j<moons.length;j++) {
            const m=moons[j],a=phase+j*Math.PI*2/moons.length;
            Object.assign(m,{radius:9,x:Math.round(p.x+Math.cos(a)*distance),y:Math.round(p.y+Math.sin(a)*distance)});
            Object.assign(m.meta,{orbitRadius:distance,orbitAngle:a}); placed.push(m);
        }
        rings.push({index:i,centerX:Math.round(center.x),centerY:Math.round(center.y),radius:orbit,planetId:p.id});
    }
    const handled=new Set(placed.map(o=>o.id));
    // Preserve outposts, gates, resources, and ships; relocate only as needed for clearance.
    const remaining=objects.filter(o=>!handled.has(o.id)).sort((a,b)=>(a.type==='ship')-(b.type==='ship')||a.id-b.id);
    for(const obj of remaining) {
        if(!nav.scale.isSolid(obj)){placed.push(obj);continue;}
        const host=placed.find(o=>o.id===obj.parent_object_id&&nav.scale.isDisk(o));
        let origin={x:obj.x,y:obj.y},minRadius=0;
        if(host&&['station','starbase'].includes(obj.type)) {
            origin=host; minRadius=Math.ceil(nav.scale.anchorDistance(host,obj));
        } else if(obj.type==='ship') {
            const station=placed.filter(o=>o.owner_id===obj.owner_id&&['station','starbase'].includes(o.type)).sort((a,b)=>Math.hypot(old.get(a.id).x-obj.x,old.get(a.id).y-obj.y)-Math.hypot(old.get(b.id).x-obj.x,old.get(b.id).y-obj.y))[0];
            if(station&&Math.hypot(old.get(station.id).x-obj.x,old.get(station.id).y-obj.y)<250) {
                origin={x:station.x+obj.x-old.get(station.id).x,y:station.y+obj.y-old.get(station.id).y};
            }
        }
        const point=nav.findPlacement(placed,obj,origin,{minRadius,maxRadius:minRadius+500,accept:p=>!host||!['station','starbase'].includes(obj.type)||Math.hypot(p.x-host.x,p.y-host.y)>=nav.scale.anchorDistance(host,obj)});
        if(!point)throw new Error(`no_migration_placement:${obj.id}`);
        Object.assign(obj,point);placed.push(obj);
    }
    for(let i=0;i<placed.length;i++) {
        const obj=placed[i];obj.meta.scaleVersion=VERSION;
        if(obj.owner_id)obj.meta.scaleMigrationNotice='System scale upgraded. Travel orders were cancelled; re-plan from your new position.';
        if(nav.scale.isSolid(obj)) {
            if(!nav.scale.inBounds(obj))throw new Error(`migration_bounds:${obj.id}`);
            for(let j=0;j<i;j++)if(nav.scale.isSolid(placed[j])&&nav.scale.overlaps(obj,placed[j]))throw new Error(`migration_overlap:${obj.id}:${placed[j].id}`);
        }
    }
    return {objects:placed,rings,moved:placed.filter(o=>o.x!==old.get(o.id).x||o.y!==old.get(o.id).y).length};
}

async function migrateScales(db,{dryRun=false,backupPath}={}) {
    const sectors=await query(db,"SELECT s.* FROM sectors s WHERE EXISTS (SELECT 1 FROM sector_objects o WHERE o.sector_id=s.id AND o.celestial_type IN ('star','sun')) ORDER BY s.id");
    const pending=[];
    for(const sector of sectors) {
        const objects=await query(db,'SELECT * FROM sector_objects WHERE sector_id=? ORDER BY id',[sector.id]);
        if(objects.every(o=>nav.scale.metaOf(o).scaleVersion===VERSION))continue;
        // Generated celestial metadata is the version marker; freshly built units need no migration.
        const bodies=objects.filter(nav.scale.isDisk);
        if(bodies.length&&bodies.every(o=>nav.scale.metaOf(o).scaleVersion===VERSION))continue;
        pending.push({sector,plan:planMigration(objects)});
    }
    if(!pending.length)return [];
    if(dryRun)return pending.map(({sector,plan})=>({sectorId:sector.id,objects:plan.objects.length,moved:plan.moved,planets:plan.rings.length}));
    if(backupPath)await run(db,'VACUUM INTO ?',[backupPath]);
    await run(db,'BEGIN IMMEDIATE');
    try {
        await run(db,'CREATE TABLE IF NOT EXISTS scale_migrations (sector_id INTEGER PRIMARY KEY,version TEXT NOT NULL,report_json TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
        for(const {sector,plan} of pending) {
            for(const obj of plan.objects)await run(db,'UPDATE sector_objects SET x=?,y=?,radius=?,meta=? WHERE id=?',[obj.x,obj.y,obj.radius||1,JSON.stringify(obj.meta),obj.id]);
            await run(db,'DELETE FROM orbital_rings WHERE sector_id=?',[sector.id]);
            for(const ring of plan.rings)await run(db,'INSERT INTO orbital_rings(sector_id,ring_index,center_x,center_y,radius,width,planet_object_id) VALUES(?,?,?,?,?,40,?)',[sector.id,ring.index,ring.centerX,ring.centerY,ring.radius,ring.planetId]);
            await clearResourceOverlaps(db,sector.id);
            await repairLaneClearance(db,sector.id);
            // Old lane distances and coordinate orders cannot retain their original meaning.
            const reason='System scale upgraded: positions and lane geometry changed. Re-plan travel from the new position.';
            await run(db,"UPDATE movement_orders SET status='cancelled',blocked_by=? WHERE object_id IN (SELECT id FROM sector_objects WHERE sector_id=?) AND status IN ('active','blocked','warp_preparing')",[JSON.stringify({reason}),sector.id]);
            await run(db,"UPDATE queued_orders SET status='cancelled',status_reason=? WHERE ship_id IN (SELECT id FROM sector_objects WHERE sector_id=?) AND status IN ('queued','waiting','running')",[reason,sector.id]);
            await run(db,"UPDATE lane_itineraries SET status='cancelled',meta=? WHERE sector_id=? AND status='active'",[JSON.stringify({reason}),sector.id]);
            await run(db,'DELETE FROM lane_transits WHERE ship_id IN (SELECT id FROM sector_objects WHERE sector_id=?)',[sector.id]);
            await run(db,"UPDATE lane_tap_queue SET status='cancelled' WHERE ship_id IN (SELECT id FROM sector_objects WHERE sector_id=?) AND status='queued'",[sector.id]);
            await run(db,"UPDATE harvesting_tasks SET status='paused' WHERE ship_id IN (SELECT id FROM sector_objects WHERE sector_id=?)",[sector.id]);
            await run(db,'DELETE FROM object_visibility WHERE sector_id=?',[sector.id]);
            await validateBodies(db,sector.id);
            await run(db,'INSERT OR REPLACE INTO scale_migrations(sector_id,version,report_json) VALUES(?,?,?)',[sector.id,VERSION,JSON.stringify({moved:plan.moved,reason,backupPath:backupPath||null})]);
            await run(db,"UPDATE generation_manifests SET generator_version=?,manifest_json=json_set(manifest_json,'$.scaleMigration',?),updated_at=CURRENT_TIMESTAMP WHERE sector_id=?",[VERSION,reason,sector.id]);
        }
        await run(db,'UPDATE lane_edges_runtime SET load_cu=COALESCE((SELECT SUM(cu) FROM lane_transits WHERE edge_id=lane_edges_runtime.edge_id),0)');
        await run(db,'COMMIT');
    } catch(e){await run(db,'ROLLBACK');throw e;}
    return pending.map(({sector,plan})=>({sectorId:sector.id,moved:plan.moved}));
}
module.exports={planMigration,migrateScales};
