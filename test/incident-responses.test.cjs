const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const { NavigationService } = require('../server/services/game/navigation.service');
const { RegionIncidentService, matchesEligibleShip } = require('../server/services/world/region-incident.service');

const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
        if (error) reject(error);
        else resolve({ changes: this.changes, lastID: this.lastID });
    });
});
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));

let sequence = 0;

async function createScenario({ dueTurn = 12 } = {}) {
    const suffix = ++sequence;
    const game = await run('INSERT INTO games(name,status) VALUES(?,?)', [`incident-resolution-${suffix}`, 'active']);
    const alpha = await run('INSERT INTO users(username,password) VALUES(?,?)', [`incident-alpha-${suffix}`, 'hash']);
    const beta = await run('INSERT INTO users(username,password) VALUES(?,?)', [`incident-beta-${suffix}`, 'hash']);
    const outsider = await run('INSERT INTO users(username,password) VALUES(?,?)', [`incident-outsider-${suffix}`, 'hash']);
    await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [game.lastID, alpha.lastID]);
    await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [game.lastID, beta.lastID]);
    const sector = await run('INSERT INTO sectors(game_id,owner_id,name,archetype) VALUES(?,?,?,?)', [game.lastID, alpha.lastID, `incident-sector-${suffix}`, 'asteroid-heavy']);
    await run("INSERT INTO regions(sector_id,region_id,cells_json,health) VALUES(?,'A',?,67)", [sector.lastID, JSON.stringify([{ row: 0, col: 0 }])]);
    const requirements = JSON.stringify({ arrivalRadius: 0, eligibleShips: [{ roles: ['courier'] }] });
    const incident = await run(
        `INSERT INTO region_incidents
         (game_id,sector_id,region_id,incident_key,title,summary,utility_role,severity,status,created_turn,due_turn,
          pressure_turn,pressure_band,pressure_score,generation_roll,generation_version,health_loss,resolution_rule,
          resolution_requirements_json,target_x,target_y)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [game.lastID, sector.lastID, 'A', 'debris-migration', 'Debris Migration', 'Debris threatens local traffic.',
            'courier', 'significant', 'active', 8, dueTurn, 8, 'high', 84, 0.1, 1, 4,
            'ship_arrival', requirements, 500, 500]
    );
    const alphaShip = await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',490,500,?,?)",
        [sector.lastID, alpha.lastID, JSON.stringify({ role: 'courier', blueprintId: 'swift-courier', hp: 35, movementSpeed: 20, operational: true })]
    );
    const betaShip = await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',480,500,?,?)",
        [sector.lastID, beta.lastID, JSON.stringify({ role: 'courier', blueprintId: 'swift-courier', hp: 35, movementSpeed: 20, operational: true })]
    );
    const outsiderShip = await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',700,700,?,?)",
        [sector.lastID, outsider.lastID, JSON.stringify({ role: 'courier', blueprintId: 'swift-courier', hp: 35, operational: true })]
    );
    await run('INSERT INTO region_health_history(sector_id,region_id,turn_number,health) VALUES(?,?,?,?)', [sector.lastID, 'A', 8, 67]);
    return {
        gameId: game.lastID,
        sectorId: sector.lastID,
        incidentId: incident.lastID,
        users: { alpha: alpha.lastID, beta: beta.lastID, outsider: outsider.lastID },
        ships: { alpha: alphaShip.lastID, beta: betaShip.lastID, outsider: outsiderShip.lastID },
        health: 67
    };
}

const incidentRow = incidentId => get(
    'SELECT status,resolved_turn,outcome,resolved_by_object_id,resolved_by_user_id FROM region_incidents WHERE id=?',
    [incidentId]
);

before(async () => { await db.ready; });
after(() => new Promise(resolve => db.close(resolve)));

test('incidents are shared objectives with no player enrollment tables or response API state', async () => {
    const scenario = await createScenario();
    assert.equal(await get("SELECT name FROM sqlite_master WHERE type='table' AND name='region_incident_responses'"), null);
    assert.equal(await get("SELECT name FROM sqlite_master WHERE type='table' AND name='region_incident_missions'"), null);
    const facts = await new RegionIncidentService(db).getPublicStateForSector(scenario.sectorId);
    const incident = facts.find(item => item.id === scenario.incidentId);
    assert.deepEqual(incident.resolution, {
        rule: 'ship_arrival',
        target: { x: 500, y: 500, radius: 0 },
        eligibleShips: [{ roles: ['courier'] }]
    });
    assert.equal('response' in incident, false);
    assert.doesNotMatch(JSON.stringify(incident), /userId|shipId|resolved_by|objectId/);
});

test('ordinary courier movement to the public target resolves the shared incident', async () => {
    const scenario = await createScenario();
    const navigation = new NavigationService(db);
    await navigation.order(scenario.ships.alpha, { x: 500, y: 500 }, { userId: scenario.users.alpha, gameId: scenario.gameId });
    const movement = await navigation.tickMoves(scenario.gameId, 10);
    assert.equal(movement.find(item => item.objectId === scenario.ships.alpha).status, 'completed');

    const result = await new RegionIncidentService(db).resolveActiveIncidents(scenario.gameId, 10);
    assert.deepEqual(result, {
        resolved: [{
            incidentId: scenario.incidentId,
            sectorId: scenario.sectorId,
            regionId: 'A',
            objectId: scenario.ships.alpha,
            userId: scenario.users.alpha
        }],
        unsupported: []
    });
    assert.deepEqual(await incidentRow(scenario.incidentId), {
        status: 'resolved',
        resolved_turn: 10,
        outcome: 'stabilized',
        resolved_by_object_id: scenario.ships.alpha,
        resolved_by_user_id: scenario.users.alpha
    });
});

test('being in the region is insufficient; wrong-role, outsider, disabled, and destroyed ships do not resolve', async () => {
    const scenario = await createScenario();
    const scout = await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',500,500,?,?)",
        [scenario.sectorId, scenario.users.alpha, JSON.stringify({ role: 'scout', hp: 40, operational: true })]
    );
    await run('UPDATE sector_objects SET meta=? WHERE id=?', [JSON.stringify({ role: 'courier', hp: 35, disabled: true }), scenario.ships.alpha]);
    await run('UPDATE sector_objects SET x=500,y=500 WHERE id=?', [scenario.ships.alpha]);
    await run('UPDATE sector_objects SET meta=?,x=500,y=500 WHERE id=?', [JSON.stringify({ role: 'courier', hp: 0, destroyed: true }), scenario.ships.beta]);
    await run('UPDATE sector_objects SET x=500,y=500 WHERE id=?', [scenario.ships.outsider]);

    assert.deepEqual(await new RegionIncidentService(db).resolveActiveIncidents(scenario.gameId, 10), { resolved: [], unsupported: [] });
    assert.deepEqual(await incidentRow(scenario.incidentId), {
        status: 'active', resolved_turn: null, outcome: null, resolved_by_object_id: null, resolved_by_user_id: null
    });
    assert.ok(scout.lastID);
});

test('a destroyed attempt does not own or fail the incident; another player can still resolve it', async () => {
    const scenario = await createScenario();
    const service = new RegionIncidentService(db);
    await run('UPDATE sector_objects SET x=500,y=500,meta=? WHERE id=?', [JSON.stringify({ role: 'courier', hp: 0, destroyed: true }), scenario.ships.alpha]);
    assert.deepEqual(await service.resolveActiveIncidents(scenario.gameId, 10), { resolved: [], unsupported: [] });
    await run('UPDATE sector_objects SET x=500,y=500 WHERE id=?', [scenario.ships.beta]);
    const result = await service.resolveActiveIncidents(scenario.gameId, 11);
    assert.equal(result.resolved[0].objectId, scenario.ships.beta);
    assert.equal((await incidentRow(scenario.incidentId)).status, 'resolved');
});

test('eligibility selectors support role subsets, blueprint subsets, specific ships, and any operational ship', () => {
    const courier = { id: 4 };
    const meta = { role: 'courier', blueprintId: 'swift-courier' };
    assert.equal(matchesEligibleShip(courier, meta, [{ roles: ['courier', 'scout'] }]), true);
    assert.equal(matchesEligibleShip(courier, meta, [{ blueprintIds: ['swift-courier'] }]), true);
    assert.equal(matchesEligibleShip(courier, meta, [{ objectIds: [4] }]), true);
    assert.equal(matchesEligibleShip(courier, meta, [{}]), true);
    assert.equal(matchesEligibleShip(courier, meta, [{ roles: ['brawler'] }]), false);
});

test('a qualifying arrival on the due turn resolves before expiration and preserves health', async () => {
    const scenario = await createScenario({ dueTurn: 12 });
    const service = new RegionIncidentService(db);
    await run('UPDATE sector_objects SET x=500,y=500 WHERE id=?', [scenario.ships.alpha]);
    assert.equal((await service.resolveActiveIncidents(scenario.gameId, 12)).resolved.length, 1);
    assert.deepEqual(await service.expireDueIncidents(scenario.gameId, 12), []);
    assert.deepEqual(await get('SELECT health FROM regions WHERE sector_id=? AND region_id=?', [scenario.sectorId, 'A']), { health: scenario.health });
});

test('an unresolved due incident expires once and applies its health loss', async () => {
    const scenario = await createScenario({ dueTurn: 12 });
    const service = new RegionIncidentService(db);
    assert.deepEqual(await service.expireDueIncidents(scenario.gameId, 11), []);
    assert.deepEqual(await service.expireDueIncidents(scenario.gameId, 12), [{
        incidentId: scenario.incidentId,
        sectorId: scenario.sectorId,
        regionId: 'A',
        healthBefore: scenario.health,
        healthAfter: scenario.health - 4,
        healthDelta: -4
    }]);
    assert.deepEqual(await service.expireDueIncidents(scenario.gameId, 13), []);
    assert.equal((await incidentRow(scenario.incidentId)).status, 'expired');
});

test('expiration transaction failure preserves both incident and regional health', async () => {
    const scenario = await createScenario({ dueTurn: 12 });
    const service = new RegionIncidentService(db);
    const trigger = `fail_incident_health_${scenario.incidentId}`;
    await run(`CREATE TRIGGER ${trigger} BEFORE UPDATE OF health ON regions
        WHEN OLD.sector_id=${scenario.sectorId} AND OLD.region_id='A'
        BEGIN SELECT RAISE(ABORT,'injected health failure'); END`);
    await assert.rejects(() => service.expireDueIncidents(scenario.gameId, 12), /injected health failure/);
    await run(`DROP TRIGGER ${trigger}`);
    assert.equal((await incidentRow(scenario.incidentId)).status, 'active');
    assert.deepEqual(await get('SELECT health FROM regions WHERE sector_id=? AND region_id=?', [scenario.sectorId, 'A']), { health: scenario.health });
});
