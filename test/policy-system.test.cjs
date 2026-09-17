const { test, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const senate = require('../server/services/game/senate.service');
const policy = require('../server/services/game/policy.service');
const { BuildService } = require('../server/services/game/build.service');
const { CargoManager } = require('../server/services/game/cargo-manager');
const { HarvestingManager } = require('../server/services/world/harvesting-manager');
const { SHIP_BLUEPRINTS, computeAllRequirements } = require('../server/services/registry/blueprints');

const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function (error) { error ? reject(error) : resolve(this); }));
const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (error, row) => error ? reject(error) : resolve(row)));

let sequence = 0;

async function createWorld() {
    await db.ready;
    sequence += 1;
    const userId = (await run("INSERT INTO users(username,password) VALUES(?, 'hash')", [`policy-test-${sequence}`])).lastID;
    const gameId = (await run("INSERT INTO games(name,status) VALUES(?, 'active')", [`Policy Test ${sequence}`])).lastID;
    const sectorId = (await run("INSERT INTO sectors(game_id,owner_id,name) VALUES(?,?,?)", [gameId, userId, `Policy Sector ${sequence}`])).lastID;
    await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [gameId, userId]);
    await run("INSERT INTO turns(game_id,turn_number,status) VALUES(?,1,'waiting')", [gameId]);
    const stationId = (await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'station',100,100,?,?)",
        [sectorId, userId, JSON.stringify({ stationClass: 'planet-station', cargoCapacity: 10000 })]
    )).lastID;
    const state = await senate.getState(gameId, userId, db);
    return { gameId, userId, sectorId, stationId, senatorId: state.senators.find(candidate => candidate.status === 'active').id };
}

async function configureSenator(world, tags, happiness = 100, termNumber = 1) {
    await run('UPDATE senate_senators SET tags_json=?,happiness=?,term_number=? WHERE id=?', [JSON.stringify(tags), happiness, termNumber, world.senatorId]);
    await senate.recalculatePoliticalState(world.gameId, world.userId, 1, db);
}

after(() => new Promise(resolve => db.close(resolve)));

test('policy activation enforces requirements and slots while transitions remain idempotent and historical', async () => {
    assert.equal(policy.POLICY_DEFINITIONS.some(card => 'requiredSenators' in card || 'minHappiness' in card), false);
    const world = await createWorld();
    let state = await senate.getState(world.gameId, world.userId, db);
    assert.equal(state.policies.available.find(card => card.key === 'centralized_command').status, 'eligible');
    assert.equal(state.policies.available.find(card => card.key === 'industrial_charter').status, 'locked');

    const locked = await senate.setPolicy(world.gameId, world.userId, 'industrial_charter', true, 1, db);
    assert.equal(locked.success, false);
    assert.equal(locked.error, 'policy_mandate_requirement_not_met');

    await configureSenator(world, ['Centralist', 'Industrialist'], 100);
    const activated = await senate.setPolicy(world.gameId, world.userId, 'centralized_command', true, 1, db);
    assert.equal(activated.success, true);
    const duplicate = await senate.setPolicy(world.gameId, world.userId, 'centralized_command', true, 9, db);
    assert.equal(duplicate.success, true);
    assert.equal(duplicate.state.policies.active.find(card => card.key === 'centralized_command').activatedTurn, 1);
    assert.equal((await get("SELECT COUNT(*) AS count FROM player_policy_history WHERE game_id=? AND user_id=? AND policy_key=? AND event_type='activation'", [world.gameId, world.userId, 'centralized_command'])).count, 1);

    const full = await senate.setPolicy(world.gameId, world.userId, 'industrial_charter', true, 1, db);
    assert.equal(full.success, false);
    assert.equal(full.error, 'policy_slots_full');

    await senate.setPolicy(world.gameId, world.userId, 'centralized_command', false, 2, db);
    await senate.setPolicy(world.gameId, world.userId, 'centralized_command', false, 8, db);
    assert.equal((await get('SELECT COUNT(*) AS count FROM player_policy_history WHERE game_id=? AND user_id=? AND policy_key=?', [world.gameId, world.userId, 'centralized_command'])).count, 2);
    const persisted = await get('SELECT active,activated_turn FROM player_active_policies WHERE game_id=? AND user_id=? AND policy_key=?', [world.gameId, world.userId, 'centralized_command']);
    assert.equal(persisted.active, 0);
    assert.equal(persisted.activated_turn, 1);

    await run(`CREATE TEMP TRIGGER reject_policy_history BEFORE INSERT ON player_policy_history
        BEGIN SELECT RAISE(ABORT, 'injected policy history failure'); END`);
    try {
        await assert.rejects(senate.setPolicy(world.gameId, world.userId, 'industrial_charter', true, 3, db), /injected policy history failure/);
    } finally {
        await run('DROP TRIGGER reject_policy_history');
    }
    assert.equal((await get("SELECT COUNT(*) AS count FROM player_active_policies WHERE game_id=? AND user_id=? AND policy_key='industrial_charter' AND active=1", [world.gameId, world.userId])).count, 0);

    await configureSenator(world, ['Centralist'], 30, 4);
    const termStrengthOvercomesHappiness = await senate.setPolicy(world.gameId, world.userId, 'centralized_command', true, 10, db);
    assert.equal(termStrengthOvercomesHappiness.success, true);
    assert.equal(termStrengthOvercomesHappiness.state.policies.available.find(card => card.key === 'centralized_command').status, 'active');
});

