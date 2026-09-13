const nav=require('../../utils/navigation');
const {query,run,physicalObjects}=require('./physical-placement');
const laneShip={type:'ship',meta:{class:'capital'}};
function simplify(path) {
    return path.filter((p,i)=>i===0||i===path.length-1||(p.x-path[i-1].x)!==(path[i+1].x-p.x)||(p.y-path[i-1].y)!==(path[i+1].y-p.y));
}
async function repairLaneClearance(db,sectorId) {
    // Static terrain only: construction and moving ships are checked during travel.
    const obstacles=(await physicalObjects(db,sectorId)).filter(o=>o.type!=='ship'&&nav.scale.isSolid(o));
    const blocked=nav.occupancy(obstacles,null,laneShip);
    const edges=await query(db,'SELECT * FROM lane_edges WHERE sector_id=?',[sectorId]);
    for(const edge of edges) {
        const original=JSON.parse(edge.polyline_json);
        const path=[];
        for(let i=0;i<original.length;i++) {
            let p={x:Math.round(original[i].x),y:Math.round(original[i].y)};
            if(blocked(p))p=nav.findPlacement(obstacles,laneShip,p,{maxRadius:400});
            if(!p)throw new Error(`lane_endpoint_blocked:${edge.id}`);
            if(!path.length)path.push(p);
            else {
                const segment=nav.findPath(path.at(-1),p,blocked,300000);
                if(!segment)throw new Error(`lane_clearance_failed:sector=${sectorId},edge=${edge.id},from=${JSON.stringify(path.at(-1))},to=${JSON.stringify(p)}`);
                path.push(...segment.slice(1));
            }
        }
        if(path.length<2)throw new Error('degenerate_lane');
        const points=simplify(path),geom=nav.geometry(points),oldGeom=nav.geometry(original);
        await run(db,'UPDATE lane_edges SET polyline_json=? WHERE id=?',[JSON.stringify(points),edge.id]);
        const taps=await query(db,'SELECT * FROM lane_taps WHERE edge_id=?',[edge.id]);
        for(const tap of taps) {
            // Keep relative along-lane placement; endpoints stay endpoints.
            let best={distance:Infinity,s:0};
            for(let i=1;i<original.length;i++) {
                const a=original[i-1],b=original[i],dx=b.x-a.x,dy=b.y-a.y;
                const t=Math.max(0,Math.min(1,((tap.x-a.x)*dx+(tap.y-a.y)*dy)/(dx*dx+dy*dy||1)));
                const d=Math.hypot(tap.x-a.x-t*dx,tap.y-a.y-t*dy);
                if(d<best.distance)best={distance:d,s:oldGeom.acc[i-1]+t*Math.hypot(dx,dy)};
            }
            const p=nav.pointAt(geom,best.s/oldGeom.total*geom.total);
            await run(db,'UPDATE lane_taps SET x=?,y=? WHERE id=?',[p.x,p.y,tap.id]);
        }
    }
}
module.exports={repairLaneClearance};
