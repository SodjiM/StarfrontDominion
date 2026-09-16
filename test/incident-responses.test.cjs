const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const { RegionIncidentService } = require('../server/services/world/region-incident.service');

const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
        if (error) reject(error);
        else resolve({ changes: this.changes, lastID: this.lastID });
    });
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
});

const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
});

let sequence = 0;

async function createScenario() {
    const suffix = ++sequence;
    const game = await run('INSERT INTO games(name,status) VALUES(?,?)', [`response-game-${suffix}`, 'active']);
    const users = [];
    for (const role of ['alpha', 'beta', 'gamma']) {
        const user = await run(
            'INSERT INTO users(username,password) VALUES(?,?)',
            [`response-${role}-${suffix}`, 'hash']
        );
        users.push(user.lastID);
    }
    await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [game.lastID, users[0]]);
    await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [game.lastID, users[1]]);

    const outsider = await run(
        'INSERT INTO users(username,password) VALUES(?,?)',
        [`response-outsider-${suffix}`, 'hash']
    );
    const sector = await run(
        'INSERT INTO sectors(game_id,owner_id,name,archetype) VALUES(?,?,?,?)',
        [game.lastID, users[0], `response-sector-${suffix}`, 'asteroid-heavy']
    );
    await run(
        "INSERT INTO regions(sector_id,region_id,cells_json,health) VALUES(?,'A',?,?)",
        [sector.lastID, JSON.stringify([{ row: 0, col: 0 }]), 67]
    );
    const incident = await run(
        `INSERT INTO region_incidents
         (game_id,sector_id,region_id,incident_key,title,summary,utility_role,severity,status,
          created_turn,due_turn,pressure_turn,pressure_band,pressure_score,generation_roll,generation_version)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
            game.lastID, sector.lastID, 'A', 'debris-migration', 'Debris Migration',
            'A shifting debris field threatens local traffic.', 'engineering', 'significant', 'active',
            8, 12, 8, 'high', 84, 0.1, 1
        ]
    );
    await run(
        'INSERT INTO region_health_history(sector_id,region_id,turn_number,health) VALUES(?,?,?,?)',
        [sector.lastID, 'A', 8, 67]
    );
    return {
        gameId: game.lastID,
        sectorId: sector.lastID,
        incidentId: incident.lastID,
        responders: { alpha: users[0], beta: users[1] },
        outsiderId: outsider.lastID,
        health: 67
    };
}

async function incidentRow(incidentId) {
    return get(
        'SELECT status,resolved_turn,outcome FROM region_incidents WHERE id=?',
        [incidentId]
    );
}

async function responseRows(incidentId) {
    return all(
        'SELECT * FROM region_incident_responses WHERE incident_id=? ORDER BY user_id',
        [incidentId]
    );
}

function publicIncidents(state) {
    return Array.isArray(state) ? state : (state.incidents || []);
}

before(async () => {
    await db.ready;
});

after(() => new Promise((resolve) => db.close(resolve)));

test('multiple members can respond, begin is idempotent, and outsiders are rejected', async () => {
    const scenario = await createScenario();
    const service = new RegionIncidentService(db);
    const turnNumber = 9;

    const first = await service.beginResponse({
        incidentId: scenario.incidentId,
        userId: scenario.responders.alpha,
        turnNumber
    });
    const replay = await service.beginResponse({
        incidentId: scenario.incidentId,
        userId: scenario.responders.alpha,
        turnNumber
    });
    const competing = await service.beginResponse({
        incidentId: scenario.incidentId,
        userId: scenario.responders.beta,
        turnNumber
    });

    assert.deepEqual(replay, first);
    assert.ok(first);
    assert.ok(competing);
    assert.equal((await responseRows(scenario.incidentId)).length, 2);
    const outsider = await service.beginResponse({
            incidentId: scenario.incidentId,
            userId: scenario.outsiderId,
            turnNumber
        });
    assert.deepEqual(outsider, { success: false, error: 'not_a_game_member' });
});

test('cancelling affects only the caller and a cancelled response can restart', async () => {
    const scenario = await createScenario();
    const service = new RegionIncidentService(db);
    const turnNumber = 10;

    await service.beginResponse({ incidentId: scenario.incidentId, userId: scenario.responders.alpha, turnNumber });
    await service.beginResponse({ incidentId: scenario.incidentId, userId: scenario.responders.beta, turnNumber });
    const cancelled = await service.cancelResponse({
        incidentId: scenario.incidentId,
        userId: scenario.responders.alpha,
        turnNumber: turnNumber + 1
    });
    assert.ok(cancelled);

    let rows = await responseRows(scenario.incidentId);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, 'cancelled');
    assert.equal(rows[1].status, 'active');

    await service.beginResponse({
        incidentId: scenario.incidentId,
        userId: scenario.responders.alpha,
        turnNumber: turnNumber + 2
    });
    rows = await responseRows(scenario.incidentId);
    assert.equal(rows.filter((row) => row.user_id === scenario.responders.alpha && row.status === 'active').length, 1);
    assert.equal(rows.filter((row) => row.user_id === scenario.responders.beta && row.status === 'active').length, 1);
});

test('completion requires the caller response, resolves the incident, and cancels competitors', async () => {
    const scenario = await createScenario();
    const service = new RegionIncidentService(db);
    const turnNumber = 11;

    const missingResponse = await service.completeResponse({
            incidentId: scenario.incidentId,
            userId: scenario.responders.alpha,
            turnNumber,
            outcome: 'stabilized'
        });
    assert.deepEqual(missingResponse, { success: false, error: 'active_response_required' });
    await service.beginResponse({ incidentId: scenario.incidentId, userId: scenario.responders.alpha, turnNumber });
    await service.beginResponse({ incidentId: scenario.incidentId, userId: scenario.responders.beta, turnNumber });

    const winner = await service.completeResponse({
        incidentId: scenario.incidentId,
        userId: scenario.responders.alpha,
        turnNumber: turnNumber + 1,
        outcome: 'stabilized'
    });
    assert.ok(winner);
    assert.deepEqual(await incidentRow(scenario.incidentId), {
        status: 'resolved',
        resolved_turn: turnNumber + 1,
        outcome: 'stabilized'
    });

    const rows = await responseRows(scenario.incidentId);
    assert.equal(rows.find((row) => row.user_id === scenario.responders.alpha).status, 'completed');
    assert.equal(rows.find((row) => row.user_id === scenario.responders.beta).status, 'cancelled');
    assert.deepEqual(
        await service.completeResponse({
            incidentId: scenario.incidentId,
            userId: scenario.responders.alpha,
            turnNumber: turnNumber + 2,
            outcome: 'stabilized'
        }),
        winner
    );
    assert.deepEqual(
        await service.beginResponse({ incidentId: scenario.incidentId, userId: scenario.responders.beta, turnNumber: turnNumber + 2 }),
        { success: false, error: 'incident_not_active' }
    );
});

test('public state exposes response status without responder identities and retains resolved outcome', async () => {
    const scenario = await createScenario();
    const service = new RegionIncidentService(db);
    await service.beginResponse({ incidentId: scenario.incidentId, userId: scenario.responders.alpha, turnNumber: 12 });
    await service.beginResponse({ incidentId: scenario.incidentId, userId: scenario.responders.beta, turnNumber: 12 });

    const alphaView = await service.getPublicStateForSector(scenario.sectorId, scenario.responders.alpha);
    const alphaIncident = publicIncidents(alphaView).find((incident) => incident.id === scenario.incidentId);
    assert.ok(alphaIncident);
    assert.equal(alphaIncident.status, 'active');
    assert.deepEqual(alphaIncident.response, { status: 'responding', viewerResponding: true });
    assert.equal(JSON.stringify(alphaIncident).includes(String(scenario.responders.alpha)), false);
    assert.equal(JSON.stringify(alphaIncident).includes(String(scenario.responders.beta)), false);

    await service.completeResponse({
        incidentId: scenario.incidentId,
        userId: scenario.responders.alpha,
        turnNumber: 13,
        outcome: 'stabilized'
    });
    const resolvedView = await service.getPublicStateForSector(scenario.sectorId, scenario.responders.beta);
    const resolvedIncident = publicIncidents(resolvedView).find((incident) => incident.id === scenario.incidentId);
    assert.ok(resolvedIncident);
    assert.equal(resolvedIncident.status, 'resolved');
    assert.equal(resolvedIncident.outcome, 'stabilized');
    assert.equal(resolvedIncident.resolvedTurn, 13);
    assert.deepEqual(resolvedIncident.response, { status: 'resolved', viewerResponding: false });
    assert.equal(JSON.stringify(resolvedView).includes('user_id'), false);
});

test('response lifecycle never changes regional health or health history', async () => {
    const scenario = await createScenario();
    const service = new RegionIncidentService(db);
    await service.beginResponse({ incidentId: scenario.incidentId, userId: scenario.responders.alpha, turnNumber: 14 });
    await service.completeResponse({
        incidentId: scenario.incidentId,
        userId: scenario.responders.alpha,
        turnNumber: 15,
        outcome: 'stabilized'
    });

    assert.deepEqual(
        await get('SELECT health FROM regions WHERE sector_id=? AND region_id=?', [scenario.sectorId, 'A']),
        { health: scenario.health }
    );
    assert.deepEqual(
        await all('SELECT health FROM region_health_history WHERE sector_id=? AND region_id=? ORDER BY turn_number', [scenario.sectorId, 'A']),
        [{ health: scenario.health }]
    );
});