test('an active policy becomes at risk and suspends its modifiers when mandate falls or its senator is lost', async () => {
    const world = await createWorld();
    await configureSenator(world, ['Industrialist'], 100);
    assert.equal((await senate.setPolicy(world.gameId, world.userId, 'industrial_charter', true, 1, db)).success, true);
    assert.equal((await policy.getActivePolicyModifiers(world.gameId, world.userId, db)).harvestYieldMultiplier, 0.1);

    await configureSenator(world, ['Industrialist'], 0);
    let state = await senate.getState(world.gameId, world.userId, db);
    const atRisk = state.policies.available.find(card => card.key === 'industrial_charter');
    assert.equal(atRisk.status, 'at_risk');
    assert.equal(atRisk.effectsActive, false);
    assert.equal(state.policies.active.some(card => card.key === 'industrial_charter'), true);
    assert.deepEqual(await policy.getActivePolicyModifiers(world.gameId, world.userId, db), {});

    await configureSenator(world, ['Centralist'], 100);
    const blockedByAtRiskSlot = await senate.setPolicy(world.gameId, world.userId, 'centralized_command', true, 2, db);
    assert.equal(blockedByAtRiskSlot.error, 'policy_slots_full');
    const deactivatedAtRisk = await senate.setPolicy(world.gameId, world.userId, 'industrial_charter', false, 2, db);
    assert.equal(deactivatedAtRisk.success, true);
    assert.equal((await senate.setPolicy(world.gameId, world.userId, 'centralized_command', true, 2, db)).success, true);
    await senate.setPolicy(world.gameId, world.userId, 'centralized_command', false, 3, db);

    await configureSenator(world, ['Industrialist'], 100);
    assert.equal((await senate.setPolicy(world.gameId, world.userId, 'industrial_charter', true, 3, db)).success, true);
    assert.equal((await senate.setPolicy(world.gameId, world.userId, 'industrial_charter', true, 4, db)).success, true);
    assert.equal((await get("SELECT COUNT(*) AS count FROM player_policy_history WHERE game_id=? AND user_id=? AND policy_key='industrial_charter' AND event_type='activation'", [world.gameId, world.userId])).count, 2);

    await run('DELETE FROM sector_objects WHERE id=?', [world.stationId]);
    state = await senate.getState(world.gameId, world.userId, db);
    assert.equal(state.policies.available.find(card => card.key === 'industrial_charter').status, 'at_risk');
    assert.deepEqual(await policy.getActivePolicyModifiers(world.gameId, world.userId, db), {});
});

