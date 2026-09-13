const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.DATABASE_PATH=':memory:';
const db=require('../server/db');
const {NavigationService}=require('../server/services/game/navigation.service');
const {LaneTravelService}=require('../server/services/game/lane-travel.service');
const nav=require('../server/utils/navigation');
const n=new NavigationService(db),lanes=new LaneTravelService(db);
let game,sector,ship,owner;
before(async()=>{await db.ready;owner=(await n.run("INSERT INTO users(username,password) VALUES('test','hash')")).lastID;game=(await n.run("INSERT INTO games(name,status) VALUES('test','active')")).lastID;sector=(await n.run("INSERT INTO sectors(game_id,name) VALUES(?,'test')",[game])).lastID;ship=(await n.run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',10,10,?,?)",[sector,owner,JSON.stringify({movementSpeed:4,warpSpeedMultiplier:1})])).lastID;});
after(()=>new Promise(r=>db.close(r)));
test('path avoids intermediate obstacles, disallows corner cutting and bounds',()=>{
 const blocked=nav.occupancy([{id:2,x:12,y:10,type:'station'}],1);
 const path=nav.findPath({x:10,y:10},{x:18,y:10},blocked);
 assert(path);assert(path.every(p=>!(p.x===12&&p.y===10)));
 assert(path.slice(1).every((p,i)=>nav.canStep(path[i],p,blocked)));
 assert.equal(nav.findPath({x:1,y:1},{x:5000,y:1},blocked),null);
 assert.equal(nav.canStep({x:0,y:0},{x:1,y:1},p=>p.x===1&&p.y===0),false);
 assert.equal(nav.findPath({x:10,y:10},{x:12,y:10},blocked),null);
});
test('signed progress and zero endpoint respect the per-turn distance',()=>{
 assert.deepEqual(nav.advance(400,0,100),{position:300,used:100,arrived:false});
 assert.deepEqual(nav.advance(50,0,100),{position:0,used:50,arrived:true});
});
test('server routes movement, retries blocked orders, rejects wrong owners',async()=>{
 await n.run("INSERT INTO sector_objects(sector_id,type,x,y) VALUES(?,'station',12,10)",[sector]);
 const result=await n.order(ship,{x:18,y:10},{userId:owner,gameId:game});
 assert(!result.movementPath.some(p=>p.x===12&&p.y===10));
 await assert.rejects(()=>n.order(ship,{x:100,y:100},{userId:owner+1,gameId:game}),/not_owner/);
 // The stored path is not trusted at execution time either.
 await n.run('UPDATE movement_orders SET movement_path=? WHERE object_id=?',['[{"x":10,"y":10},{"x":4000,"y":4000}]',ship]);
 await n.tickMoves(game,1);let pos=await n.get('SELECT x,y FROM sector_objects WHERE id=?',[ship]);
 assert(Math.max(Math.abs(pos.x-10),Math.abs(pos.y-10))<=4);
 const obstacle=(await n.run("INSERT INTO sector_objects(sector_id,type,x,y) VALUES(?,'station',18,10)",[sector])).lastID;
 const blockedResult=await n.tickMoves(game,2);assert.equal((await n.get('SELECT status FROM movement_orders WHERE object_id=?',[ship])).status,'blocked');
 assert.equal(blockedResult[0].retrying,true);
 assert.equal(JSON.parse((await n.get('SELECT blocked_by FROM movement_orders WHERE object_id=?',[ship])).blocked_by).nextRetryTurn,3);
 await n.run('DELETE FROM sector_objects WHERE id=?',[obstacle]);await n.tickMoves(game,3);await n.tickMoves(game,4);
 assert.deepEqual(await n.get('SELECT x,y FROM sector_objects WHERE id=?',[ship]),{x:18,y:10});
});
test('real SQLite lane travel: reverse endpoint zero, merge delay, final approach, cancel',async()=>{
 await n.run('UPDATE sector_objects SET x=410,y=100 WHERE id=?',[ship]);
 const edge=(await n.run(`INSERT INTO lane_edges(sector_id,cls,region_id,polyline_json,width_core,width_shoulder,lane_speed,cap_base,headway,mass_limit) VALUES(?,'test','r',?,150,200,100,100,10,'all')`,[sector,JSON.stringify([{x:10,y:100},{x:410,y:100}])])).lastID;
 await n.run('INSERT INTO lane_edges_runtime(edge_id) VALUES(?)',[edge]);
 await lanes.confirm(ship,sector,[{edgeId:edge,entry:'wildcat',sStart:400,sEnd:0,mergeTurns:1}],{x:10,y:104},1);
 await assert.rejects(()=>n.order(ship,{x:12,y:12},{userId:owner}),/cancel_travel_first/);
 await lanes.tick(game,1);assert.equal((await n.get('SELECT x FROM sector_objects WHERE id=?',[ship])).x,410);
 await lanes.tick(game,2);assert.equal((await n.get('SELECT x FROM sector_objects WHERE id=?',[ship])).x,310);
 for(let t=3;t<=5;t++)await lanes.tick(game,t);
 assert.equal((await n.get('SELECT x FROM sector_objects WHERE id=?',[ship])).x,10);
 await lanes.tick(game,6);await n.tickMoves(game,7);await lanes.tick(game,7);
 assert.deepEqual(await n.get('SELECT x,y FROM sector_objects WHERE id=?',[ship]),{x:10,y:104});
 assert.equal((await n.get('SELECT status FROM lane_itineraries WHERE ship_id=? ORDER BY id DESC LIMIT 1',[ship])).status,'consumed');
 await lanes.confirm(ship,sector,[{edgeId:edge,entry:'wildcat',sStart:0,sEnd:400,mergeTurns:1}],{x:410,y:100},8);
 await lanes.tick(game,8);await lanes.cancel(ship);await lanes.tick(game,9);
 assert.equal(await n.get('SELECT id FROM lane_transits WHERE ship_id=?',[ship]),undefined);
 assert.equal((await n.get('SELECT load_cu FROM lane_edges_runtime WHERE edge_id=?',[edge])).load_cu,0);
});
test('multi-leg travel approaches disconnected entry instead of teleporting; repeated confirmation replaces',async()=>{
 await n.run('UPDATE sector_objects SET x=10,y=200 WHERE id=?',[ship]);
 const add=async(points)=>(await n.run(`INSERT INTO lane_edges(sector_id,cls,region_id,polyline_json,width_core,width_shoulder,lane_speed,cap_base,headway,mass_limit) VALUES(?,'test','r',?,150,200,100,100,10,'all')`,[sector,JSON.stringify(points)])).lastID;
 const a=await add([{x:10,y:200},{x:60,y:200}]),b=await add([{x:80,y:200},{x:180,y:200}]);
 const route=[{edgeId:a,entry:'wildcat',sStart:0,sEnd:50,mergeTurns:1},{edgeId:b,entry:'wildcat',sStart:0,sEnd:100,mergeTurns:1}];
 await lanes.confirm(ship,sector,route,{x:180,y:200},10);await lanes.confirm(ship,sector,route,{x:180,y:200},10);
 assert.equal((await n.get("SELECT COUNT(*) AS n FROM lane_itineraries WHERE ship_id=? AND status='active'",[ship])).n,1);
 await lanes.tick(game,10);await lanes.tick(game,11);
 assert.equal((await n.get('SELECT x FROM sector_objects WHERE id=?',[ship])).x,60);
 await lanes.tick(game,12);assert.equal((await n.get('SELECT x FROM sector_objects WHERE id=?',[ship])).x,60);
 assert.equal((await n.get("SELECT status FROM movement_orders WHERE object_id=?",[ship])).status,'active');
 await lanes.cancel(ship);
});
test('tap launch is queued and final position reaches the destination',async()=>{
 await n.run('UPDATE sector_objects SET x=20,y=300 WHERE id=?',[ship]);
 const edge=(await n.run(`INSERT INTO lane_edges(sector_id,cls,region_id,polyline_json,width_core,width_shoulder,lane_speed,cap_base,headway,mass_limit) VALUES(?,'test','r',?,150,200,10,100,10,'all')`,[sector,JSON.stringify([{x:20,y:300},{x:220,y:300}])])).lastID;
 const tap=(await n.run('INSERT INTO lane_taps(edge_id,x,y) VALUES(?,20,300)',[edge])).lastID;
 await lanes.confirm(ship,sector,[{edgeId:edge,entry:'tap',tapId:tap,sStart:0,sEnd:200}],{x:220,y:300},20);
 await lanes.tick(game,20);assert.equal((await n.get("SELECT status FROM lane_tap_queue WHERE ship_id=? ORDER BY id DESC LIMIT 1",[ship])).status,'queued');
 await lanes.tick(game,21);assert.equal((await n.get('SELECT x FROM sector_objects WHERE id=?',[ship])).x,120);
 await lanes.tick(game,22);await lanes.tick(game,23);
 assert.equal((await n.get('SELECT x FROM sector_objects WHERE id=?',[ship])).x,220);
});
test('resolver runs movement once for duplicate requests and rolls back a failed turn',async()=>{
 const {createTurnResolver}=require('../server/services/game/turn-resolution.service');
 const events=[];const resolve=createTurnResolver({db,io:{to:()=>({emit:(event)=>events.push(event)})},eventBus:{emit(){}},EVENTS:{TurnResolved:'resolved',TurnStarted:'started'}});
 await n.run("INSERT INTO turns(game_id,turn_number,status) VALUES(?,1,'waiting')",[game]);
 await n.run('UPDATE sector_objects SET x=30,y=400 WHERE id=?',[ship]);
 await n.order(ship,{x:50,y:400},{userId:owner,gameId:game});
 await Promise.all([resolve(game,1),resolve(game,1)]);
 assert.equal((await n.get('SELECT x FROM sector_objects WHERE id=?',[ship])).x,34);
 assert.equal((await n.get('SELECT COUNT(*) as n FROM turns WHERE game_id=? AND turn_number=2',[game])).n,1);
 assert.equal(events.filter(e=>e==='turn-resolved').length,1);
 const original=db.run;db.run=function(sql,...args){if(sql.includes('INSERT INTO turns')){args.at(-1)(new Error('injected insert failure'));return this;}return original.call(this,sql,...args);};
 try{await resolve(game,2);}finally{db.run=original;}
 assert.equal((await n.get('SELECT x FROM sector_objects WHERE id=?',[ship])).x,34);
 assert.equal((await n.get('SELECT status FROM turns WHERE game_id=? AND turn_number=2',[game])).status,'waiting');
 assert.equal(events.filter(e=>e==='turn-resolved').length,1);
 await resolve(game,2);assert.equal((await n.get('SELECT x FROM sector_objects WHERE id=?',[ship])).x,38);
});
test('planet destinations resolve to a legal exterior tile',async()=>{
 const planet=(await n.run("INSERT INTO sector_objects(sector_id,type,x,y,radius) VALUES(?,'planet',700,700,12)",[sector])).lastID;
 const vessel=await n.get('SELECT * FROM sector_objects WHERE id=?',[ship]);
 const dest=await n.destinationNear(vessel,planet);
 assert(nav.validPoint(dest));assert(Math.hypot(dest.x-700,dest.y-700)>12);
 await assert.rejects(()=>n.destinationNear(vessel,999999),/target_not_in_sector/);
});
