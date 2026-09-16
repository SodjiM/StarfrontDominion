const { test, before } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const activity = require('../server/services/game/activity.service');

const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function (e) { e ? reject(e) : resolve(this); }));
const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (e, row) => e ? reject(e) : resolve(row)));

let game, alice, bob, sector, ship;
before(async () => {
    await db.ready;
    alice = (await run("INSERT INTO users(username,password) VALUES('activity-alice','x')")).lastID;
    bob = (await run("INSERT INTO users(username,password) VALUES('activity-bob','x')")).lastID;
    game = (await run("INSERT INTO games(name,status) VALUES('activity-game','active')")).lastID;
    sector = (await run('INSERT INTO sectors(game_id,name) VALUES(?,?)', [game, 'activity-sector'])).lastID;
    await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [game, alice]);
    await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [game, bob]);
    ship = (await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',10,10,?,?)", [sector, alice, '{}'])).lastID;
});

test('activity pages are player isolated and ack is monotonic', async () => {
    const own = await activity.append(db, { gameId: game, userId: alice, turnNumber: 1, eventType: 'arrival', summary: 'Own arrival', objectId: ship });
    const hidden = await activity.append(db, { gameId: game, userId: bob, turnNumber: 1, eventType: 'combat', summary: 'Bob private event' });
    const page = await activity.open(db, { gameId: game, userId: alice, limit: 10 });
    assert.deepEqual(page.events.map(x => x.id), [own]);
    assert.equal(page.events.some(x => x.id === hidden), false);
    assert.equal((await activity.ack(db, { gameId: game, userId: alice, boundary: page.pageBoundary })).cursor, own);
    assert.equal((await activity.ack(db, { gameId: game, userId: alice, boundary: 0 })).cursor, own);
    await assert.rejects(() => activity.ack(db, { gameId: game, userId: bob, boundary: own }), /invalid_cursor/);
});

test('snapshot paging excludes later inserts and does not skip older unread rows', async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await activity.append(db, { gameId: game, userId: alice, turnNumber: 2, eventType: 'x', summary: `Event ${i}` }));
    const first = await activity.open(db, { gameId: game, userId: alice, limit: 2, afterId: ids[0] - 1 });
    const later = await activity.append(db, { gameId: game, userId: alice, turnNumber: 3, eventType: 'x', summary: 'Later event' });
    assert.deepEqual(first.events.map(x => x.id), ids.slice(0, 2));
    assert.equal(first.hasMore, true);
    const second = await activity.open(db, { gameId: game, userId: alice, limit: 2, afterId: first.pageBoundary, snapshotBoundary: first.snapshotBoundary });
    assert.deepEqual(second.events.map(x => x.id), [ids[2]]);
    assert.equal(second.events.some(x => x.id === later), false);
    assert.equal((await activity.ack(db, { gameId: game, userId: alice, boundary: first.pageBoundary })).cursor >= first.pageBoundary, true);
});

test('materialization preserves a destroyed owned ship and is idempotent', async () => {
    await run(`CREATE TABLE IF NOT EXISTS turn_harvest_events (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER, turn_number INTEGER, ship_id INTEGER, resource_type_id INTEGER, amount INTEGER)`);
    const doomed = (await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',20,20,?,?)", [sector, alice, '{}'])).lastID;
    const ownership = await activity.captureOwnership(db, game);
    await run('DELETE FROM sector_objects WHERE id=?', [doomed]);
    await activity.materializeTurn(db, game, 77, { ownership, movementResults: [] });
    const loss = await get("SELECT * FROM activity_events WHERE game_id=? AND user_id=? AND turn_number=77 AND event_type='loss'", [game, alice]);
    assert(loss);
    const before = (await get("SELECT COUNT(*) AS count FROM activity_events WHERE game_id=? AND user_id=? AND turn_number=77", [game, alice])).count;
    await activity.materializeTurn(db, game, 77, { ownership, movementResults: [] });
    const after = (await get("SELECT COUNT(*) AS count FROM activity_events WHERE game_id=? AND user_id=? AND turn_number=77", [game, alice])).count;
    assert.equal(after, before);
});

test('legacy combat report sanitizer redacts unseen opponent details', () => {
    const row = { id: 9, game_id: game, turn_number: 4, attacker_id: 501, target_id: 502,
        event_type: 'attack', summary: 'A combat event',
        data: JSON.stringify({ damage: 7, weaponKey: 'laser', x: 999, y: 888, targetName: 'secret' }), created_at: 'now' };
    const hidden = activity.sanitizeCombatLogRow(row, { attackerVisible: true, targetVisible: false });
    assert.equal(hidden.attacker_id, 501);
    assert.equal(hidden.target_id, null);
    assert.equal(hidden.summary, 'Combat engagement recorded');
    assert.deepEqual(JSON.parse(hidden.data), { damage: 7 });
    assert.equal(hidden.data.includes('secret'), false);
    assert.equal(hidden.data.includes('999'), false);
    const known = activity.sanitizeCombatLogRow(row, { attackerVisible: false, targetVisible: true });
    assert.equal(known.attacker_id, null);
    assert.equal(known.target_id, 502);
});
