const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const { RegionInfrastructureService, pressureFor } = require('../server/services/world/region-infrastructure.service');
const { tickRegionHealth } = require('../server/services/world/region-health.tick');
const { cellForPoint, regionAt } = require('../server/services/world/region-geometry');
const { SystemFactsService } = require('../server/services/world/system-facts.service');
const { RegionPressureSnapshotService } = require('../server/services/world/region-pressure-snapshot.service');

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(error) { error ? reject(error) : resolve(this); }));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));

let gameId;
let sectorId;
let ownerId;
let rivalId;
let outsiderId;

before(async () => {
    await db.ready;
    ownerId = (await run("INSERT INTO users(username,password) VALUES('capacity-owner','hash')")).lastID;
    rivalId = (await run("INSERT INTO users(username,password) VALUES('capacity-rival','hash')")).lastID;
    outsiderId = (await run("INSERT INTO users(username,password) VALUES('capacity-outsider','hash')")).lastID;
    gameId = (await run("INSERT INTO games(name,status) VALUES('capacity-test','active')")).lastID;
    await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [gameId, ownerId]);
    await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [gameId, rivalId]);
    sectorId = (await run("INSERT INTO sectors(game_id,name) VALUES(?,'capacity-test')", [gameId])).lastID;
    await run("INSERT INTO regions(sector_id,region_id,cells_json,health) VALUES(?,'A',?,80)", [sectorId, JSON.stringify([{ row: 0, col: 0 }])]);
    await run("INSERT INTO regions(sector_id,region_id,cells_json,health) VALUES(?,'B',?,20)", [sectorId, JSON.stringify([
        { row: 0, col: 1 }, { row: 0, col: 2 },
        { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 },
        { row: 2, col: 0 }, { row: 2, col: 1 }, { row: 2, col: 2 }
    ])]);
});

after(() => new Promise((resolve) => db.close(resolve)));

test('pressure grows nonlinearly and exposes stable capacity states', () => {
    assert.deepEqual(pressureFor(0, 30), {
        capacity: 30, load: 0, remaining: 30, overage: 0, utilization: 0,
        pressureScore: 0, pressureBand: 'idle', atCapacity: false, overCapacity: false
    });
    assert.equal(pressureFor(15, 30).pressureScore, 25);
    assert.equal(pressureFor(30, 30).pressureScore, 100);
    assert.equal(pressureFor(31, 30).pressureBand, 'overloaded');
});

test('region geometry respects configured sector dimensions and clamps boundaries', () => {
    assert.deepEqual(cellForPoint(3000, 1000, { width: 9000, height: 3000 }), { row: 1, col: 1 });
    assert.deepEqual(cellForPoint(9000, 3000, { width: 9000, height: 3000 }), { row: 2, col: 2 });
    assert.deepEqual(cellForPoint(-20, -10, { width: 9000, height: 3000 }), { row: 0, col: 0 });
    assert.equal(regionAt(3000, 1000, [{ region_id: 'C', cells_json: '[{"row":1,"col":1}]' }], { width: 9000, height: 3000 }), 'C');
    assert.equal(regionAt(9000, 1000, [{ region_id: 'C', cells_json: '[{"row":1,"col":2}]' }], { width: 9000, height: 3000 }), null);
});

test('regional status derives shared load from physical deployables and ignores stations', async () => {
    const insertObject = (type, x, y, meta = {}, objectOwnerId = ownerId) => run(
        'INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,?,?,?,?,?)',
        [sectorId, type, x, y, objectOwnerId, JSON.stringify(meta)]
    );
    await insertObject('storage-structure', 100, 100, { structureType: 'storage-box' });
    await insertObject('warp-beacon', 120, 100, { structureType: 'warp-beacon' });
    await insertObject('interstellar-gate', 140, 100, { structureType: 'interstellar-gate' }, rivalId);
    await insertObject('station', 160, 100, { stationClass: 'sun-station' });
    await insertObject('sensor-tower', 3000, 3000, {});
    await insertObject('sensor-tower', 3100, 3000, { disabled: true });
    await insertObject('sensor-tower', 3200, 3000, { destroyed: true, hp: 0 });
    await insertObject('warp-beacon', 6000, 6000, { structureType: 'warp-beacon' });
    await run("INSERT INTO region_capacity_overrides(sector_id,region_id,capacity,reason) VALUES(?,'A',10,'test')", [sectorId]);

    const result = await new RegionInfrastructureService(db).getSectorStatus(sectorId, { includeContributors: true });
    const a = result.regions.find((region) => region.id === 'A');
    const b = result.regions.find((region) => region.id === 'B');
    assert.equal(a.capacity, 10);
    assert.equal(a.load, 11);
    assert.equal(a.objectCount, 3);
    assert.equal(a.pressureScore, 121);
    assert.equal(a.pressureBand, 'overloaded');
    assert.equal(b.capacity, 30);
    assert.equal(b.load, 3);
    assert.equal(b.objectCount, 1);
    assert.equal(result.unassigned.load, 2);
    assert.equal(result.unassigned.objectCount, 1);
    assert.ok(a.contributors.every((item) => item.infrastructureKey !== 'sun-station'));

    const facts = await SystemFactsService.getSectorSummary(sectorId);
    const publicA = facts.regions.find((region) => region.id === 'A').infrastructure;
    assert.equal(publicA.capacity, 10);
    assert.deepEqual(Object.keys(publicA), ['capacity']);
    assert.equal(facts.infrastructure.unassigned, undefined);
    assert.deepEqual(facts.infrastructure.dimensions, { width: 5000, height: 5000 });
});

