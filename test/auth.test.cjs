const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.DATABASE_PATH=':memory:';
const express=require('express'),{createServer}=require('node:http'),{Server}=require('socket.io'),WebSocket=require('ws');
const db=require('../server/db');
const {NavigationService}=require('../server/services/game/navigation.service');
const n=new NavigationService(db),auth=require('../server/middleware/auth');
const app=express();app.use(express.json());app.use('/auth',require('../server/routes/auth'));app.use('/lobby',require('../server/routes/lobby'));
const protectedRouter=express.Router();auth.protectRouter(protectedRouter);protectedRouter.get('/:gameId/state/:userId',(req,res)=>res.json({userId:req.userId}));app.use('/game',protectedRouter);app.use('/game',require('../server/routes/build.routes'));app.use('/game',require('../server/routes/galaxy.routes'));app.use('/game',require('../server/routes/state.routes'));app.use('/game',require('../server/routes/movement.routes'));
const server=createServer(app),io=new Server(server);auth.protectSockets(io);require('../server/sockets/game.channel').registerGameChannel({io,db,resolveTurn:async()=>{}});
let base,port,alice,bob,game,ship,sector,incident;const sockets=[];
async function request(path,body,cookie,method){return fetch(base+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},signal:AbortSignal.timeout(5000),body:body?JSON.stringify(body):undefined});}
async function register(username){const r=await request('/auth/register',{username,password:'family-test-password'});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly/i);return {...await r.json(),cookie:r.headers.get('set-cookie').split(';')[0]};}
async function connect(cookie){
 const ws=new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`,{headers:cookie?{Cookie:cookie}:{}});sockets.push(ws);let sequence=0;const waiting=new Map(),events=[];
 const ready=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('connection timeout')),3000);
 ws.on('message',raw=>{const s=raw.toString();if(s.startsWith('0'))ws.send('40');else if(s==='2')ws.send('3');else if(s.startsWith('40')){clearTimeout(timeout);resolve();}else if(s.startsWith('44')){clearTimeout(timeout);reject(new Error(s));}else if(s.startsWith('43')){const i=s.indexOf('['),id=Number(s.slice(2,i));waiting.get(id)?.(JSON.parse(s.slice(i))[0]);waiting.delete(id);}else if(s.startsWith('42'))events.push(JSON.parse(s.slice(2)));});ws.on('error',reject);
 });await ready;
 return {ws,events,emit(event,...args){ws.send('42'+JSON.stringify([event,...args]));},call(event,payload){return new Promise((resolve,reject)=>{const id=sequence++,timer=setTimeout(()=>reject(new Error('ack timeout: '+event)),3000);waiting.set(id,r=>{clearTimeout(timer);resolve(r)});ws.send('42'+id+JSON.stringify([event,payload]));});}};
}
before(async()=>{await db.ready;await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r)});port=server.address().port;base=`http://127.0.0.1:${port}`;alice=await register('alice');bob=await register('bob');game=(await n.run("INSERT INTO games(name,status) VALUES('family','active')")).lastID;for(const u of [alice,bob])await n.run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)',[game,u.userId]);await n.run("INSERT INTO turns(game_id,turn_number,status) VALUES(?,1,'waiting')",[game]);sector=(await n.run("INSERT INTO sectors(game_id,name) VALUES(?,'home')",[game])).lastID;await n.run("INSERT INTO regions(sector_id,region_id,cells_json,health) VALUES(?,'A',?,50)",[sector,JSON.stringify(Array.from({length:9},(_,i)=>({row:Math.floor(i/3),col:i%3})))]);incident=(await n.run(`INSERT INTO region_incidents(game_id,sector_id,region_id,incident_key,title,summary,utility_role,severity,status,created_turn,due_turn,pressure_turn,pressure_band,pressure_score,generation_roll,generation_version,health_loss,resolution_rule,resolution_requirements_json,target_x,target_y) VALUES(?,?,?,'debris-migration','Debris Migration','Debris threatens traffic','courier','significant','active',1,5,1,'high',64,0.1,1,4,'ship_arrival','{"arrivalRadius":0,"eligibleShips":[{"roles":["courier"]}]}',20,20)`,[game,sector,'A'])).lastID;ship=(await n.run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',10,10,?,?)",[sector,alice.userId,'{"movementSpeed":4,"role":"courier","hp":35}'])).lastID;await n.run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'warp-beacon',3000,3000,?,?)",[sector,bob.userId,'{"structureType":"warp-beacon","hp":100}']);});
after(async()=>{for(const s of sockets)s.terminate();await new Promise(r=>io.close(r));await new Promise(r=>db.close(r));});
test('HTTP requires session; cannot impersonate, delete all games, or forge origin',async()=>{
 assert.equal((await request(`/game/${game}/state/${alice.userId}`)).status,401);
 assert.equal((await request(`/game/${game}/state/${alice.userId}`,null,alice.cookie)).status,200);
 assert.equal((await request(`/game/${game}/state/${bob.userId}`,null,alice.cookie)).status,403);
 assert.equal((await request(`/game/system/${sector}/facts`)).status,401);
 const factsResponse=await request(`/game/system/${sector}/facts`,null,alice.cookie);assert.equal(factsResponse.status,200);
 const factsPayload=await factsResponse.json();assert.equal(JSON.stringify(factsPayload).includes('concealedLoad'),false);assert.equal('minerals' in factsPayload,false);assert.equal('laneTapsByEdge' in factsPayload,false);
 assert.deepEqual(factsPayload.regions[0].incidents[0].resolution,{rule:'ship_arrival',target:{x:20,y:20,radius:0},eligibleShips:[{roles:['courier']}]});
 assert.equal((await request(`/game/system/${sector}/incidents/${incident}/response`,{shipId:ship},alice.cookie,'POST')).status,404);
 const hiddenMapResponse=await request(`/game/${game}/map/${alice.userId}/${sector}/3000/3000?range=5000`,null,alice.cookie);assert.equal(hiddenMapResponse.status,200);
 const hiddenMap=await hiddenMapResponse.json();assert.equal(hiddenMap.viewRange,250);assert.deepEqual(hiddenMap.objects,[]);assert.equal(JSON.stringify(hiddenMap).includes('warp-beacon'),false);
 const foreignGame=(await n.run("INSERT INTO games(name,status) VALUES('foreign','active')")).lastID;
 const foreignSector=(await n.run("INSERT INTO sectors(game_id,name) VALUES(?,'foreign-sector')",[foreignGame])).lastID;
 assert.equal((await request(`/game/${foreignGame}/galaxy-graph`,null,alice.cookie)).status,403);
 assert.equal((await request(`/game/system/${foreignSector}/facts`,null,alice.cookie)).status,403);
 assert.equal((await request('/lobby/games/clear-all',{confirm:'DELETE'},alice.cookie,'DELETE')).status,403);
 const r=await fetch(base+'/auth/login',{method:'POST',headers:{Origin:'https://evil.invalid','Content-Type':'application/json'},body:JSON.stringify({username:'alice',password:'family-test-password'})});assert.equal(r.status,403);
});
test('Socket.IO rejects anonymous and cross-player orders; owner sends only destination',async()=>{
 await assert.rejects(()=>connect(),/authentication_required/);
 const a=await connect(alice.cookie),b=await connect(bob.cookie);a.emit('join-game',game,alice.userId);b.emit('join-game',game,bob.userId);
 const denied=await b.call('move-ship',{gameId:game,shipId:ship,destinationX:4000,destinationY:4000});assert.equal(denied.error,'not_owner');
 const moved=await a.call('move-ship',{gameId:game,shipId:ship,destinationX:18,destinationY:10,movementPath:[{x:4000,y:4000}]});assert.equal(moved.success,true);assert.deepEqual(moved.movementPath[0],{x:10,y:10});assert.equal(moved.pathLength,8);
 const forbidden=await b.call('queue:clear',{gameId:game,shipId:ship});assert.equal(forbidden.error,'not_owner');
 const spoof=await b.call('chat:send',{gameId:game,fromUserId:alice.userId,text:'spoof'});assert.equal(spoof.error,'identity_mismatch');
 const expired=await a.call('travel:confirm',{gameId:game,shipId:ship,sectorId:1,routeId:'invented'});assert.equal(expired.success,false);
});
test('lane confirmation uses server-issued route and ignores edited client legs',async()=>{
 const edge=(await n.run(`INSERT INTO lane_edges(sector_id,cls,region_id,polyline_json,width_core,width_shoulder,lane_speed,cap_base,headway,mass_limit) VALUES(?,'test','r',?,150,200,100,100,10,'all')`,[sector,JSON.stringify([{x:10,y:10},{x:410,y:10}])])).lastID;
 await n.run('INSERT INTO lane_edges_runtime(edge_id) VALUES(?)',[edge]);
 const a=await connect(alice.cookie);a.emit('join-game',game,alice.userId);
 const b=await connect(bob.cookie);b.emit('join-game',game,bob.userId);
 const missingShip=await b.call('travel:plan',{gameId:game,sectorId:sector,shipId:ship,to:{x:12,y:10}});
 assert.equal(missingShip.error,'not_owner');
 const plan=await a.call('travel:plan',{gameId:game,sectorId:sector,shipId:ship,from:{x:4000,y:4000},to:{x:400,y:10}});
 assert.equal(plan.success,true);assert(plan.routes.length>0);
 const route=plan.routes[0];assert.deepEqual(Object.keys(route).sort(),['eta','mode','risk','routeId']);
 const result=await a.call('travel:confirm',{gameId:game,sectorId:sector,shipId:ship,routeId:route.routeId,legs:[{edgeId:999999,sStart:0,sEnd:999999}]});
 assert.equal(result.success,true);assert.deepEqual(Object.keys(result).sort(),['mode','started','stored','success']);
 assert.equal((await a.call('travel:cancel',{gameId:game,sectorId:sector,shipId:ship})).success,true);
 const nearby=await a.call('travel:plan',{gameId:game,sectorId:sector,shipId:ship,to:{x:12.4,y:10.2}});
 assert.equal(nearby.success,true);assert.equal(nearby.routes[0].mode,'impulse');
 const queued=await a.call('travel:confirm',{gameId:game,sectorId:sector,shipId:ship,routeId:nearby.routes[0].routeId,queue:true,clientOrderId:'direct-impulse-test'});
 assert.equal(queued.success,true);assert.equal(queued.mode,'impulse');
});
test('logout revokes existing HTTP and socket sessions; login reconnects',async()=>{
 const a=await connect(alice.cookie);a.emit('join-game',game,alice.userId);
 assert.equal((await request('/auth/logout',{},alice.cookie)).status,200);
 assert.equal((await request('/auth/me',null,alice.cookie)).status,401);
 await assert.rejects(()=>connect(alice.cookie),/authentication_required/);
 const login=await request('/auth/login',{username:'alice',password:'family-test-password'});assert.equal(login.status,200);
 const fresh=login.headers.get('set-cookie').split(';')[0];const reconnected=await connect(fresh);reconnected.emit('join-game',game,alice.userId);
 assert.equal((await reconnected.call('queue:list',{gameId:game,shipId:ship})).success,true);
});

test('construction catalog and purchases agree over authenticated HTTP',async()=>{
 const {CargoManager}=require('../server/services/game/cargo-manager');
 const {STRUCTURE_BUILD_COSTS}=require('../server/services/game/build.service');
 assert.equal((await request('/game/structure-costs')).status,401);
 const catalog=await request('/game/structure-costs',null,bob.cookie);
 assert.equal(catalog.status,200);assert.deepEqual((await catalog.json()).costs,STRUCTURE_BUILD_COSTS);
 const stationId=(await n.run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'station',1500,1500,?,'{}')",[sector,bob.userId])).lastID;
 await CargoManager.addResourceToCargo(stationId,'rock',8);
 const built=await request('/game/build-structure',{stationId,structureType:'sun-station',cost:0},bob.cookie);
 assert.equal(built.status,200);
 const cargo=await CargoManager.getObjectCargo(stationId);
 assert.equal(cargo.items.find(i=>i.resource_name==='rock'),undefined);
 assert.equal(cargo.items.find(i=>i.resource_name==='sun-station').quantity,1);
 const insufficient=await request('/game/build-structure',{stationId,structureType:'sun-station'},bob.cookie);
 assert.equal(insufficient.status,400);
 await CargoManager.addResourceToCargo(stationId,'rock',1);
 await n.run("CREATE TEMP TRIGGER reject_explorer BEFORE INSERT ON sector_objects WHEN NEW.type='ship' BEGIN SELECT RAISE(ABORT,'injected explorer failure'); END");
 try {assert.equal((await request('/game/build-basic-explorer',{stationId},bob.cookie)).status,500);}
 finally {await n.run('DROP TRIGGER reject_explorer');}
 assert.equal((await CargoManager.getObjectCargo(stationId)).items.find(i=>i.resource_name==='rock').quantity,1);
});
