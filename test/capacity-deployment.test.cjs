const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const { BuildService } = require('../server/services/game/build.service');
const { CargoManager } = require('../server/services/game/cargo-manager');
const mutationLock = require('../server/services/game/mutation-lock');
const { InfrastructureLifecycleService } = require('../server/services/game/infrastructure-lifecycle.service');
const { MovementService } = require('../server/services/game/movement.service');

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(error) { error ? reject(error) : resolve(this); }));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
const allCells = JSON.stringify(Array.from({ length: 9 }, (_, index) => ({ row: Math.floor(index / 3), col: index % 3 })));

let userId;
let gameId;
let originSectorId;
let destinationSectorId;

async function createShip(sectorId, x, y) {
    const shipId = (await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',?,?,?,'{}')",
        [sectorId, x, y, userId]
    )).lastID;
    await CargoManager.initializeShipCargo(shipId, 20);
    return shipId;
}

async function cargoQuantity(objectId, resourceName) {
    const cargo = await CargoManager.getShipCargo(objectId);
    return Number(cargo.items.find((item) => item.resource_name === resourceName || item.resource_key === resourceName)?.quantity || 0);
}

before(async () => {
    await db.ready;
    userId = (await run("INSERT INTO users(username,password) VALUES('capacity-builder','hash')")).lastID;
    gameId = (await run("INSERT INTO games(name,status) VALUES('capacity-build','active')")).lastID;
    originSectorId = (await run("INSERT INTO sectors(game_id,owner_id,name) VALUES(?,?,'origin')", [gameId, userId])).lastID;
    destinationSectorId = (await run("INSERT INTO sectors(game_id,owner_id,name) VALUES(?,?,'destination')", [gameId, userId])).lastID;
    for (const key of ['storage-box', 'warp-beacon', 'interstellar-gate']) {
        await run(
            'INSERT INTO resource_types(resource_key,resource_name,category,base_size,base_value) VALUES(?,?,?,1,1)',
            [key, key, 'structure']
        );
    }
    await run("INSERT INTO regions(sector_id,region_id,cells_json,health) VALUES(?,'A',?,50)", [originSectorId, allCells]);
    await run("INSERT INTO regions(sector_id,region_id,cells_json,health) VALUES(?,'A',?,50)", [destinationSectorId, allCells]);
});

after(() => new Promise((resolve) => db.close(resolve)));

test('deployment at exact capacity succeeds and over-capacity rejection preserves cargo', async () => {
    await run("INSERT INTO region_capacity_overrides(sector_id,region_id,capacity,reason) VALUES(?,'A',3,'test')", [originSectorId]);
    await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'warp-beacon',300,300,?,?)",
        [originSectorId, userId, JSON.stringify({ structureType: 'warp-beacon', hp: 100 })]
    );
    const firstShip = await createShip(originSectorId, 350, 350);
    await CargoManager.addResourceToCargo(firstShip, 'storage-box', 1, true);
    const accepted = await new BuildService().deployStructure({ shipId: firstShip, userId, structureType: 'storage-box' });
    assert.equal(accepted.success, true);
    assert.equal(await cargoQuantity(firstShip, 'storage-box'), 0);

    const secondShip = await createShip(originSectorId, 400, 400);
    await CargoManager.addResourceToCargo(secondShip, 'storage-box', 1, true);
    const rejected = await new BuildService().deployStructure({ shipId: secondShip, userId, structureType: 'storage-box' });
    assert.equal(rejected.success, false);
    assert.equal(rejected.httpStatus, 409);
    assert.equal(rejected.error, 'regional_capacity_exceeded');
    assert.deepEqual(
        { regionId: rejected.details.regionId, capacity: rejected.details.capacity, currentLoad: rejected.details.currentLoad, requiredLoad: rejected.details.requiredLoad },
        { regionId: 'A', capacity: 3, currentLoad: 3, requiredLoad: 1 }
    );
    assert.equal(await cargoQuantity(secondShip, 'storage-box'), 1);
});

test('destroyed infrastructure frees capacity for a later deployment', async () => {
    await run("UPDATE sector_objects SET meta=json_set(meta,'$.destroyed',1,'$.hp',0) WHERE sector_id=? AND type='warp-beacon'", [originSectorId]);
    const shipId = await createShip(originSectorId, 450, 450);
    await CargoManager.addResourceToCargo(shipId, 'warp-beacon', 1, true);
    const result = await new BuildService().deployStructure({ shipId, userId, structureType: 'warp-beacon' });
    assert.equal(result.success, true);
});