test('capacity projection aggregates multiple placements targeting the same region', async () => {
    await run("INSERT INTO region_capacity_overrides(sector_id,region_id,capacity,reason) VALUES(?,'B',4,'projection-test')", [sectorId]);
    const check = await new RegionInfrastructureService(db).checkPlacements([
        { sectorId, x: 3000, y: 3000, infrastructureKey: 'storage-box' },
        { sectorId, x: 3020, y: 3000, infrastructureKey: 'storage-box' }
    ]);
    assert.equal(check.ok, false);
    assert.equal(check.error, 'regional_capacity_exceeded');
    assert.equal(check.regionId, 'B');
    assert.equal(check.currentLoad, 3);
    assert.equal(check.previouslyProjectedLoad, 1);
    assert.equal(check.requiredLoad, 1);
    assert.equal(check.projectedLoad, 5);
});

test('viewer facts expose owned and currently visible hostile load without concealed telemetry', async () => {
    const viewerSectorId = (await run("INSERT INTO sectors(game_id,name) VALUES(?,'viewer-status')", [gameId])).lastID;
    await run("INSERT INTO regions(sector_id,region_id,cells_json,health) VALUES(?,'C',?,70)", [viewerSectorId, JSON.stringify(Array.from({ length: 9 }, (_, index) => ({ row: Math.floor(index / 3), col: index % 3 })))]);
    const insert = (type, x, y, objectOwnerId, meta) => run(
        'INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,?,?,?,?,?)',
        [viewerSectorId, type, x, y, objectOwnerId, JSON.stringify(meta)]
    );
    const sensorId = (await insert('sensor-tower', 100, 100, ownerId, { structureType: 'sensor-tower', scanRange: 500, detailedScanRange: 100, hp: 100 })).lastID;
    await insert('storage-structure', 120, 100, ownerId, { structureType: 'storage-box', hp: 100 });
    await insert('interstellar-gate', 200, 100, rivalId, { structureType: 'interstellar-gate', hp: 100 });
    const concealedBeaconId = (await insert('warp-beacon', 3000, 3000, rivalId, { structureType: 'warp-beacon', hp: 100 })).lastID;
    await insert('wormhole', 700, 800, null, { externalSectorId: 999, stability: 12, secret: 'hidden' });
    const laneId = (await run(
        `INSERT INTO lane_edges(sector_id,cls,region_id,polyline_json,width_core,width_shoulder,lane_speed,cap_base,headway,mass_limit,window_json,permits_json,protection_json)
         VALUES(?,'test','C',?,150,200,100,25,3,'all','{}','{}','{}')`,
        [viewerSectorId, JSON.stringify([{ x: 0, y: 0 }, { x: 1000, y: 1000 }])]
    )).lastID;
    await run('INSERT INTO lane_edges_runtime(edge_id,load_cu) VALUES(?,19)', [laneId]);
    const tapId = (await run("INSERT INTO lane_taps(edge_id,x,y,side) VALUES(?,300,300,'left')", [laneId])).lastID;
    await run("INSERT INTO lane_tap_queue(tap_id,cu,enqueued_turn,status) VALUES(?,7,1,'queued')", [tapId]);
    const mineralType = (await new Promise((resolve, reject) => db.get("SELECT id FROM resource_types WHERE category='mineral' LIMIT 1", [], (error, row) => error ? reject(error) : resolve(row)))).id;
    await run('INSERT INTO resource_nodes(sector_id,resource_type_id,x,y,resource_amount,max_resource) VALUES(?,?,?,?,?,?)', [viewerSectorId, mineralType, 900, 900, 50, 50]);
    await run(
        'INSERT INTO object_visibility(game_id,user_id,sector_id,object_id,last_seen_turn,best_visibility_level) VALUES(?,?,?,?,1,2)',
        [gameId, ownerId, viewerSectorId, concealedBeaconId]
    );

    const facts = await SystemFactsService.getSectorSummary(viewerSectorId, ownerId);
    assert.deepEqual(facts.regions[0].infrastructure, {
        capacity: 30,
        ownLoad: 4,
        visibleHostileLoad: 8
    });
    assert.equal(JSON.stringify(facts).includes('objectId'), false);
    assert.equal(JSON.stringify(facts).includes('contributors'), false);
    assert.equal('concealedLoad' in facts.regions[0].infrastructure, false);
    assert.equal('minerals' in facts, false);
    assert.equal('wormholes' in facts, false);
    assert.equal('laneTapsByEdge' in facts, false);
    assert.deepEqual(facts.wormholeEndpoints, [{ x: 700, y: 800 }]);
    assert.deepEqual(Object.keys(facts.lanes[0]).sort(), ['cls', 'id', 'polyline', 'region_id', 'width_core', 'width_shoulder']);

    await run("UPDATE sector_objects SET meta=json_set(meta,'$.destroyed',1,'$.hp',0) WHERE id=?", [sensorId]);
    const withoutDeadSensor = await SystemFactsService.getSectorSummary(viewerSectorId, ownerId);
    assert.deepEqual(withoutDeadSensor.regions[0].infrastructure, {
        capacity: 30,
        ownLoad: 1,
        visibleHostileLoad: 0
    });

    await assert.rejects(
        () => SystemFactsService.getSectorSummary(viewerSectorId, outsiderId),
        (error) => error?.status === 403 && error?.message === 'not_a_game_member'
    );
});

