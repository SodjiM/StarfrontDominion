const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const { BuildService, STRUCTURE_BUILD_COSTS } = require('../server/services/game/build.service');
const { CargoManager } = require('../server/services/game/cargo-manager');
const { SHIP_BLUEPRINTS, computeAllRequirements } = require('../server/services/registry/blueprints');
const { createTurnResolver } = require('../server/services/game/turn-resolution.service');
const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function(e) { e ? reject(e) : resolve(this); }));
const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (e, row) => e ? reject(e) : resolve(row)));
const all = (sql, args = []) => new Promise((resolve, reject) => db.all(sql, args, (e, rows) => e ? reject(e) : resolve(rows)));
const service = new BuildService();
let userId, gameId, sectorId, stationId;
before(async () => {
    await db.ready;
    userId = (await run("INSERT INTO users(username,password) VALUES('economy-test','hash')")).lastID;
    gameId = (await run("INSERT INTO games(name,status) VALUES('economy-test','active')")).lastID;
    sectorId = (await run("INSERT INTO sectors(game_id,name) VALUES(?,'test')", [gameId])).lastID;
    stationId = (await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'station',100,100,?,?)", [sectorId,userId,JSON.stringify({cargoCapacity:10000})])).lastID;
});
after(() => new Promise(resolve => db.close(resolve)));
async function cargo() { return all('SELECT resource_type_id,quantity FROM object_cargo WHERE object_id=? ORDER BY resource_type_id', [stationId]); }
async function inject(sqlPattern, task) {
    const original = db.run;
    db.run = function(sql, ...args) {
        if (sqlPattern.test(sql)) { args.at(-1)(new Error('injected write failure')); return this; }
        return original.call(this, sql, ...args);
    };
    try { await task(); } finally { db.run = original; }
}
test('all structure prices charge the catalog amount despite forged client prices', async () => {
    await CargoManager.addResourceToCargo(stationId, 'rock', 100);
    for (const [structureType, cost] of Object.entries(STRUCTURE_BUILD_COSTS)) {
        const before = (await CargoManager.getObjectCargo(stationId)).items.find(i => i.resource_name === 'rock').quantity;
        assert.equal((await service.buildStructure({stationId,userId,structureType,cost:0})).success, true);
        const after = (await CargoManager.getObjectCargo(stationId)).items.find(i => i.resource_name === 'rock').quantity;
        assert.equal(before-after, cost, structureType);
    }
});
test('failed structure insertion restores exact cargo, including a fully consumed rock stack', async () => {
    await run('DELETE FROM object_cargo WHERE object_id=?', [stationId]);
    await CargoManager.addResourceToCargo(stationId,'rock',8);
    const before = await cargo();
    await inject(/INSERT OR REPLACE INTO object_cargo/, async () => {
        await assert.rejects(service.buildStructure({stationId,userId,structureType:'sun-station'}), /injected/);
    });
    assert.deepEqual(await cargo(), before);
});
test('ship insertion failure rolls back nested resource consumption', async () => {
    const blueprint = SHIP_BLUEPRINTS[0];
    const req = computeAllRequirements(blueprint);
    await run('DELETE FROM object_cargo WHERE object_id=?', [stationId]);
    for (const [name, quantity] of Object.entries({...req.core,...req.specialized})) {
        await CargoManager.addResourceToCargo(stationId,name,quantity);
    }
    const before = await cargo();
    const queued = await service.buildShip({stationId,userId,blueprintId:blueprint.id});
    assert.equal(queued.success, true);
    assert.equal((await get("SELECT COUNT(*) n FROM sector_objects WHERE type='ship' AND sector_id=?",[sectorId])).n,0);
    assert.notDeepEqual(await cargo(), before);
    await inject(/INSERT INTO sector_objects/, async () => {
        await assert.rejects(service.completeDueShipBuilds(gameId, queued.completionTurn), /injected/);
    });
    assert.equal((await get('SELECT status FROM ship_builds WHERE id=?',[queued.buildId])).status, 'queued');
    assert.equal((await get("SELECT COUNT(*) n FROM sector_objects WHERE type='ship' AND sector_id=?",[sectorId])).n,0);
    const completed = await service.completeDueShipBuilds(gameId, queued.completionTurn);
    assert.equal(completed.length, 1);
    assert.equal((await get("SELECT COUNT(*) n FROM sector_objects WHERE type='ship' AND sector_id=?",[sectorId])).n,1);
});

