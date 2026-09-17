const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const {
    RegionIncidentService,
    incidentChanceForBand,
    deterministicIncidentRoll,
    incidentDefinitionForArchetype
} = require('../server/services/world/region-incident.service');
const { SystemFactsService } = require('../server/services/world/system-facts.service');

const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
        if (error) reject(error);
        else resolve(this);
    });
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
});

const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
});

let gameSequence = 0;

async function createScenario(archetype = 'asteroid-heavy', health = 73) {
    const suffix = ++gameSequence;
    const user = await run('INSERT INTO users(username,password) VALUES(?,?)', [`incident-user-${suffix}`, 'hash']);
    const game = await run('INSERT INTO games(name,status) VALUES(?,?)', [`incident-game-${suffix}`, 'active']);
    await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [game.lastID, user.lastID]);
    const sector = await run(
        'INSERT INTO sectors(game_id,owner_id,name,archetype) VALUES(?,?,?,?)',
        [game.lastID, user.lastID, `incident-sector-${suffix}`, archetype]
    );
    await run(
        "INSERT INTO regions(sector_id,region_id,cells_json,health) VALUES(?,'A',?,?)",
        [sector.lastID, JSON.stringify([{ row: 0, col: 0 }]), health]
    );
    return { gameId: game.lastID, sectorId: sector.lastID, userId: user.lastID };
}

async function addPressure({ sectorId }, turnNumber, pressureBand, pressureScore = 100) {
    await run(
        `INSERT INTO region_pressure_history
         (sector_id,region_id,turn_number,capacity,infrastructure_load,utilization,pressure_score,pressure_band,status_version,catalog_version)
         VALUES(?,'A',?,30,30,1,?, ?,2,1)`,
        [sectorId, turnNumber, pressureScore, pressureBand]
    );
}

async function findRollBelow(gameId, sectorId, regionId, archetype, turnNumberStart, chance, pressureScore = 100) {
    const definition = incidentDefinitionForArchetype(archetype);
    for (let turn = turnNumberStart; turn < turnNumberStart + 10000; turn += 1) {
        if (deterministicIncidentRoll(gameId, sectorId, regionId, turn, definition.key, pressureScore) < chance) return turn;
    }
    throw new Error('Could not find a deterministic incident roll below the requested chance');
}

before(async () => {
    await db.ready;
});

after(() => new Promise((resolve) => db.close(resolve)));

test('incident chance is zero for idle and increases with pressure bands', () => {
    assert.equal(incidentChanceForBand('idle'), 0);
    const chances = ['low', 'moderate', 'high', 'saturated', 'overloaded'].map(incidentChanceForBand);
    assert.ok(chances.every((chance) => chance > 0 && chance <= 1));
    for (let index = 1; index < chances.length; index += 1) {
        assert.ok(chances[index] > chances[index - 1]);
    }
});

test('deterministic incident rolls are stable and normalized', () => {
    const first = deterministicIncidentRoll(11, 22, 'A', 33);
    assert.equal(first, deterministicIncidentRoll(11, 22, 'A', 33));
    assert.ok(first >= 0 && first < 1);
    assert.notEqual(first, deterministicIncidentRoll(11, 22, 'A', 34));
});

test('idle pressure creates no incident and leaves regional health unchanged', async () => {
    const scenario = await createScenario('asteroid-heavy', 61);
    const turn = 4;
    await addPressure(scenario, turn, 'idle', 0);

    const result = await new RegionIncidentService(db).generateForTurn(scenario.gameId, turn);
    assert.ok(result);
    assert.deepEqual(await all('SELECT * FROM region_incidents WHERE game_id=?', [scenario.gameId]), []);
    assert.deepEqual(await get('SELECT health FROM regions WHERE sector_id=? AND region_id=\'A\'', [scenario.sectorId]), { health: 61 });
    assert.deepEqual(await all('SELECT * FROM region_health_history WHERE sector_id=?', [scenario.sectorId]), []);
});

test('generation consumes only the exact pressure turn and is deterministic/idempotent on replay', async () => {
    const scenario = await createScenario('asteroid-heavy', 88);
    const chance = incidentChanceForBand('high');
    const turn = await findRollBelow(scenario.gameId, scenario.sectorId, 'A', 'asteroid-heavy', 10, chance);
    await addPressure(scenario, turn - 1, 'high');
    await addPressure(scenario, turn, 'high');

    const service = new RegionIncidentService(db);
    await service.generateForTurn(scenario.gameId, turn);
    const first = await all(
        'SELECT game_id,sector_id,region_id,created_turn AS trigger_turn,incident_key,pressure_band,status FROM region_incidents WHERE game_id=?',
        [scenario.gameId]
    );
    await service.generateForTurn(scenario.gameId, turn);
    const replay = await all(
        'SELECT game_id,sector_id,region_id,created_turn AS trigger_turn,incident_key,pressure_band,status FROM region_incidents WHERE game_id=?',
        [scenario.gameId]
    );

    assert.equal(first.length, 1);
    assert.deepEqual(replay, first);
    assert.equal(first[0].trigger_turn, turn);
    assert.equal(first[0].incident_key, 'debris-migration');
    assert.deepEqual(await get('SELECT health FROM regions WHERE sector_id=? AND region_id=\'A\'', [scenario.sectorId]), { health: 88 });
});