test('pressure snapshots are immutable and facts expose only the latest qualitative band', async () => {
    const snapshotter = new RegionPressureSnapshotService(db);
    const first = await snapshotter.snapshotGame(gameId, 10);
    assert.ok(first.inserted >= 3);
    const before = await new Promise((resolve, reject) => db.get(
        "SELECT infrastructure_load,pressure_band FROM region_pressure_history WHERE sector_id=(SELECT id FROM sectors WHERE name='viewer-status') AND region_id='C' AND turn_number=10",
        [], (error, row) => error ? reject(error) : resolve(row)
    ));
    await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) SELECT id,'storage-structure',1000,1000,?,? FROM sectors WHERE name='viewer-status'", [ownerId, JSON.stringify({ structureType: 'storage-box', hp: 100 })]);
    assert.equal((await snapshotter.snapshotGame(gameId, 10)).inserted, 0);
    const unchanged = await new Promise((resolve, reject) => db.get(
        "SELECT infrastructure_load,pressure_band FROM region_pressure_history WHERE sector_id=(SELECT id FROM sectors WHERE name='viewer-status') AND region_id='C' AND turn_number=10",
        [], (error, row) => error ? reject(error) : resolve(row)
    ));
    assert.deepEqual(unchanged, before);
    await snapshotter.snapshotGame(gameId, 11);
    const viewerSector = await new Promise((resolve, reject) => db.get("SELECT id FROM sectors WHERE name='viewer-status'", [], (error, row) => error ? reject(error) : resolve(row)));
    const facts = await SystemFactsService.getSectorSummary(viewerSector.id, ownerId);
    assert.equal(facts.regions[0].pressure.turn, 11);
    assert.equal(typeof facts.regions[0].pressure.band, 'string');
    assert.equal('load' in facts.regions[0].pressure, false);
    assert.equal('score' in facts.regions[0].pressure, false);
});

test('turn ticks record health without passive mutation', async () => {
    await tickRegionHealth(gameId, 9);
    await tickRegionHealth(gameId, 9);
    const regions = await all('SELECT region_id,health FROM regions WHERE sector_id=? ORDER BY region_id', [sectorId]);
    assert.deepEqual(regions.map((region) => [region.region_id, region.health]), [['A', 80], ['B', 20]]);
    const history = await all('SELECT region_id,turn_number,health FROM region_health_history WHERE sector_id=? ORDER BY region_id', [sectorId]);
    assert.deepEqual(history.map((row) => [row.region_id, row.turn_number, row.health]), [['A', 9, 80], ['B', 9, 20]]);
});