test('ship build preview resolves its game, duplicate order IDs are idempotent, and cancellation refunds', async () => {
    const blueprint = SHIP_BLUEPRINTS[1];
    const preview = await service.canBuildShip({ stationId, userId, blueprintId: blueprint.id });
    assert.equal(preview.currentTurn, 1);
    assert.ok(preview.reasons.some(reason => reason.code === 'insufficient_resources'));
    const req = computeAllRequirements(blueprint);
    for (const [name, quantity] of Object.entries({...req.core,...req.specialized})) await CargoManager.addResourceToCargo(stationId,name,quantity);
    const before = await CargoManager.getObjectCargo(stationId);
    const first = await service.buildShip({stationId,userId,blueprintId:blueprint.id,clientOrderId:'duplicate-build-test'});
    const duplicate = await service.buildShip({stationId,userId,blueprintId:blueprint.id,clientOrderId:'duplicate-build-test'});
    assert.equal(first.buildId, duplicate.buildId);
    assert.equal(duplicate.duplicate, true);
    assert.equal((await get('SELECT COUNT(*) n FROM ship_builds WHERE client_order_id=?',['duplicate-build-test'])).n,1);
    const cancelled = await service.cancelShipBuild({buildId:first.buildId,userId});
    assert.equal(cancelled.success, true);
    const after = await CargoManager.getObjectCargo(stationId);
    assert.deepEqual(after.items.map(i => [i.resource_key, i.quantity]).sort(), before.items.map(i => [i.resource_key, i.quantity]).sort());
});
test('insufficient ship materials and invalid station deployment preserve cargo', async () => {
    await run('DELETE FROM object_cargo WHERE object_id=?', [stationId]);
    assert.equal((await service.buildShip({stationId,userId,blueprintId:SHIP_BLUEPRINTS[0].id})).success,false);
    assert.deepEqual(await cargo(),[]);
    const shipId=(await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',400,400,?,'{}')",[sectorId,userId])).lastID;
    await CargoManager.addResourceToCargo(shipId,'sun-station',1,true);
    assert.equal((await service.deployStructure({shipId,userId,structureType:'sun-station'})).success,false);
    assert.equal((await CargoManager.getShipCargo(shipId)).items.find(i=>i.resource_name==='sun-station').quantity,1);
});
test('sun stations use celestial_type anchors and generic deployment cannot place gates', async () => {
    const starId = (await run("INSERT INTO sector_objects(sector_id,type,celestial_type,x,y,radius,meta) VALUES(?,'sun','star',1000,1000,10,'{}')", [sectorId])).lastID;
    const shipId = (await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',1035,1000,?,'{}')", [sectorId,userId])).lastID;
    await CargoManager.addResourceToCargo(shipId, 'sun-station', 1);
    const deployed = await service.deployStructure({shipId,userId,structureType:'sun-station',anchorObjectId:starId});
    assert.equal(deployed.success, true);
    assert.equal((await get('SELECT parent_object_id FROM sector_objects WHERE id=?',[deployed.structureId])).parent_object_id, starId);

    await CargoManager.addResourceToCargo(shipId, 'interstellar-gate', 1);
    const gate = await service.deployStructure({shipId,userId,structureType:'interstellar-gate'});
    assert.equal(gate.success, false);
    assert.equal((await CargoManager.getShipCargo(shipId)).items.find(i => i.resource_name === 'interstellar-gate').quantity, 1);
});
test('second gate insertion failure restores gate cargo and removes the first gate', async () => {
    const shipId=(await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',800,800,?,'{}')",[sectorId,userId])).lastID;
    const destinationSectorId=(await run("INSERT INTO sectors(game_id,name) VALUES(?,'destination')",[gameId])).lastID;
    await CargoManager.addResourceToCargo(shipId,'interstellar-gate',1,true);
    await run(`CREATE TEMP TRIGGER reject_destination_gate BEFORE INSERT ON sector_objects
      WHEN NEW.type='interstellar-gate' AND NEW.sector_id=${destinationSectorId}
      BEGIN SELECT RAISE(ABORT,'injected gate failure'); END`);
    try { await assert.rejects(service.deployInterstellarGate({shipId,userId,destinationSectorId}), /injected gate/); }
    finally { await run('DROP TRIGGER reject_destination_gate'); }
    assert.equal((await get("SELECT COUNT(*) n FROM sector_objects WHERE type='interstellar-gate'")).n,0);
    assert.equal((await CargoManager.getShipCargo(shipId)).items.find(i=>i.resource_name==='interstellar-gate').quantity,1);
    assert.equal((await get('SELECT COALESCE(gates_used,0) n FROM sectors WHERE id=?',[sectorId])).n,0);
});
test('repair runs at full energy and zero regeneration, caps HP, stacks, and expires', async () => {
    const ids=[];
    for (const [energyRegen,hp] of [[5,50],[0,50],[0,99]]) {
        const meta={hp,maxHp:100,energy:100,maxEnergy:100,energyRegen,scanBoostExpires:1,scanRangeMultiplier:2,movementBoostExpires:1,movementBoostMultiplier:2,movementFlatExpires:1,movementFlatBonus:2,evasionExpires:1,evasionBonus:2};
        const id=(await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',?,1200,?,?)",[sectorId,1200+ids.length*100,userId,JSON.stringify(meta)])).lastID;
        ids.push(id);
        for (const pct of [0.1,0.05]) await run("INSERT INTO ship_status_effects(ship_id,effect_key,effect_data,expires_turn) VALUES(?,'repair_over_time',?,1)",[id,JSON.stringify({healPercentPerTurn:pct})]);
    }
    await run("INSERT INTO turns(game_id,turn_number,status) VALUES(?,1,'waiting')",[gameId]);
    const resolve=createTurnResolver({db,io:{to:()=>({emit(){}})},eventBus:{emit(){}},EVENTS:{}});
    await resolve(gameId,1);
    assert.equal((await get('SELECT status FROM turns WHERE game_id=? AND turn_number=1',[gameId])).status,'completed');
    for (let i=0;i<ids.length;i++) {
        const meta=JSON.parse((await get('SELECT meta FROM sector_objects WHERE id=?',[ids[i]])).meta);
        assert.equal(meta.hp,i===2?100:65);
        assert.equal(meta.energy,100);
        for (const key of ['scanBoostExpires','scanRangeMultiplier','movementBoostExpires','movementBoostMultiplier','movementFlatExpires','movementFlatBonus','evasionExpires','evasionBonus']) assert.equal(meta[key],undefined,key);
    }
    await resolve(gameId,2);
    assert.equal(JSON.parse((await get('SELECT meta FROM sector_objects WHERE id=?',[ids[0]])).meta).hp,65);
});
