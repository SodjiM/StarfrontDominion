const nav = require('../../utils/navigation');
const query=(db,sql,args=[])=>new Promise((r,j)=>db.all(sql,args,(e,v)=>e?j(e):r(v||[])));
const run=(db,sql,args=[])=>new Promise((r,j)=>db.run(sql,args,function(e){e?j(e):r(this)}));
async function physicalObjects(db,sectorId) {
    const objects=await query(db,'SELECT * FROM sector_objects WHERE sector_id=?',[sectorId]);
    const nodes=await query(db,'SELECT id,x,y FROM resource_nodes WHERE sector_id=? AND is_depleted=0',[sectorId]);
    return objects.concat(nodes.map(n=>({...n,id:`resource:${n.id}`,type:'resource_node'})));
}
async function placeNear(db,sectorId,mover,host,{anchored=false,maxRadius=100}={}) {
    const objects=await physicalObjects(db,sectorId);
    const minRadius=anchored?Math.ceil(nav.scale.anchorDistance(host,mover)):0;
    const point=nav.findPlacement(objects,mover,host,{minRadius,maxRadius:minRadius+maxRadius,
        accept:p=>anchored?Math.hypot(p.x-host.x,p.y-host.y)>=nav.scale.anchorDistance(host,mover):nav.scale.adjacent({...mover,...p},host)});
    if(!point)throw new Error('no_space_for_footprint');
    return point;
}
async function validateBodies(db,sectorId) {
    const objects=await query(db,'SELECT * FROM sector_objects WHERE sector_id=?',[sectorId]);
    const solids=objects.filter(nav.scale.isSolid);
    for(let i=0;i<solids.length;i++) {
        const a=solids[i];
        if(!nav.scale.inBounds(a))throw new Error(`footprint_out_of_bounds:${a.id}`);
        for(let j=0;j<i;j++)if(nav.scale.overlaps(a,solids[j]))throw new Error(`overlapping_footprints:${a.id}:${solids[j].id}`);
    }
}
async function clearResourceOverlaps(db,sectorId) {
    const bodies=(await query(db,'SELECT * FROM sector_objects WHERE sector_id=?',[sectorId])).filter(nav.scale.isSolid);
    const nodes=await query(db,'SELECT id,x,y FROM resource_nodes WHERE sector_id=? ORDER BY id',[sectorId]);
    for(const node of nodes) {
        const mover={type:'resource_node'};
        const point=nav.findPlacement(bodies,mover,node,{maxRadius:250});
        if(!point)throw new Error('no_space_for_resource');
        if(point.x!==node.x||point.y!==node.y)await run(db,'UPDATE resource_nodes SET x=?,y=? WHERE id=?',[point.x,point.y,node.id]);
        bodies.push({...mover,...point});
    }
}
module.exports={query,run,physicalObjects,placeNear,validateBodies,clearResourceOverlaps};
