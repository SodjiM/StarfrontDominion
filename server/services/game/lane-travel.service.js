const {NavigationService}=require('./navigation.service');
const {geometry,pointAt,advance,validPoint}=require('../../utils/navigation');
class LaneTravelService extends NavigationService {
 async edge(id,sectorId){const e=await this.get('SELECT * FROM lane_edges WHERE id=? AND sector_id=?',[id,sectorId]);if(!e)throw new Error('edge_not_in_sector');return {...e,geom:geometry(JSON.parse(e.polyline_json))};}
 async confirm(shipId,sectorId,legs,dest,turn){
  if(!Array.isArray(legs)||!legs.length||legs.length>64||!validPoint(dest))throw new Error('invalid_route');
  const itinerary=[];
  for(const leg of legs){const edge=await this.edge(leg.edgeId,sectorId);
   if(!['tap','wildcat'].includes(leg.entry)||![leg.sStart,leg.sEnd].every(v=>Number.isFinite(v)&&v>=0&&v<=edge.geom.total+0.01))throw new Error('invalid_lane_leg');
   let tapId=null;if(leg.entry==='tap') {const tap=await this.get('SELECT id FROM lane_taps WHERE id=? AND edge_id=?',[leg.tapId,edge.id]);if(!tap)throw new Error('invalid_tap');tapId=tap.id;}
   itinerary.push({edgeId:edge.id,entry:leg.entry,sStart:Math.min(edge.geom.total,leg.sStart),sEnd:Math.min(edge.geom.total,leg.sEnd),tapId,mergeTurns:Math.max(1,Math.min(10,Math.round(leg.mergeTurns||1))),done:false});
  }
  await this.cancel(shipId);
  await this.run(`INSERT INTO lane_itineraries(ship_id,sector_id,created_turn,freshness_turns,status,itinerary_json,meta) VALUES(?,?,?,6,'active',?,?)`,[shipId,sectorId,turn,JSON.stringify(itinerary),JSON.stringify({dest,stage:'approach'})]);
  return {success:true,stored:true,started:true,itinerary};
 }
 async cancel(shipId){
  await this.run("UPDATE lane_itineraries SET status='cancelled' WHERE ship_id=? AND status='active'",[shipId]);
  await this.run("UPDATE lane_tap_queue SET status='cancelled' WHERE ship_id=? AND status='queued'",[shipId]);
  await this.run('DELETE FROM lane_transits WHERE ship_id=?',[shipId]);
  await this.run("DELETE FROM movement_orders WHERE object_id=? AND status IN ('active','blocked','warp_preparing')",[shipId]);
  await this.recount();return {success:true,cancelled:true,exited:true};
 }
 async recount(){await this.run('UPDATE lane_edges_runtime SET load_cu=COALESCE((SELECT SUM(cu) FROM lane_transits WHERE edge_id=lane_edges_runtime.edge_id),0)');}
 async approach(ship,target){
  if(Math.hypot(ship.x-target.x,ship.y-target.y)<=4)return true;
  if(await this.get("SELECT id FROM movement_orders WHERE object_id=? AND status IN ('active','blocked')",[ship.id]))return false;
  // Taps may overlap their POI. Approach a reachable neighboring tile instead.
  const candidates=[target];for(let r=1;r<=3;r++)for(const [dx,dy] of [[r,0],[-r,0],[0,r],[0,-r]])candidates.push({x:target.x+dx,y:target.y+dy});
  for(const p of candidates){if(!validPoint(p))continue;const path=await this.route(ship,p);if(path){await this.order(ship.id,p,{internal:true});return false;}}
  throw new Error('lane_entry_unreachable');
 }
 async tick(gameId,turn){
  const rows=await this.all(`SELECT li.* FROM lane_itineraries li JOIN sectors s ON s.id=li.sector_id WHERE s.game_id=? AND li.status='active' ORDER BY li.id`,[gameId]);
  const slotBudget=new Map();
  // Stable global FIFO among queued entries, independent of itinerary creation order.
  const fifo=await this.all("SELECT q.* FROM lane_tap_queue q JOIN lane_taps t ON t.id=q.tap_id JOIN lane_edges e ON e.id=t.edge_id JOIN sectors s ON s.id=e.sector_id WHERE s.game_id=? AND q.status='queued' ORDER BY q.enqueued_turn,q.id",[gameId]);
  const queueRank=new Map(fifo.map((q,i)=>[q.ship_id,i]));
  rows.sort((a,b)=>(queueRank.get(a.ship_id)??Infinity)-(queueRank.get(b.ship_id)??Infinity)||a.id-b.id);
  for(const row of rows){
   const ship=await this.get('SELECT * FROM sector_objects WHERE id=?',[row.ship_id]);if(!ship||ship.sector_id!==row.sector_id){await this.cancel(row.ship_id);continue;}
   const legs=JSON.parse(row.itinerary_json),meta=JSON.parse(row.meta||'{}'),leg=legs.find(l=>!l.done);
   if(!leg){
    if(!meta.dest || (ship.x===meta.dest.x&&ship.y===meta.dest.y)){await this.run("UPDATE lane_itineraries SET status='consumed' WHERE id=?",[row.id]);continue;}
    if(!await this.get("SELECT id FROM movement_orders WHERE object_id=? AND status IN ('active','blocked')",[ship.id])){
     try{await this.order(ship.id,meta.dest,{internal:true});meta.stage='final_approach';delete meta.error;}catch(e){meta.stage='blocked';meta.error=e.message;}
    }
    await this.run('UPDATE lane_itineraries SET meta=? WHERE id=?',[JSON.stringify(meta),row.id]);continue;
   }
   const edge=await this.edge(leg.edgeId,row.sector_id);
   let transit=await this.get('SELECT * FROM lane_transits WHERE ship_id=?',[ship.id]);
   if(!transit){
    const entry=leg.entry==='tap'?await this.get('SELECT x,y FROM lane_taps WHERE id=? AND edge_id=?',[leg.tapId,edge.id]):pointAt(edge.geom,leg.sStart);
    try{if(!entry||!await this.approach(ship,entry))continue;}catch(e){meta.stage='blocked';meta.error=e.message;await this.run('UPDATE lane_itineraries SET meta=? WHERE id=?',[JSON.stringify(meta),row.id]);continue;}
    await this.run("DELETE FROM movement_orders WHERE object_id=?",[ship.id]);
    const cu=Math.max(1,Number(JSON.parse(ship.meta||'{}').convoyUnits)||1);
    if(leg.entry==='tap'){
     let q=await this.get("SELECT * FROM lane_tap_queue WHERE ship_id=? AND status='queued'",[ship.id]);
     if(!q){await this.run("INSERT INTO lane_tap_queue(tap_id,ship_id,cu,enqueued_turn,status) VALUES(?,?,?,?,'queued')",[leg.tapId,ship.id,cu,turn]);continue;}
     if(!slotBudget.has(edge.id))slotBudget.set(edge.id,Math.max(1,Math.floor(edge.lane_speed/Math.max(1,edge.headway)))*2);
     const budget=slotBudget.get(edge.id),capacity=Math.max(1,Math.floor(edge.lane_speed/Math.max(1,edge.headway)))*2;
     // Oversized convoys reserve several turns of slots instead of waiting forever.
     if(cu>budget && (budget!==capacity || turn-q.enqueued_turn<Math.ceil(cu/capacity))){slotBudget.set(edge.id,0);continue;}
     slotBudget.set(edge.id,Math.max(0,budget-cu));await this.run("UPDATE lane_tap_queue SET status='launched' WHERE id=?",[q.id]);
    }
    const result=await this.run(`INSERT INTO lane_transits(edge_id,ship_id,direction,progress,cu,mode,merge_turns,entered_turn,meta) VALUES(?,?,?,?,?,?,?,?,?)`,[edge.id,ship.id,Math.sign(leg.sEnd-leg.sStart)||1,leg.sStart/edge.geom.total,cu,leg.entry==='wildcat'?'shoulder':'core',leg.entry==='wildcat'?leg.mergeTurns:0,turn,JSON.stringify({targetStartP:leg.sStart/edge.geom.total,targetEndP:leg.sEnd/edge.geom.total})]);
    transit=await this.get('SELECT * FROM lane_transits WHERE id=?',[result.lastID]);
   }
   if(transit.mode==='shoulder' && transit.merge_turns>0){await this.run("UPDATE lane_transits SET merge_turns=?,mode=? WHERE id=?",[transit.merge_turns-1,transit.merge_turns===1?'core':'shoulder',transit.id]);continue;}
   const load=await this.get('SELECT SUM(cu) AS total FROM lane_transits WHERE edge_id=?',[edge.id]);
   const region=await this.get('SELECT health FROM regions WHERE sector_id=? AND region_id=?',[row.sector_id,edge.region_id]);
   const health=region?.health??50,hm=health>=80?1.25:health>=60?1:0.7;
   const cap=Math.max(1,Math.floor(edge.cap_base*(edge.width_core/150)*hm)),rho=(load?.total||0)/cap;
   const congestion=rho<=1?1:rho<=1.5?0.8:rho<=2?0.6:0.4;
   const stats=JSON.parse(ship.meta||'{}'),speed=100*congestion*Math.max(0.1,Number(stats.warpSpeedMultiplier||stats.warpSpeed)||1);
   const progress=advance(transit.progress*edge.geom.total,leg.sEnd,speed),p=pointAt(edge.geom,progress.position);
   await this.run('UPDATE sector_objects SET x=?,y=?,updated_at=? WHERE id=?',[p.x,p.y,new Date().toISOString(),ship.id]);
   await this.run('UPDATE lane_transits SET progress=? WHERE id=?',[progress.position/edge.geom.total,transit.id]);
   meta.stage='transit';delete meta.error;
   if(progress.arrived){leg.done=true;await this.run('DELETE FROM lane_transits WHERE id=?',[transit.id]);meta.stage=legs.some(l=>!l.done)?'approach':'final_approach';}
   await this.run('UPDATE lane_itineraries SET itinerary_json=?,meta=? WHERE id=?',[JSON.stringify(legs),JSON.stringify(meta),row.id]);
  }
  await this.recount();
 }
}
module.exports={LaneTravelService};
