const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const { GameWorldManager } = require('../server/services/game/game-world.service');
const { MovementService } = require('../server/services/game/movement.service');
const { HarvestingManager } = require('../server/services/world/harvesting-manager');

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(error) {
    error ? reject(error) : resolve(this);
}));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => {
    error ? reject(error) : resolve(row);
}));

let gameId;
let sectorId;
let viewerId;
let rivalId;
let sensorId;
let rivalShipId;

before(async () => {
    await db.ready;
    viewerId = (await run("INSERT INTO users(username,password) VALUES('visibility-viewer','hash')")).lastID;
    rivalId = (await run("INSERT INTO users(username,password) VALUES('visibility-rival','hash')")).lastID;
    gameId = (await run("INSERT INTO games(name,status) VALUES('visibility-test','active')")).lastID;
    await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [gameId, viewerId]);
    await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [gameId, rivalId]);
    sectorId = (await run("INSERT INTO sectors(game_id,name) VALUES(?,'visibility-sector')", [gameId])).lastID;
    await run("INSERT INTO turns(game_id,turn_number,status) VALUES(?,3,'waiting')", [gameId]);
    sensorId = (await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',100,100,?,?)",
        [sectorId, viewerId, JSON.stringify({ scanRange: 50, detailedScanRange: 10, hp: 100 })]
    )).lastID;
    rivalShipId = (await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',400,400,?,?)",
        [sectorId, rivalId, JSON.stringify({ name: 'Hidden Rival', hp: 100 })]
    )).lastID;
    const rock = await get("SELECT id FROM resource_types WHERE resource_key='rock'");
    await run(
        'INSERT INTO resource_nodes(sector_id,resource_type_id,x,y,resource_amount,max_resource) VALUES(?,?,?,?,?,?)',
        [sectorId, rock.id, 110, 100, 50, 50]
    );
    await run(
        'INSERT INTO resource_nodes(sector_id,resource_type_id,x,y,resource_amount,max_resource) VALUES(?,?,?,?,?,?)',
        [sectorId, rock.id, 400, 400, 50, 50]
    );
});

after(() => new Promise(resolve => db.close(resolve)));

test('resource nodes require live operational sensor coverage', async () => {
    const visibleState = await GameWorldManager.getPlayerGameState(gameId, viewerId, sectorId);
    const resources = visibleState.objects.filter(object => object.type === 'resource_node');
    assert.equal(resources.length, 1);
    assert.deepEqual({ x: resources[0].x, y: resources[0].y }, { x: 110, y: 100 });
    assert.ok(resources[0].visibility_level > 0);
    assert.equal(resources[0].meta.alwaysKnown, undefined);
    assert.deepEqual((await HarvestingManager.getNearbyResourceNodes(sensorId, 12)).map(node => [node.x, node.y]), [[110, 100]]);

    await run("UPDATE sector_objects SET meta=json_set(meta,'$.disabled',1) WHERE id=?", [sensorId]);
    const disabledState = await GameWorldManager.getPlayerGameState(gameId, viewerId, sectorId);
    assert.equal(disabledState.objects.some(object => object.type === 'resource_node'), false);
    assert.equal((await GameWorldManager.computeCurrentVisibility(gameId, viewerId, sectorId)).size, 0);
    assert.deepEqual(await HarvestingManager.getNearbyResourceNodes(sensorId, 12), []);

    await run("UPDATE sector_objects SET meta=json_set(meta,'$.disabled',0,'$.destroyed',1,'$.hp',0) WHERE id=?", [sensorId]);
    assert.equal((await GameWorldManager.computeCurrentVisibility(gameId, viewerId, sectorId)).size, 0);
});

test('movement history is authorized by visibility on the exact movement turn', async () => {
    await run(
        `INSERT INTO movement_history(object_id,game_id,sector_id,turn_number,from_x,from_y,to_x,to_y,movement_speed)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [rivalShipId, gameId, sectorId, 1, 390, 400, 395, 400, 5]
    );
    await run(
        `INSERT INTO movement_history(object_id,game_id,sector_id,turn_number,from_x,from_y,to_x,to_y,movement_speed)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [rivalShipId, gameId, sectorId, 2, 395, 400, 400, 400, 5]
    );
    await run(
        `INSERT INTO object_visibility(game_id,user_id,sector_id,object_id,last_seen_turn,best_visibility_level)
         VALUES(?,?,?,?,2,2)`,
        [gameId, viewerId, sectorId, rivalShipId]
    );
    await run(
        `INSERT INTO object_visibility_history(game_id,user_id,sector_id,object_id,turn_number,visibility_level)
         VALUES(?,?,?,?,1,1)`,
        [gameId, viewerId, sectorId, rivalShipId]
    );

    const movement = new MovementService();
    const raw = await movement.fetchMovementHistoryRaw({ gameId, userId: viewerId, turns: 10 });
    assert.deepEqual(raw.rawHistory.map(row => row.turn_number), [1]);
    const trails = await movement.getSectorTrails({ sectorId, sinceTurn: 3, maxAge: 10, userId: viewerId });
    assert.deepEqual(trails.segments.map(segment => segment.turn), [1]);

    await run(
        "UPDATE sector_objects SET x=400,y=400,meta=json_set(meta,'$.disabled',0,'$.destroyed',0,'$.hp',100,'$.scanRange',500) WHERE id=?",
        [sensorId]
    );
    assert.equal((await GameWorldManager.computeCurrentVisibility(gameId, viewerId, sectorId)).has(rivalShipId), true);
    const stillHistorical = await movement.fetchMovementHistoryRaw({ gameId, userId: viewerId, turns: 10 });
    assert.deepEqual(stillHistorical.rawHistory.map(row => row.turn_number), [1]);
});

test('turn visibility recording ignores destroyed sensors and writes exact-turn evidence', async () => {
    await run(
        "UPDATE sector_objects SET x=400,y=400,meta=json_set(meta,'$.destroyed',0,'$.disabled',0,'$.hp',100,'$.scanRange',25) WHERE id=?",
        [sensorId]
    );
    await GameWorldManager.calculatePlayerVision(gameId, viewerId, 3);
    const evidence = await get(
        `SELECT visibility_level FROM object_visibility_history
         WHERE game_id=? AND user_id=? AND sector_id=? AND object_id=? AND turn_number=3`,
        [gameId, viewerId, sectorId, rivalShipId]
    );
    assert.ok(evidence.visibility_level > 0);

    await run("UPDATE sector_objects SET meta=json_set(meta,'$.destroyed',1,'$.hp',0) WHERE id=?", [sensorId]);
    await GameWorldManager.calculatePlayerVision(gameId, viewerId, 4);
    const deadSensorEvidence = await get(
        `SELECT visibility_level FROM object_visibility_history
         WHERE game_id=? AND user_id=? AND sector_id=? AND object_id=? AND turn_number=4`,
        [gameId, viewerId, sectorId, rivalShipId]
    );
    assert.equal(deadSensorEvidence, undefined);
});