test('losing policy capacity suspends the newest overflow policy without deleting the loadout', async () => {
    const world = await createWorld();
    const supportStationId = (await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'station',140,100,?,?)",
        [world.sectorId, world.userId, JSON.stringify({ stationClass: 'planet-station' })]
    )).lastID;
    await configureSenator(world, ['Centralist', 'Industrialist'], 100);
    let state = await senate.getState(world.gameId, world.userId, db);
    assert.equal(state.policySlots, 2);
    await senate.setPolicy(world.gameId, world.userId, 'industrial_charter', true, 1, db);
    await senate.setPolicy(world.gameId, world.userId, 'centralized_command', true, 1, db);

    await run('DELETE FROM sector_objects WHERE id=?', [supportStationId]);
    state = await senate.getState(world.gameId, world.userId, db);
    assert.equal(state.policySlots, 1);
    assert.equal(state.policies.available.find(card => card.key === 'industrial_charter').status, 'active');
    const overflow = state.policies.available.find(card => card.key === 'centralized_command');
    assert.equal(overflow.status, 'at_risk');
    assert.equal(overflow.capacityEligible, false);
    assert.equal(state.policies.active.length, 2);
    assert.equal((await policy.getActivePolicyModifiers(world.gameId, world.userId, db)).harvestYieldMultiplier, 0.1);
});

test('Industrial Charter increases authoritative harvesting yield', async () => {
    const world = await createWorld();
    await configureSenator(world, ['Industrialist'], 100);
    await senate.setPolicy(world.gameId, world.userId, 'industrial_charter', true, 1, db);
    const resourceType = await get("SELECT id FROM resource_types WHERE resource_key='rock'");

    async function harvestOnce(x) {
        const shipId = (await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',?,200,?,?)", [world.sectorId, x, world.userId, JSON.stringify({ cargoCapacity: 100 })])).lastID;
        const nodeId = (await run('INSERT INTO resource_nodes(sector_id,resource_type_id,x,y,resource_amount,max_resource) VALUES(?,?,?,?,100,100)', [world.sectorId, resourceType.id, x, 200])).lastID;
        assert.equal((await HarvestingManager.startHarvesting(shipId, nodeId, 1, 10)).success, true);
        await HarvestingManager.processHarvestingForTurn(world.gameId, x);
        const event = await get('SELECT amount FROM turn_harvest_events WHERE game_id=? AND ship_id=? ORDER BY id DESC LIMIT 1', [world.gameId, shipId]);
        await HarvestingManager.stopHarvesting(shipId);
        return event.amount;
    }

    assert.equal(await harvestOnce(220), 11);
    await senate.setPolicy(world.gameId, world.userId, 'industrial_charter', false, 2, db);
    assert.equal(await harvestOnce(240), 10);
});

test('Technocratic Works shortens the authoritative queued ship build', async () => {
    const world = await createWorld();
    await configureSenator(world, ['Technocrat'], 100);
    await senate.setPolicy(world.gameId, world.userId, 'technocratic_works', true, 1, db);
    const blueprint = SHIP_BLUEPRINTS[0];
    const requirements = computeAllRequirements(blueprint);
    for (const [resource, quantity] of Object.entries({ ...requirements.core, ...requirements.specialized })) {
        await CargoManager.addResourceToCargo(world.stationId, resource, quantity * 2);
    }

    const service = new BuildService();
    const accelerated = await service.buildShip({ stationId: world.stationId, userId: world.userId, blueprintId: blueprint.id });
    assert.equal(accelerated.success, true);
    assert.equal(accelerated.buildTurns, 1);
    assert.equal(accelerated.completionTurn, 1);
    assert.equal((await get('SELECT completion_turn FROM ship_builds WHERE id=?', [accelerated.buildId])).completion_turn, 1);

    await senate.setPolicy(world.gameId, world.userId, 'technocratic_works', false, 2, db);
    const baseline = await service.buildShip({ stationId: world.stationId, userId: world.userId, blueprintId: blueprint.id });
    assert.equal(baseline.success, true);
    assert.equal(baseline.buildTurns, 2);
    assert.equal(baseline.completionTurn, 2);
});
