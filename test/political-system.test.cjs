const { test, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const senate = require('../server/services/game/senate.service');

const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function (err) { err ? reject(err) : resolve(this); }));
const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (err, row) => err ? reject(err) : resolve(row)));

let fixtureSequence = 0;

async function createWorld(stationClasses = ['planet-station']) {
    await db.ready;
    fixtureSequence += 1;
    const userId = (await run("INSERT INTO users(username,password) VALUES(?, 'hash')", [`political-test-${Date.now()}-${fixtureSequence}`])).lastID;
    const gameId = (await run("INSERT INTO games(name,status) VALUES(?, 'active')", [`political-test-${fixtureSequence}`])).lastID;
    const sectorId = (await run("INSERT INTO sectors(game_id,owner_id,name) VALUES(?,?,?)", [gameId, userId, `Political Test ${fixtureSequence}`])).lastID;
    await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [gameId, userId]);
    await run("INSERT INTO turns(game_id,turn_number,status) VALUES(?,1,'waiting')", [gameId]);
    const stations = [];
    for (const stationClass of stationClasses) {
        stations.push((await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?, 'station', ?, ?, ?, ?)", [sectorId, stations.length * 10, stations.length * 10, userId, JSON.stringify({ stationClass, name: `${stationClass} ${stations.length + 1}` })])).lastID);
    }
    return { gameId, userId, sectorId, stations };
}

async function advanceTo(gameId, turnNumber) {
    await run("UPDATE turns SET status='completed' WHERE game_id=? AND status='waiting'", [gameId]);
    await run("INSERT INTO turns(game_id,turn_number,status) VALUES(?,?,'waiting')", [gameId, turnNumber]);
}

after(() => new Promise(resolve => db.close(resolve)));

test('a new domain receives one station-bound senator and pilot-based capacity', async () => {
    const world = await createWorld();
    const state = await senate.getState(world.gameId, world.userId, db);

    assert.equal(state.senators.filter(candidate => candidate.status === 'active').length, 1);
    assert.equal(state.senators[0].station.id, world.stations[0]);
    assert.equal(state.senators[0].station.stationClass, 'planet-station');
    assert.equal(state.pilotCapacity, 10);
    assert.equal(state.seatCapacity, 1);
    assert.equal(state.policySlots, 1);
    assert.equal(state.institutionalInfluence, 10);
});

test('a persistent Senate session does not expire or stack across missed cadences', async () => {
    const world = await createWorld();
    await advanceTo(world.gameId, 100);
    const opened = await senate.getState(world.gameId, world.userId, db);
    assert.equal(opened.session.openedTurn, 100);
    assert.equal(opened.candidates.length, 4);
    assert.equal(opened.objectives.length, 1);

    await advanceTo(world.gameId, 120);
    const reloaded = await senate.getState(world.gameId, world.userId, db);
    assert.equal(reloaded.session.id, opened.session.id);
    assert.deepEqual(reloaded.candidates.map(candidate => candidate.id), opened.candidates.map(candidate => candidate.id));

    await advanceTo(world.gameId, 200);
    assert.deepEqual(await senate.openSessionsAtTurn(world.gameId, 200, db), []);
    const stillPending = await senate.getState(world.gameId, world.userId, db);
    assert.equal(stillPending.session.id, opened.session.id);

    await advanceTo(world.gameId, 220);
    const closed = await senate.closeSession(world.gameId, world.userId, 220, db);
    assert.equal(closed.success, true);
    assert.equal(closed.state.session, null);
    await advanceTo(world.gameId, 300);
    const next = await senate.getState(world.gameId, world.userId, db);
    assert.equal(next.session.openedTurn, 300);
    assert.notEqual(next.session.id, opened.session.id);
});

test('appointments enforce station ownership, occupancy, capacity, and replacement rules', async () => {
    const world = await createWorld(['sun-station', 'planet-station', 'planet-station', 'planet-station', 'planet-station']);
    const foreign = await createWorld(['moon-station']);
    await advanceTo(world.gameId, 100);
    let state = await senate.getState(world.gameId, world.userId, db);
    assert.equal(state.seatCapacity, 4);
    assert.equal(state.policySlots, 4);

    const occupied = await senate.selectCandidate(world.gameId, world.userId, state.candidates[0].id, null, world.stations[0], 100, db);
    assert.equal(occupied.error, 'station_already_hosts_senator');
    const foreignStation = await senate.selectCandidate(world.gameId, world.userId, state.candidates[0].id, null, foreign.stations[0], 100, db);
    assert.equal(foreignStation.error, 'invalid_hosting_station');

    for (let index = 0; index < 3; index += 1) {
        const result = await senate.selectCandidate(world.gameId, world.userId, state.candidates[index].id, null, world.stations[index + 1], 100, db);
        assert.equal(result.success, true);
        state = result.state;
    }
    assert.equal(state.senators.filter(candidate => candidate.status === 'active').length, 4);
    assert.equal(new Set(state.senators.filter(candidate => candidate.status === 'active').map(candidate => candidate.station.id)).size, 4);

    const capacityReached = await senate.selectCandidate(world.gameId, world.userId, state.candidates[3].id, null, world.stations[4], 100, db);
    assert.equal(capacityReached.error, 'senate_capacity_reached');
    const retiring = state.senators.find(candidate => candidate.status === 'active');
    const replacement = await senate.selectCandidate(world.gameId, world.userId, state.candidates[3].id, retiring.id, retiring.station.id, 100, db);
    assert.equal(replacement.success, true);
    assert.equal(replacement.state.senators.filter(candidate => candidate.status === 'active').length, 4);
    assert.equal(replacement.state.senators.find(candidate => candidate.id === retiring.id).status, 'retired');
    assert.equal(senate.assignSenator, undefined);
});