test('paired gate capacity is checked at both endpoints before cargo removal', async () => {
    await run("INSERT OR REPLACE INTO region_capacity_overrides(sector_id,region_id,capacity,reason) VALUES(?,'A',30,'gate-test')", [originSectorId]);
    await run("INSERT OR REPLACE INTO region_capacity_overrides(sector_id,region_id,capacity,reason) VALUES(?,'A',7,'gate-test')", [destinationSectorId]);
    const shipId = await createShip(originSectorId, 800, 800);
    await CargoManager.addResourceToCargo(shipId, 'interstellar-gate', 1, true);
    const beforeOrigin = Number((await get("SELECT COUNT(*) AS count FROM sector_objects WHERE sector_id=? AND type='interstellar-gate'", [originSectorId])).count);
    const result = await new BuildService().deployInterstellarGate({ shipId, userId, destinationSectorId });
    assert.equal(result.success, false);
    assert.equal(result.error, 'regional_capacity_exceeded');
    assert.equal(result.details.sectorId, destinationSectorId);
    assert.equal(result.details.requiredLoad, 8);
    assert.equal(await cargoQuantity(shipId, 'interstellar-gate'), 1);
    assert.equal(Number((await get("SELECT COUNT(*) AS count FROM sector_objects WHERE sector_id=? AND type='interstellar-gate'", [originSectorId])).count), beforeOrigin);
    assert.equal(Number((await get("SELECT COUNT(*) AS count FROM sector_objects WHERE sector_id=? AND type='interstellar-gate'", [destinationSectorId])).count), 0);
});

test('same-sector and cross-game gates are rejected without mutation', async () => {
    const shipId = await createShip(originSectorId, 900, 900);
    await CargoManager.addResourceToCargo(shipId, 'interstellar-gate', 2, true);
    const beforeObjects = Number((await get("SELECT COUNT(*) AS count FROM sector_objects WHERE type='interstellar-gate'")).count);
    const beforeOrigin = await get('SELECT gates_used FROM sectors WHERE id=?', [originSectorId]);

    const sameSector = await new BuildService().deployInterstellarGate({ shipId, userId, destinationSectorId: originSectorId });
    assert.equal(sameSector.success, false);
    assert.equal(sameSector.error, 'same_sector_gate_not_allowed');

    const otherGameId = (await run("INSERT INTO games(name,status) VALUES('capacity-other-game','active')")).lastID;
    const otherSectorId = (await run("INSERT INTO sectors(game_id,owner_id,name) VALUES(?,?,'other-game-sector')", [otherGameId, userId])).lastID;
    const crossGame = await new BuildService().deployInterstellarGate({ shipId, userId, destinationSectorId: otherSectorId });
    assert.equal(crossGame.success, false);
    assert.equal(crossGame.error, 'cross_game_gate_not_allowed');

    assert.equal(await cargoQuantity(shipId, 'interstellar-gate'), 2);
    assert.equal(Number((await get("SELECT COUNT(*) AS count FROM sector_objects WHERE type='interstellar-gate'")).count), beforeObjects);
    assert.equal(Number((await get('SELECT gates_used FROM sectors WHERE id=?', [originSectorId])).gates_used || 0), Number(beforeOrigin.gates_used || 0));
    assert.equal(Number((await get('SELECT gates_used FROM sectors WHERE id=?', [otherSectorId])).gates_used || 0), 0);
});

