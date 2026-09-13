const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const scale=require('../client/utils/physical-scale');
const nav=require('../server/utils/navigation');
const {applyOrbitalScaffold}=require('../server/services/world/orbital-scaffold');
const {createRngStreams}=require('../server/services/world/rng');
const {AVAILABLE,getArchetypeModule}=require('../server/services/world/unified-archetype-registry');
const {planMigration,migrateScales}=require('../server/services/world/scale-migration');
process.env.DATABASE_PATH=':memory:';
const db=require('../server/db');
const {query,run,validateBodies}=require('../server/services/world/physical-placement');
const {NavigationService}=require('../server/services/game/navigation.service');
const {SectorGenerationPipeline}=require('../server/services/world/generation-pipeline');
let user,game;
before(async()=>{await db.ready;user=(await run(db,"INSERT INTO users(username,password) VALUES('scale-test','hash')")).lastID;game=(await run(db,"INSERT INTO games(name,status) VALUES('scale-test','active')")).lastID;});
after(()=>new Promise(r=>db.close(r)));
const ship=(id,x,y,cls='capital')=>({id,x,y,type:'ship',meta:{class:cls,movementSpeed:20}});

test('physical catalog defines exact even/odd tile anchors and hull sizes',()=>{
 assert.equal(scale.width({type:'station',meta:{stationClass:'sun-station'}}),13);
 assert.equal(scale.width({type:'station',meta:{stationClass:'moon-station'}}),5);
 assert.equal(scale.width(ship(1,10,10,'cruiser')),3);
 const frigate=ship(1,10,10,'frigate'),blocked=nav.occupancy([frigate],99);
 for(const p of [{x:10,y:10},{x:11,y:10},{x:10,y:11},{x:11,y:11}])assert(blocked(p));
 assert(!blocked({x:9,y:10})); assert(!blocked({x:12,y:10}));
 assert(!scale.inBounds(ship(1,1,1))); assert(scale.inBounds(ship(1,2,2)));
});

test('capital ship cannot fit a three-tile corridor or graze disk and diagonal corners',()=>{
 const walls=[];for(let x=5;x<=25;x++)for(const y of [8,12])walls.push({id:`${x}:${y}`,type:'storage-structure',x,y});
 assert.equal(nav.findPath({x:6,y:10},{x:24,y:10},nav.occupancy(walls,1,ship(1,6,10))),null);
 assert(nav.findPath({x:6,y:10},{x:24,y:10},nav.occupancy(walls,1,ship(1,6,10,'scout'))));
 const body={id:2,type:'planet',radius:30,x:100,y:100};
 assert(nav.occupancy([body],1,ship(1,0,0))({x:132,y:100}));
 const obstacle={id:2,type:'storage-structure',x:13,y:10};
 assert(!nav.canStep({x:10,y:10},{x:11,y:11},nav.occupancy([obstacle],1,ship(1,10,10))));
});

test('cargo/ranges measure occupied edges instead of station centers',()=>{
 const station={type:'station',x:100,y:100,meta:{stationClass:'planet-station'}};
 const craft=ship(1,105,100,'frigate');
 assert(scale.adjacent(craft,station));assert.equal(scale.gap(craft,station),1);
 assert(!scale.adjacent(ship(1,104,100,'frigate'),station));
});

test('all archetypes fit enlarged celestial envelopes over 100 seeds',()=>{
 for(const key of AVAILABLE)for(let seed=0;seed<100;seed++) {
  const streams=createRngStreams(seed),mod=getArchetypeModule(key);
  const p=applyOrbitalScaffold(mod.plan({sectorId:1,seed,rng:streams.layout,streams}),{archetypeKey:key,streams});
  const stars=(p.suns||[p.sun]).map(s=>({...s,type:'star'}));
  stars.forEach(s=>assert(scale.inBounds(s,100),`${key}: star bounds`));
  if(stars.length>1)assert(scale.gap(stars[0],stars[1])>=100);
  p.planets.forEach((planet,i)=>{
   assert(planet.radius>=20&&planet.radius<=70);
   assert(planet.orbitRadius+planet.satelliteEnvelope<=2399,`${key}: envelope`);
   if(i)assert(planet.orbitRadius-p.planets[i-1].orbitRadius>=planet.satelliteEnvelope+p.planets[i-1].satelliteEnvelope+60);
   stars.forEach(s=>assert(scale.gap({...planet,type:'planet'},s)>60));
   const moons=planet.moons.map(m=>({...m,type:'moon',x:planet.x+Math.cos(m.angle)*m.distance,y:planet.y+Math.sin(m.angle)*m.distance}));
   moons.forEach((m,j)=>{assert(m.distance>=planet.radius+m.radius+30);for(let k=0;k<j;k++)assert(scale.gap(m,moons[k])>=20);});
  });
 }
});