test('destroying a hosting station kills its senator and leaves the seat vacant', async () => {
    const world = await createWorld();
    const before = await senate.getState(world.gameId, world.userId, db);
    const senator = before.senators.find(candidate => candidate.status === 'active');

    await run('DELETE FROM sector_objects WHERE id=?', [senator.station.id]);
    const afterLoss = await senate.getState(world.gameId, world.userId, db);
    const persisted = await get('SELECT status,station_id FROM senate_senators WHERE id=?', [senator.id]);
    assert.equal(persisted.status, 'killed');
    assert.equal(persisted.station_id, null);
    assert.equal(afterLoss.senators.find(candidate => candidate.id === senator.id).status, 'killed');
    assert.equal(afterLoss.senators.filter(candidate => candidate.status === 'active').length, 0);
});

test('a senator retires after four completed terms without being silently replaced', async () => {
    const world = await createWorld();
    const initial = await senate.getState(world.gameId, world.userId, db);
    const senatorId = initial.senators[0].id;

    for (const turn of [100, 200, 300, 400]) {
        await advanceTo(world.gameId, turn);
        const session = await senate.getState(world.gameId, world.userId, db);
        assert.equal(session.session.openedTurn, turn);
        const result = await senate.closeSession(world.gameId, world.userId, turn, db);
        assert.equal(result.success, true);
    }

    const finalState = await senate.getState(world.gameId, world.userId, db);
    const retired = finalState.senators.find(candidate => candidate.id === senatorId);
    assert.equal(retired.status, 'retired');
    assert.equal(retired.termNumber, 4);
    assert.equal(finalState.senators.filter(candidate => candidate.status === 'active').length, 0);
});

test('session close awards post-objective political capital once per senator and records the result', async () => {
    const world = await createWorld();
    await advanceTo(world.gameId, 100);
    const opened = await senate.getState(world.gameId, world.userId, db);
    assert.equal(opened.senators[0].happiness, 50);
    await run("UPDATE senator_objectives SET status='completed' WHERE session_id=?", [opened.session.id]);

    const closed = await senate.closeSession(world.gameId, world.userId, 100, db);
    assert.equal(closed.success, true);
    assert.equal(closed.state.politicalCapital, 3);
    assert.equal(closed.state.politicalCapitalLedger.length, 1);
    assert.equal(closed.state.politicalCapitalLedger[0].amount, 3);

    const replay = await require('../server/services/game/political-capital.service')
        .awardCapitalForSession(world.gameId, world.userId, opened.session.id, 100, db);
    assert.equal(replay.award, 0);
    assert.equal((await senate.getState(world.gameId, world.userId, db)).politicalCapital, 3);
    const activity = await get("SELECT COUNT(*) AS count FROM activity_events WHERE game_id=? AND user_id=? AND event_type='senate_session_closed'", [world.gameId, world.userId]);
    assert.equal(activity.count, 1);
});

test('a previously seen civic target accepts one two-capital pending naming proposal', async () => {
    const world = await createWorld();
    await senate.getState(world.gameId, world.userId, db);
    const planetId = (await run("INSERT INTO sector_objects(sector_id,type,celestial_type,x,y,meta) VALUES(?,'planet','planet',40,40,?)", [world.sectorId, JSON.stringify({ name: 'Old World' })])).lastID;
    await run('INSERT INTO object_visibility(game_id,user_id,sector_id,object_id,best_visibility_level) VALUES(?,?,?,?,1)', [world.gameId, world.userId, world.sectorId, planetId]);
    await run('UPDATE player_political_state SET political_capital=2 WHERE game_id=? AND user_id=?', [world.gameId, world.userId]);

    const first = await senate.proposeCivicName(world.gameId, world.userId, {
        targetType: 'planet', targetId: planetId, proposedName: 'Haven', clientRequestId: 'political-integration-name-1'
    }, 1, db);
    assert.equal(first.success, true);
    assert.equal(first.state.politicalCapital, 0);
    assert.equal(first.state.naming.pendingProposals[0].proposedName, 'Haven');
    assert.equal(first.state.naming.proposalCost, 2);

    const retry = await senate.proposeCivicName(world.gameId, world.userId, {
        targetType: 'planet', targetId: planetId, proposedName: 'Changed on retry', clientRequestId: 'political-integration-name-1'
    }, 1, db);
    assert.equal(retry.idempotent, true);
    assert.equal(retry.proposal.proposedName, 'Haven');
    assert.equal((await get("SELECT COUNT(*) AS count FROM activity_events WHERE game_id=? AND user_id=? AND event_type='civic_naming_proposal'", [world.gameId, world.userId])).count, 1);
});

test('tag mandate still gates the existing policy scaffold and persists changes', async () => {
    const world = await createWorld();
    const state = await senate.getState(world.gameId, world.userId, db);
    assert.ok(state.mandate.Centralist >= 7.5);
    const activated = await senate.setPolicy(world.gameId, world.userId, 'centralized_command', true, 1, db);
    assert.equal(activated.success, true);
    assert.equal(activated.state.policies.active.some(policy => policy.key === 'centralized_command'), true);
    const deactivated = await senate.setPolicy(world.gameId, world.userId, 'centralized_command', false, 1, db);
    assert.equal(deactivated.success, true);
    assert.equal(deactivated.state.policies.active.some(policy => policy.key === 'centralized_command'), false);
});