test('gate pairs reject reverse duplicates and release both slots exactly once when disrupted', async () => {
    await run("UPDATE region_capacity_overrides SET capacity=30 WHERE sector_id IN (?,?) AND region_id='A'", [originSectorId, destinationSectorId]);
    const originShip = await createShip(originSectorId, 1100, 1100);
    await CargoManager.addResourceToCargo(originShip, 'interstellar-gate', 1, true);
    const built = await new BuildService().deployInterstellarGate({ shipId: originShip, userId, destinationSectorId });
    assert.equal(built.success, true);
    const pair = await get('SELECT * FROM interstellar_gate_pairs WHERE pair_id=?', [built.gatePairId]);
    assert.equal(pair.status, 'operational');
    assert.equal(pair.slots_reserved, 1);
    assert.equal(Number((await get('SELECT gates_used FROM sectors WHERE id=?', [originSectorId])).gates_used), 1);
    assert.equal(Number((await get('SELECT gates_used FROM sectors WHERE id=?', [destinationSectorId])).gates_used), 1);

    const destinationShip = await createShip(destinationSectorId, 1200, 1200);
    await CargoManager.addResourceToCargo(destinationShip, 'interstellar-gate', 1, true);
    const reverse = await new BuildService().deployInterstellarGate({ shipId: destinationShip, userId, destinationSectorId: originSectorId });
    assert.equal(reverse.success, false);
    assert.equal(reverse.error, 'connection_already_exists');
    assert.equal(await cargoQuantity(destinationShip, 'interstellar-gate'), 1);

    const lifecycle = new InfrastructureLifecycleService(db);
    assert.equal((await lifecycle.disableObject(built.originGateId, 'test_disabled')).ok, true);
    assert.equal(Number((await get('SELECT gates_used FROM sectors WHERE id=?', [originSectorId])).gates_used), 0);
    assert.equal(Number((await get('SELECT gates_used FROM sectors WHERE id=?', [destinationSectorId])).gates_used), 0);
    assert.equal((await lifecycle.repairObject(built.originGateId)).ok, true);
    assert.equal(Number((await get('SELECT gates_used FROM sectors WHERE id=?', [originSectorId])).gates_used), 1);
    assert.equal(Number((await get('SELECT gates_used FROM sectors WHERE id=?', [destinationSectorId])).gates_used), 1);
    assert.equal((await lifecycle.markDestroyed(built.originGateId, 'test_destroyed')).ok, true);
    assert.equal(Number((await get('SELECT gates_used FROM sectors WHERE id=?', [originSectorId])).gates_used), 0);
    assert.equal(Number((await get('SELECT gates_used FROM sectors WHERE id=?', [destinationSectorId])).gates_used), 0);
    assert.equal((await get('SELECT status FROM interstellar_gate_pairs WHERE pair_id=?', [built.gatePairId])).status, 'disabled');
    const peer = await get('SELECT meta FROM sector_objects WHERE id=?', [built.destGateId]);
    assert.equal(JSON.parse(peer.meta).operational, false);
    assert.equal((await new MovementService().teleportThroughGate({ shipId: destinationShip, gateId: built.destGateId, userId })).error, 'Gate is not operational');

    await lifecycle.markDestroyed(built.originGateId, 'repeat_destroyed');
    assert.equal(Number((await get('SELECT gates_used FROM sectors WHERE id=?', [originSectorId])).gates_used), 0);
    assert.equal(Number((await get('SELECT gates_used FROM sectors WHERE id=?', [destinationSectorId])).gates_used), 0);
    assert.equal((await lifecycle.removeObject(built.destGateId, 'test_removed')).ok, true);
    assert.equal(Number((await get('SELECT COUNT(*) AS count FROM sector_objects WHERE id IN (?,?)', [built.originGateId, built.destGateId])).count), 0);
    assert.equal(await get('SELECT pair_id FROM interstellar_gate_pairs WHERE pair_id=?', [built.gatePairId]), null);
});

test('serialized competing deployments cannot both consume the last capacity unit', async () => {
    const sectorId = (await run("INSERT INTO sectors(game_id,owner_id,name) VALUES(?,?,'race')", [gameId, userId])).lastID;
    await run("INSERT INTO regions(sector_id,region_id,cells_json,health) VALUES(?,'A',?,50)", [sectorId, allCells]);
    await run("INSERT INTO region_capacity_overrides(sector_id,region_id,capacity,reason) VALUES(?,'A',1,'race')", [sectorId]);
    const firstShip = await createShip(sectorId, 300, 300);
    const secondShip = await createShip(sectorId, 500, 500);
    await CargoManager.addResourceToCargo(firstShip, 'storage-box', 1, true);
    await CargoManager.addResourceToCargo(secondShip, 'storage-box', 1, true);
    const service = new BuildService();
    const results = await Promise.all([
        mutationLock.run(() => service.deployStructure({ shipId: firstShip, userId, structureType: 'storage-box' })),
        mutationLock.run(() => service.deployStructure({ shipId: secondShip, userId, structureType: 'storage-box' }))
    ]);
    assert.equal(results.filter((result) => result.success).length, 1);
    assert.equal(results.filter((result) => result.error === 'regional_capacity_exceeded').length, 1);
    assert.equal(Number((await get("SELECT COUNT(*) AS count FROM sector_objects WHERE sector_id=? AND type='storage-structure'", [sectorId])).count), 1);
    assert.equal((await cargoQuantity(firstShip, 'storage-box')) + (await cargoQuantity(secondShip, 'storage-box')), 1);
});
