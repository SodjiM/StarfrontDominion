const nav=require('../../utils/navigation');
class NavigationService {
 constructor(db){this.db=db;}
 sectorObjects(sectorId){return require('../world/physical-placement').physicalObjects(this.db,sectorId);}
 get(sql,args=[]){return new Promise((r,j)=>this.db.get(sql,args,(e,v)=>e?j(e):r(v)));}
 all(sql,args=[]){return new Promise((r,j)=>this.db.all(sql,args,(e,v)=>e?j(e):r(v||[])));}
 run(sql,args=[]){return new Promise((r,j)=>this.db.run(sql,args,function(e){e?j(e):r(this)}));}
 async destinationNear(ship,targetId){
  const target=await this.get('SELECT * FROM sector_objects WHERE id=? AND sector_id=?',[targetId,ship.sector_id]);
  if(!target)throw new Error('target_not_in_sector');
  const objects=await this.sectorObjects(ship.sector_id);
  const radius=Math.ceil(nav.scale.extent(target)+nav.scale.extent(ship))+2;
  const point=nav.findPlacement(objects,ship,target,{minRadius:radius,maxRadius:radius+30});
  if(!point)throw new Error('destination_blocked');
  return point;
 }
 async route(ship,dest){const objects=await this.sectorObjects(ship.sector_id);return nav.findPath(ship,dest,nav.occupancy(objects,ship.id,ship));}
 async order(shipId,dest,{userId,gameId,internal=false}={}){
  if(!nav.validPoint(dest))throw new Error('destination_out_of_bounds');
  const ship=await this.get('SELECT so.*,s.game_id FROM sector_objects so JOIN sectors s ON s.id=so.sector_id WHERE so.id=? AND so.type=\'ship\'',[shipId]);
  if(!ship || (userId!=null&&ship.owner_id!==Number(userId)) || (gameId!=null&&ship.game_id!==Number(gameId)))throw new Error('not_owner');
  if(!internal && await this.get("SELECT id FROM lane_itineraries WHERE ship_id=? AND status='active'",[shipId]))throw new Error('cancel_travel_first');
  const path=await this.route(ship,dest);if(!path)throw new Error('no_route_to_destination');
  const speed=Math.max(1,Number(JSON.parse(ship.meta||'{}').movementSpeed)||1),eta=Math.ceil((path.length-1)/speed);
  await this.run('DELETE FROM movement_orders WHERE object_id=?',[shipId]);
  await this.run(`INSERT INTO movement_orders (object_id,destination_x,destination_y,movement_speed,eta_turns,movement_path,current_step,status,created_at) VALUES (?,?,?,?,?,?,0,'active',?)`,[shipId,dest.x,dest.y,speed,eta,JSON.stringify(path),new Date().toISOString()]);
  return {success:true,shipId,destinationX:dest.x,destinationY:dest.y,movementPath:path,pathLength:path.length-1,estimatedTurns:eta};
 }
 async tickMoves(gameId,turn){
  const orders=await this.all(`SELECT mo.*,so.id AS ship_id,so.x,so.y,so.sector_id,so.meta FROM movement_orders mo JOIN sector_objects so ON so.id=mo.object_id JOIN sectors s ON s.id=so.sector_id WHERE s.game_id=? AND mo.status IN ('active','blocked') ORDER BY mo.id`,[gameId]);
  const results=[];const seen=new Set();
  for(const o of orders){if(seen.has(o.ship_id))continue;seen.add(o.ship_id);
   if(await this.get('SELECT id FROM lane_transits WHERE ship_id=?',[o.ship_id]))continue;
   const ship={...o,id:o.ship_id,type:"ship"};
   let path = null;
   try {
    const stored = JSON.parse(o.movement_path || '[]');
    if (Array.isArray(stored) && stored.length > 1 && stored[0]?.x === o.x && stored[0]?.y === o.y) {
     const objects = await this.sectorObjects(o.sector_id);
     const blocked = nav.occupancy(objects,o.ship_id,{...ship,type:"ship"});
     const validRemaining = !blocked(stored[stored.length - 1]) && stored.slice(1).every((p,i)=>nav.canStep(stored[i],p,blocked));
     if (validRemaining) path = stored;
    }
   } catch {}
   if (!path) path=await this.route(ship,{x:o.destination_x,y:o.destination_y});
   if(!path){
    const blockedBy={reason:'no_route',turn,nextRetryTurn:turn+1,retrying:true};
    await this.run("UPDATE movement_orders SET status='blocked',blocked_by=? WHERE id=?",[JSON.stringify(blockedBy),o.id]);
    results.push({objectId:o.ship_id,status:'blocked',retrying:true,nextRetryTurn:turn+1});
    continue;
   }
   const effects=await this.all('SELECT effect_data FROM ship_status_effects WHERE ship_id=? AND (expires_turn IS NULL OR expires_turn>=?)',[o.ship_id,turn]);
   let mult=1,flat=0;for(const e of effects){const d=JSON.parse(e.effect_data||'{}');mult+=Number(d.movementBonus)||0;flat=Math.max(flat,Number(d.movementFlatBonus)||0);}
   const speed=Math.max(1,Math.floor((Number(JSON.parse(o.meta||'{}').movementSpeed)||1)*mult)+flat);
   const step=Math.min(speed,path.length-1),p=path[step],status=step===path.length-1?'completed':'active';
   const remainingPath=path.slice(step);
   await this.run('UPDATE sector_objects SET x=?,y=?,updated_at=? WHERE id=?',[p.x,p.y,new Date().toISOString(),o.ship_id]);
   if(step)await this.run('INSERT INTO movement_history(object_id,game_id,sector_id,turn_number,from_x,from_y,to_x,to_y,movement_speed) VALUES(?,?,?,?,?,?,?,?,?)',[o.ship_id,gameId,o.sector_id,turn,o.x,o.y,p.x,p.y,speed]);
   await this.run('UPDATE movement_orders SET movement_path=?,current_step=?,status=?,eta_turns=?,blocked_by=NULL WHERE id=?',[JSON.stringify(remainingPath),0,status,Math.ceil((remainingPath.length-1)/speed),o.id]);
   results.push({objectId:o.ship_id,status,newPosition:p,retried:o.status==='blocked'});
  }return results;
 }
}
module.exports={NavigationService};
