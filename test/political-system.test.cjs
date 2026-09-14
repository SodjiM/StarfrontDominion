const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const senate = require('../server/services/game/senate.service');

const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function (err) { err ? reject(err) : resolve(this); }));
const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (err, row) => err ? reject(err) : resolve(row)));

let gameId;
let userId;
let stations = [];

before(async () => {
    await db.ready;
    userId = (await run("INSERT INTO users(username,password) VALUES(?, 'hash')", [`political-test-${Date.now()}`])).lastID;
    gameId = (await run("INSERT INTO games(name,status) VALUES('political-test','active')")).lastID;
    const sectorId = (await run("INSERT INTO sectors(game_id,owner_id,name) VALUES(?,?, 'Political Test')", [gameId, userId])).lastID;
    await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [gameId, userId]);
    await run("INSERT INTO turns(game_id,turn_number,status) VALUES(?,1,'waiting')", [gameId]);
    for (const stationClass of ['sun-station', 'planet-station', 'moon-station']) {
        stations.push((await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?, 'station', ?, ?, ?, ?)", [sectorId, stations.length * 10, stations.length * 10, userId, JSON.stringify({ stationClass, name: `${stationClass} test` })])).lastID);
    }
});

after(() => new Promise(resolve => db.close(resolve)));

test('initial political state assigns one senator to a qualifying station', async () => {
    const state = await senate.getState(gameId, userId, db);
    assert.equal(state.senators.filter(s => s.status === 'active').length, 1);
    assert.equal(state.senators[0].station.stationClass, 'sun-station');
    assert.equal(state.policySlots, 5);
    assert.equal(state.institutionalInfluence, 35);
});

test('Senate session opens every 100 turns and supports station-backed appointment', async () => {
    await run("UPDATE turns SET status='completed' WHERE game_id=? AND turn_number=1", [gameId]);
    await run("INSERT INTO turns(game_id,turn_number,status) VALUES(?,100,'waiting')", [gameId]);
    const state = await senate.getState(gameId, userId, db);
    assert.equal(state.session.openedTurn, 100);
    assert.equal(state.candidates.length, 5);
    const initialSenator = state.senators.find(senator => senator.status === 'active');
    await senate.recordObjectiveProgress(gameId, userId, 'production', 1, 100, db);
    const progressed = await senate.getState(gameId, userId, db);
    assert.equal(progressed.objectives.find(objective => objective.senatorId === initialSenator.id).progress.current, 1);
    const candidate = state.candidates[0];
    const result = await senate.selectCandidate(gameId, userId, candidate.id, null, stations[1], 100, db);
    assert.equal(result.success, true);
    const afterSelect = result.state.senators.filter(s => s.status === 'active');
    assert.equal(afterSelect.length, 2);
    assert.equal(new Set(afterSelect.map(s => s.station.id)).size, 2);
});

test('Senate reassignment is session-bound and station destruction kills its senator', async () => {
    const state = await senate.getState(gameId, userId, db);
    const senator = state.senators.find(s => s.status === 'active' && s.station.stationClass === 'sun-station');
    await senate.closeSession(gameId, userId, 100, db);
    const reassignment = await senate.assignSenator(gameId, userId, senator.id, stations[2], 101, db);
    assert.equal(reassignment.success, false);
    assert.equal(reassignment.error, 'no_open_senate_session');
    await run('DELETE FROM sector_objects WHERE id=?', [senator.station.id]);
    const afterLoss = await senate.getState(gameId, userId, db);
    const killed = await get("SELECT status,station_id FROM senate_senators WHERE id=?", [senator.id]);
    assert.equal(killed.status, 'killed');
    assert.equal(killed.station_id, null);
    assert.equal(afterLoss.senators.find(s => s.id === senator.id).status, 'killed');
});

test('tag mandate gates policy activation and policy state persists', async () => {
    const state = await senate.getState(gameId, userId, db);
    const centralist = state.mandate.Centralist;
    assert.ok(centralist >= 7.5, `expected enough Centralist mandate, got ${centralist}`);
    const activated = await senate.setPolicy(gameId, userId, 'centralized_command', true, 100, db);
    assert.equal(activated.success, true);
    assert.equal(activated.state.policies.active.some(policy => policy.key === 'centralized_command'), true);
    const deactivated = await senate.setPolicy(gameId, userId, 'centralized_command', false, 100, db);
    assert.equal(deactivated.success, true);
    assert.equal(deactivated.state.policies.active.some(policy => policy.key === 'centralized_command'), false);
});
