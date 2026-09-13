const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.DATABASE_PATH=':memory:';
const express=require('express'),{createServer}=require('node:http'),{Server}=require('socket.io'),WebSocket=require('ws');
const db=require('../server/db');
const {NavigationService}=require('../server/services/game/navigation.service');
const n=new NavigationService(db),auth=require('../server/middleware/auth');
const app=express();app.use(express.json());app.use('/auth',require('../server/routes/auth'));app.use('/lobby',require('../server/routes/lobby'));
const protectedRouter=express.Router();auth.protectRouter(protectedRouter);protectedRouter.get('/:gameId/state/:userId',(req,res)=>res.json({userId:req.userId}));app.use('/game',protectedRouter);
const server=createServer(app),io=new Server(server);auth.protectSockets(io);require('../server/sockets/game.channel').registerGameChannel({io,db,resolveTurn:async()=>{}});
let base,port,alice,bob,game,ship,sector;const sockets=[];
async function request(path,body,cookie,method){return fetch(base+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},signal:AbortSignal.timeout(5000),body:body?JSON.stringify(body):undefined});}
async function register(username){const r=await request('/auth/register',{username,password:'family-test-password'});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly/i);return {...await r.json(),cookie:r.headers.get('set-cookie').split(';')[0]};}
async function connect(cookie){
 const ws=new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`,{headers:cookie?{Cookie:cookie}:{}});sockets.push(ws);let sequence=0;const waiting=new Map(),events=[];
 const ready=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('connection timeout')),3000);
 ws.on('message',raw=>{const s=raw.toString();if(s.startsWith('0'))ws.send('40');else if(s==='2')ws.send('3');else if(s.startsWith('40')){clearTimeout(timeout);resolve();}else if(s.startsWith('44')){clearTimeout(timeout);reject(new Error(s));}else if(s.startsWith('43')){const i=s.indexOf('['),id=Number(s.slice(2,i));waiting.get(id)?.(JSON.parse(s.slice(i))[0]);waiting.delete(id);}else if(s.startsWith('42'))events.push(JSON.parse(s.slice(2)));});ws.on('error',reject);
 });await ready;
 return {ws,events,emit(event,...args){ws.send('42'+JSON.stringify([event,...args]));},call(event,payload){return new Promise((resolve,reject)=>{const id=sequence++,timer=setTimeout(()=>reject(new Error('ack timeout: '+event)),3000);waiting.set(id,r=>{clearTimeout(timer);resolve(r)});ws.send('42'+id+JSON.stringify([event,payload]));});}};
}
before(async()=>{await db.ready;await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r)});port=server.address().port;base=`http://127.0.0.1:${port}`;alice=await register('alice');bob=await register('bob');game=(await n.run("INSERT INTO games(name,status) VALUES('family','active')")).lastID;for(const u of [alice,bob])await n.run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)',[game,u.userId]);await n.run("INSERT INTO turns(game_id,turn_number,status) VALUES(?,1,'waiting')",[game]);sector=(await n.run("INSERT INTO sectors(game_id,name) VALUES(?,'home')",[game])).lastID;ship=(await n.run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',10,10,?,?)",[sector,alice.userId,'{"movementSpeed":4}'])).lastID;});
after(async()=>{for(const s of sockets)s.terminate();await new Promise(r=>io.close(r));await new Promise(r=>db.close(r));});
test('HTTP requires session; cannot impersonate, delete all games, or forge origin',async()=>{
 assert.equal((await request(`/game/${game}/state/${alice.userId}`)).status,401);
 assert.equal((await request(`/game/${game}/state/${alice.userId}`,null,alice.cookie)).status,200);
 assert.equal((await request(`/game/${game}/state/${bob.userId}`,null,alice.cookie)).status,403);
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
 const plan=await a.call('travel:plan',{gameId:game,sectorId:sector,shipId:ship,from:{x:4000,y:4000},to:{x:400,y:10}});
 assert.equal(plan.success,true);assert(plan.routes.length>0);
 const route=plan.routes[0];assert.equal(route.legs[0].sStart,0);
 const result=await a.call('travel:confirm',{gameId:game,sectorId:sector,shipId:ship,routeId:route.routeId,legs:[{edgeId:999999,sStart:0,sEnd:999999}]});
 assert.equal(result.success,true);assert.equal(result.itinerary[0].edgeId,edge);
 assert.equal((await a.call('travel:cancel',{gameId:game,sectorId:sector,shipId:ship})).success,true);
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