test('every archetype persists collision-free bodies, launch areas, and resources',async()=>{
 for(const key of AVAILABLE) {
  const id=(await run(db,'INSERT INTO sectors(game_id,owner_id,name,archetype) VALUES(?,?,?,?)',[game,user,key,key])).lastID;
  await new SectorGenerationPipeline(id,{seedBase:771,gameId:game,player:{user_id:user,username:'scale'},createStartingObjects:true}).execute();
  await validateBodies(db,id);
  const objects=await query(db,'SELECT * FROM sector_objects WHERE sector_id=?',[id]);
  const station=objects.find(o=>o.type==='station'),craft=objects.find(o=>o.type==='ship');
  assert(scale.adjacent(craft,station));
  const host=objects.find(o=>o.id===station.parent_object_id);
  assert(Math.hypot(station.x-host.x,station.y-host.y)>=scale.anchorDistance(host,station));
  const nodes=await query(db,'SELECT * FROM resource_nodes WHERE sector_id=?',[id]);assert(nodes.length>0);
  nodes.forEach(n=>assert(objects.filter(scale.isSolid).every(o=>!scale.overlaps(n,o))));
 }
});

test('turn movement reserves enlarged destination footprints between ships',async()=>{
 const sector=(await run(db,"INSERT INTO sectors(game_id,name) VALUES(?,'reservation')",[game])).lastID;
 const a=(await run(db,"INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',100,100,?,?)",[sector,user,JSON.stringify(ship(1,0,0).meta)])).lastID;
 const b=(await run(db,"INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',120,100,?,?)",[sector,user,JSON.stringify(ship(1,0,0).meta)])).lastID;
 const n=new NavigationService(db);
 await n.order(a,{x:110,y:100});await n.order(b,{x:111,y:100});
 await n.tickMoves(game,1);
 const rows=await query(db,'SELECT * FROM sector_objects WHERE id IN (?,?)',[a,b]);assert(!scale.overlaps(...rows));
 const statuses=await query(db,'SELECT status FROM movement_orders WHERE object_id IN (?,?)',[a,b]);assert(statuses.some(s=>s.status==='blocked'));
});

test('legacy migration keeps seven planets, relocates overlaps, cancels travel with reason, and is idempotent',async()=>{
 const sector=(await run(db,"INSERT INTO sectors(game_id,name) VALUES(?,'legacy')",[game])).lastID;
 const star=(await run(db,"INSERT INTO sector_objects(sector_id,type,celestial_type,x,y,radius,meta) VALUES(?,'sun','star',2500,2500,30,'{}')",[sector])).lastID;
 for(let i=0;i<7;i++)await run(db,"INSERT INTO sector_objects(sector_id,type,celestial_type,x,y,radius,meta) VALUES(?,'planet','planet',?,2500,12,?)",[sector,2800+i*100,JSON.stringify({planetType:'rocky'})]);
 const craft=(await run(db,"INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',2501,2500,?,?)",[sector,user,JSON.stringify(ship(1,0,0).meta)])).lastID;
 await run(db,"INSERT INTO movement_orders(object_id,destination_x,destination_y,status) VALUES(?,2600,2600,'active')",[craft]);
 const preview=await migrateScales(db,{dryRun:true});assert(preview.some(p=>p.sectorId===sector&&p.planets===7));
 await migrateScales(db);await validateBodies(db,sector);
 assert.equal((await query(db,'SELECT radius FROM sector_objects WHERE id=?',[star]))[0].radius,140);
 const order=(await query(db,'SELECT status,blocked_by FROM movement_orders WHERE object_id=?',[craft]))[0];assert.equal(order.status,'cancelled');assert.match(order.blocked_by,/scale upgraded/);
 assert.deepEqual(await migrateScales(db),[]);
});

test('failed migration rolls back positions and its version marker',async()=>{
 const sector=(await run(db,"INSERT INTO sectors(game_id,name) VALUES(?,'rollback')",[game])).lastID;
 const star=(await run(db,"INSERT INTO sector_objects(sector_id,type,celestial_type,x,y,radius,meta) VALUES(?,'sun','star',2500,2500,30,'{}')",[sector])).lastID;
 await run(db,"CREATE TEMP TRIGGER fail_scale_report BEFORE INSERT ON scale_migrations BEGIN SELECT RAISE(ABORT,'injected migration failure'); END");
 try {
  await assert.rejects(migrateScales(db),/injected migration failure/);
  const row=(await query(db,'SELECT * FROM sector_objects WHERE id=?',[star]))[0];
  assert.equal(row.radius,30);assert.equal(scale.metaOf(row).scaleVersion,undefined);
  assert.equal((await query(db,'SELECT * FROM scale_migrations WHERE sector_id=?',[sector])).length,0);
 } finally { await run(db,'DROP TRIGGER fail_scale_report'); }
});
