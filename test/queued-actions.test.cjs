const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const { QueuedActionService } = require('../server/services/game/queued-action.service');

const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function (err) { err ? reject(err) : resolve(this); }));
const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (err, row) => err ? reject(err) : resolve(row)));

let gameId;
let sectorId;
let ownerId;

async function createShip(meta = {}) {
    return (await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',10,10,?,?)",
        [sectorId, ownerId, JSON.stringify({ blueprintId: 'explorer', movementSpeed: 4, warpSpeed: 3, harvestRate: 1, abilities: ['strike_vector', 'dual_light_coilguns'], ...meta })]
    )).lastID;
}

before(async () => {
    await db.ready;
    ownerId = (await run("INSERT INTO users(username,password) VALUES('queue-test-user','hash')")).lastID;
    gameId = (await run("INSERT INTO games(name,status) VALUES('queue-test-game','active')")).lastID;
    await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [gameId, ownerId]);
    await run("INSERT INTO turns(game_id,turn_number,status) VALUES(?,1,'waiting')", [gameId]);
    sectorId = (await run("INSERT INTO sectors(game_id,name) VALUES(?,'queue-test-sector')", [gameId])).lastID;
});

after(() => new Promise(resolve => db.close(resolve)));

test('generic queue appends movement and deduplicates retried submissions', { concurrency: false }, async () => {
    const queue = new QueuedActionService(db);
    const shipId = await createShip();
    const first = await queue.enqueue({
        gameId, shipId, actionType: 'movement.move', payload: { destination: { x: 14, y: 10 } }, clientOrderId: 'move-1'
    });
    const duplicate = await queue.enqueue({
        gameId, shipId, actionType: 'movement.move', payload: { destination: { x: 14, y: 10 } }, clientOrderId: 'move-1'
    });

    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.order.id, first.order.id);

    const second = await queue.enqueue({
        gameId, shipId, actionType: 'movement.move', payload: { destination: { x: 18, y: 10 } }, clientOrderId: 'move-2'
    });
    assert.equal(second.order.sequence_index, first.order.sequence_index + 1);
    const result = await queue.materializeForTurn(gameId, 1);
    assert.deepEqual(result.changedShipIds, [shipId]);
    assert.equal((await get('SELECT status FROM queued_orders WHERE id=?', [first.order.id])).status, 'completed');
    assert.equal((await get('SELECT status FROM queued_orders WHERE id=?', [second.order.id])).status, 'queued');
    await queue.cancel({ gameId, shipId });
    await run('DELETE FROM movement_orders WHERE object_id=?', [shipId]);
});

test('ability actions wait for range and later materialize through the same queue', { concurrency: false }, async () => {
    const queue = new QueuedActionService(db);
    const shipId = await createShip();
    const targetId = (await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',30,10,?,?)",
        [sectorId, ownerId, JSON.stringify({ name: 'target' })]
    )).lastID;
    const order = await queue.enqueue({
        gameId, shipId, actionType: 'combat.ability', payload: { abilityKey: 'strike_vector', targetObjectId: targetId }, clientOrderId: 'ability-1'
    });
    await queue.materializeForTurn(gameId, 2);
    assert.deepEqual(await get('SELECT status,status_reason FROM queued_orders WHERE id=?', [order.order.id]), {
        status: 'waiting', status_reason: 'target_out_of_range'
    });

    await run('UPDATE sector_objects SET x=12,y=10 WHERE id=?', [targetId]);
    await queue.materializeForTurn(gameId, 3);
    assert.equal((await get('SELECT status FROM queued_orders WHERE id=?', [order.order.id])).status, 'completed');
    assert.equal((await get('SELECT source_queue_order_id FROM ability_orders WHERE caster_id=? ORDER BY id DESC LIMIT 1', [shipId])).source_queue_order_id, order.order.id);
});

test('replace removes future actions while preserving action history', { concurrency: false }, async () => {
    const queue = new QueuedActionService(db);
    const shipId = await createShip();
    const old = await queue.enqueue({
        gameId, shipId, actionType: 'movement.move', payload: { destination: { x: 20, y: 10 } }, clientOrderId: 'replace-old'
    });
    const replacement = await queue.replace({
        gameId, shipId, actionType: 'movement.move', payload: { destination: { x: 16, y: 12 } }, clientOrderId: 'replace-new'
    });
    assert.equal((await get('SELECT status,status_reason FROM queued_orders WHERE id=?', [old.order.id])).status, 'cancelled');
    assert.equal((await get('SELECT status FROM queued_orders WHERE id=?', [replacement.order.id])).status, 'queued');
    const history = await queue.list(gameId, shipId, { history: true });
    assert(history.some(row => row.id === old.order.id && row.status === 'cancelled'));
});
