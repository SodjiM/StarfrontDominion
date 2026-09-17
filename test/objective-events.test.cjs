const { test, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const senate = require('../server/services/game/senate.service');
const { ObjectiveEventService } = require('../server/services/game/objective-events.service');

const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function(error) { error ? reject(error) : resolve(this); }));
const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (error, row) => error ? reject(error) : resolve(row)));
let sequence = 0;

async function createWorld(stationClass) {
    await db.ready;
    sequence += 1;
    const userId = (await run("INSERT INTO users(username,password) VALUES(?, 'hash')", [`objective-test-${Date.now()}-${sequence}`])).lastID;
    const gameId = (await run("INSERT INTO games(name,status) VALUES(?, 'active')", [`objective-game-${sequence}`])).lastID;
    const sectorId = (await run('INSERT INTO sectors(game_id,owner_id,name) VALUES(?,?,?)', [gameId, userId, `Objective System ${sequence}`])).lastID;
    await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [gameId, userId]);
    await run("INSERT INTO turns(game_id,turn_number,status) VALUES(?,1,'completed')", [gameId]);
    await run("INSERT INTO turns(game_id,turn_number,status) VALUES(?,100,'waiting')", [gameId]);
    const stationId = (await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'station',10,10,?,?)", [sectorId, userId, JSON.stringify({ stationClass, name: `${stationClass} seat` })])).lastID;
    return { gameId, userId, sectorId, stationId };
}

async function configureSenator(world, tags, definitionKey) {
    await senate.ensurePoliticalState(world.gameId, world.userId, 1, db);
    await run("UPDATE senate_senators SET tags_json=?,definition_key=? WHERE game_id=? AND user_id=? AND status='active'", [JSON.stringify(tags), definitionKey, world.gameId, world.userId]);
    return senate.getState(world.gameId, world.userId, db);
}

function activeObjective(state) {
    return state.objectives.find(objective => objective.status === 'active') || state.objectives[0];
}

after(() => new Promise(resolve => db.close(resolve)));

test('economic build records advance only the objective assigned to that station and replay once', async () => {
    const world = await createWorld('planet-station');
    const opened = await configureSenator(world, ['Centralist', 'Industrialist'], 'centralist_administrator');
    assert.equal(activeObjective(opened).key, 'industrial_presence');
    const otherStationId = (await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'station',20,20,?,?)", [world.sectorId, world.userId, JSON.stringify({ stationClass: 'planet-station', name: 'Other station' })])).lastID;

    await run("INSERT INTO turn_build_events(game_id,turn_number,user_id,object_id,kind,name) VALUES(?,?,?,?, 'structure','Remote Works')", [world.gameId, 100, world.userId, otherStationId]);
    const service = new ObjectiveEventService(db);
    assert.equal((await service.processTurn(world.gameId, 100)).applied.length, 0);

    await run("INSERT INTO turn_build_events(game_id,turn_number,user_id,object_id,kind,name) VALUES(?,?,?,?, 'structure','Seat Works')", [world.gameId, 101, world.userId, world.stationId]);
    assert.equal((await service.processTurn(world.gameId, 101)).applied.length, 1);
    assert.equal((await service.processTurn(world.gameId, 101)).applied.length, 0);

    const state = await senate.getState(world.gameId, world.userId, db);
    const objective = state.objectives[0];
    assert.equal(objective.status, 'completed');
    assert.equal(objective.progress.current, 1);
    assert.equal(objective.events.length, 1);
    assert.match(objective.events[0].summary, /Seat Works/);
    assert.equal((await get('SELECT COUNT(*) AS count FROM senator_objective_events WHERE objective_id=?', [objective.id])).count, 1);
    const closed = await senate.closeSession(world.gameId, world.userId, 101, db);
    assert.equal(closed.success, true);
    assert.equal(closed.state.senators.find(candidate => candidate.status === 'active').happiness, 60);
    assert.equal((await senate.closeSession(world.gameId, world.userId, 101, db)).error, 'no_open_senate_session');
    assert.equal((await get("SELECT happiness FROM senate_senators WHERE game_id=? AND user_id=? AND status='active'", [world.gameId, world.userId])).happiness, 60);
});