test('an active incident suppresses additional incidents in the same region', async () => {
    const scenario = await createScenario('wormhole', 44);
    const chance = incidentChanceForBand('overloaded');
    const firstTurn = await findRollBelow(scenario.gameId, scenario.sectorId, 'A', 'wormhole', 100, chance);
    const secondTurn = await findRollBelow(scenario.gameId, scenario.sectorId, 'A', 'wormhole', firstTurn + 1, chance);
    await addPressure(scenario, firstTurn, 'overloaded');
    await addPressure(scenario, secondTurn, 'overloaded');

    const service = new RegionIncidentService(db);
    await service.generateForTurn(scenario.gameId, firstTurn);
    await service.generateForTurn(scenario.gameId, secondTurn);
    const incidents = await all('SELECT * FROM region_incidents WHERE game_id=?', [scenario.gameId]);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].incident_key, 'aperture-instability');
    assert.equal(incidents[0].status, 'active');
});

test('incident definitions map prototype archetypes and fall back safely', () => {
    assert.equal(incidentDefinitionForArchetype('asteroid-heavy').key, 'debris-migration');
    assert.equal(incidentDefinitionForArchetype('wormhole').key, 'aperture-instability');
    assert.equal(incidentDefinitionForArchetype('dark-nebula').key, 'sensor-map-drift');
    assert.equal(incidentDefinitionForArchetype('binary').key, 'navigation-instability');
    assert.equal(incidentDefinitionForArchetype(null).key, 'navigation-instability');
});

test('generation preserves regional health for every supported incident archetype', async () => {
    for (const archetype of ['asteroid-heavy', 'wormhole', 'dark-nebula', 'standard']) {
        const scenario = await createScenario(archetype, 57);
        const chance = incidentChanceForBand('overloaded');
        const turn = await findRollBelow(scenario.gameId, scenario.sectorId, 'A', archetype, 200, chance);
        await addPressure(scenario, turn, 'overloaded');
        await new RegionIncidentService(db).generateForTurn(scenario.gameId, turn);
        const region = await get('SELECT health FROM regions WHERE sector_id=? AND region_id=\'A\'', [scenario.sectorId]);
        assert.deepEqual(region, { health: 57 }, archetype);
    }
});

test('system facts expose only the public active-incident contract', async () => {
    const scenario = await createScenario('dark-nebula', 69);
    const chance = incidentChanceForBand('overloaded');
    const turn = await findRollBelow(scenario.gameId, scenario.sectorId, 'A', 'dark-nebula', 500, chance);
    await run("INSERT INTO turns(game_id,turn_number,status) VALUES(?,?,'waiting')", [scenario.gameId, turn]);
    await addPressure(scenario, turn, 'overloaded');
    await new RegionIncidentService(db).generateForTurn(scenario.gameId, turn);

    const facts = await SystemFactsService.getSectorSummary(scenario.sectorId, scenario.userId);
    assert.deepEqual(facts.dimensions, { width: 5000, height: 5000 });
    assert.equal(facts.regions[0].incidents.length, 1);
    const incident = facts.regions[0].incidents[0];
    assert.deepEqual(Object.keys(incident).sort(), [
        'createdTurn', 'dueTurn', 'healthLoss', 'id', 'key', 'resolution', 'severity', 'status', 'summary', 'title', 'turnsRemaining', 'utilityRole'
    ]);
    assert.equal(incident.key, 'sensor-map-drift');
    assert.equal(incident.utilityRole, 'courier');
    assert.equal(incident.status, 'active');
    assert.equal(incident.resolution.rule, 'ship_arrival');
    assert.deepEqual(incident.resolution.eligibleShips, [{ roles: ['courier'] }]);
    assert.equal(Number.isSafeInteger(incident.resolution.target.x), true);
    assert.equal(Number.isSafeInteger(incident.resolution.target.y), true);
    assert.equal(incident.resolution.target.radius, 0);
    assert.ok(incident.dueTurn > incident.createdTurn);
    assert.ok(incident.healthLoss > 0);
    assert.equal(incident.turnsRemaining, incident.dueTurn - turn);
    const serialized = JSON.stringify(facts);
    for (const hiddenField of ['generation_roll', 'generation_version', 'pressure_score', 'infrastructure_load']) {
        assert.equal(serialized.includes(hiddenField), false, hiddenField);
    }
    assert.deepEqual(await get('SELECT health FROM regions WHERE sector_id=? AND region_id=\'A\'', [scenario.sectorId]), { health: 69 });
});