test('a failed progress update rolls back its evidence so the authoritative event can retry', async () => {
    const world = await createWorld('planet-station');
    const opened = await configureSenator(world, ['Centralist', 'Industrialist'], 'centralist_administrator');
    const objective = opened.objectives[0];
    const service = new ObjectiveEventService(db);
    const event = {
        gameId: world.gameId, userId: world.userId, turnNumber: 100,
        sourceType: 'turn_build', sourceId: 'retry-proof', type: 'production',
        stationId: world.stationId, sectorId: world.sectorId, summary: 'Retry-proof construction completed.'
    };

    const originalRun = db.run;
    let injectFailure = true;
    db.run = function(sql, ...args) {
        if (injectFailure && /UPDATE senator_objectives/.test(String(sql))) {
            injectFailure = false;
            const callback = args[args.length - 1];
            queueMicrotask(() => callback.call({}, new Error('injected objective update failure')));
            return this;
        }
        return originalRun.call(this, sql, ...args);
    };
    try {
        await assert.rejects(() => service.recordEvent(event), /injected objective update failure/);
    } finally {
        db.run = originalRun;
    }

    assert.equal((await get('SELECT COUNT(*) AS count FROM senator_objective_events WHERE objective_id=?', [objective.id])).count, 0);
    assert.equal(JSON.parse((await get('SELECT progress_json FROM senator_objectives WHERE id=?', [objective.id])).progress_json).current, 0);
    assert.equal((await service.recordEvent(event)).applied.length, 1);
});

test('authoritative movement records advance a technocrat objective only in its assigned system', async () => {
    const world = await createWorld('sun-station');
    const opened = await configureSenator(world, ['Centralist', 'Technocrat'], 'centralist_technocrat');
    assert.equal(activeObjective(opened).key, 'connected_administration');
    const otherSectorId = (await run('INSERT INTO sectors(game_id,owner_id,name) VALUES(?,?,?)', [world.gameId, world.userId, 'Other System'])).lastID;
    const wrongShip = (await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',1,1,?,'{}')", [otherSectorId, world.userId])).lastID;
    await run('INSERT INTO movement_history(object_id,game_id,sector_id,turn_number,from_x,from_y,to_x,to_y) VALUES(?,?,?,?,1,1,2,1)', [wrongShip, world.gameId, otherSectorId, 100]);
    const service = new ObjectiveEventService(db);
    assert.equal((await service.processTurn(world.gameId, 100)).applied.length, 0);

    const localShip = (await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',1,1,?,'{}')", [world.sectorId, world.userId])).lastID;
    await run('INSERT INTO movement_history(object_id,game_id,sector_id,turn_number,from_x,from_y,to_x,to_y) VALUES(?,?,?,?,1,1,2,1)', [localShip, world.gameId, world.sectorId, 101]);
    assert.equal((await service.processTurn(world.gameId, 101)).applied.length, 1);
    const state = await senate.getState(world.gameId, world.userId, db);
    assert.equal(state.objectives[0].status, 'completed');
    assert.equal(state.objectives[0].events[0].eventType, 'movement');
});

test('successful combat logs advance a frontier objective without counting failed or off-system attacks', async () => {
    const world = await createWorld('moon-station');
    const opened = await configureSenator(world, ['Raider-Aligned', 'Security'], 'frontier_raider');
    assert.equal(activeObjective(opened).key, 'frontier_presence');
    const otherSectorId = (await run('INSERT INTO sectors(game_id,owner_id,name) VALUES(?,?,?)', [world.gameId, world.userId, 'Distant Front'])).lastID;
    const distantShip = (await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',1,1,?,'{}')", [otherSectorId, world.userId])).lastID;
    await run("INSERT INTO combat_logs(game_id,turn_number,attacker_id,event_type,summary,data) VALUES(?,?,?,'attack','Hit',?)", [world.gameId, 100, distantShip, JSON.stringify({ damage: 5 })]);
    const service = new ObjectiveEventService(db);
    assert.equal((await service.processTurn(world.gameId, 100)).applied.length, 0);

    const localShip = (await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',1,1,?,'{}')", [world.sectorId, world.userId])).lastID;
    await run("INSERT INTO combat_logs(game_id,turn_number,attacker_id,event_type,summary,data) VALUES(?,?,?,'attack','Miss','{}')", [world.gameId, 101, localShip]);
    assert.equal((await service.processTurn(world.gameId, 101)).applied.length, 0);
    await run("INSERT INTO combat_logs(game_id,turn_number,attacker_id,event_type,summary,data) VALUES(?,?,?,'attack','Hit',?)", [world.gameId, 102, localShip, JSON.stringify({ damage: 8 })]);
    assert.equal((await service.processTurn(world.gameId, 102)).applied.length, 1);
    assert.equal((await service.processTurn(world.gameId, 102)).applied.length, 0);

    const state = await senate.getState(world.gameId, world.userId, db);
    assert.equal(state.objectives[0].status, 'completed');
    assert.equal(state.objectives[0].events.length, 1);
    assert.equal(state.objectives[0].events[0].eventType, 'combat');
});
