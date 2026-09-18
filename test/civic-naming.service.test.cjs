const { test } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
process.env.DATABASE_PATH = ':memory:';
const service = require('../server/services/game/civic-naming.service');

const run = (db, sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function (e) { e ? reject(e) : resolve(this); }));
const exec = (db, sql) => new Promise((resolve, reject) => db.exec(sql, e => e ? reject(e) : resolve()));
const get = (db, sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (e, row) => e ? reject(e) : resolve(row)));

async function fixture() {
    const db = new sqlite3.Database(':memory:');
    await exec(db, `CREATE TABLE sectors(id INTEGER PRIMARY KEY,game_id INTEGER,name TEXT,owner_id INTEGER);
        CREATE TABLE sector_objects(id INTEGER PRIMARY KEY,sector_id INTEGER,type TEXT,celestial_type TEXT,owner_id INTEGER,meta TEXT);
        CREATE TABLE object_visibility(game_id INTEGER,user_id INTEGER,object_id INTEGER);
        CREATE TABLE player_political_state(game_id INTEGER,user_id INTEGER,political_capital REAL,updated_turn INTEGER);
        CREATE TABLE political_capital_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,game_id INTEGER,user_id INTEGER,amount REAL,entry_type TEXT,source_key TEXT UNIQUE,source_type TEXT,source_id TEXT,session_id INTEGER,turn_number INTEGER,happiness INTEGER,metadata_json TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE civic_naming_proposals(id INTEGER PRIMARY KEY AUTOINCREMENT,game_id INTEGER,user_id INTEGER,client_request_key TEXT,target_type TEXT,target_id INTEGER,target_snapshot_json TEXT,proposed_name TEXT,previous_name TEXT,current_name TEXT,capital_cost REAL,status TEXT,submitted_turn INTEGER DEFAULT 0,decided_turn INTEGER,enacted_turn INTEGER,history_entry_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT,UNIQUE(game_id,user_id,client_request_key));`);
    await run(db, 'INSERT INTO sectors VALUES(?,?,?,?)', [1, 1, 'Alpha', 99]);
    await run(db, 'INSERT INTO sector_objects VALUES(?,?,?,?,?,?),(?,?,?,?,?,?)', [10, 1, 'planet', 'planet', null, JSON.stringify({ name: 'Gaia' }), 11, 1, 'planet', 'planet', null, JSON.stringify({ name: 'Hidden' })]);
    await run(db, 'INSERT INTO object_visibility VALUES(1,2,10)');
    await run(db, 'INSERT INTO player_political_state VALUES(1,2,2,1)');
    return db;
}

test('naming spends exactly two capital, snapshots visible targets, and is request-idempotent', async () => {
    const db = await fixture();
    const first = await service.proposeCivicName(1, 2, { clientRequestId: 'req-1', targetType: 'planet', targetId: 10, name: 'New Gaia' }, db);
    assert.equal(first.success, true);
    assert.equal(first.proposal.proposedName, 'New Gaia');
    assert.equal(first.proposal.targetType, 'planet');
    assert.equal(first.balance, 0);
    const retry = await service.proposeCivicName(1, 2, { clientRequestKey: 'req-1', targetType: 'planet', targetId: 11, name: 'Other' }, db);
    assert.equal(retry.idempotent, true);
    assert.equal(retry.proposal.targetId, 10);
    assert.equal((await get(db, 'SELECT COUNT(*) AS c FROM civic_naming_proposals')).c, 1);
    await new Promise(resolve => db.close(resolve));
});

test('unseen targets fail without disclosing target details', async () => {
    const db = await fixture();
    const result = await service.proposeCivicName(1, 2, { clientRequestKey: 'req-2', targetType: 'planet', targetId: 11, name: 'Secret' }, db);
    assert.deepEqual(result, { success: false, code: 'target_unavailable', error: 'Target unavailable' });
    await new Promise(resolve => db.close(resolve));
});

test('pending proposals are shared only with players who have discovered the target', async () => {
    const db = await fixture();
    try {
        await service.proposeCivicName(1, 2, { clientRequestId: 'req-shared', targetType: 'planet', targetId: 10, name: 'Concord' }, db);
        await run(db, 'INSERT INTO object_visibility VALUES(1,3,10)');
        const stakeholder = await service.getCivicNamingReadModel(1, 3, db);
        const outsider = await service.getCivicNamingReadModel(1, 4, db);
        assert.equal(stakeholder.pendingProposals.length, 1);
        assert.equal(stakeholder.pendingProposals[0].proposedName, 'Concord');
        assert.deepEqual(outsider.pendingProposals, []);
    } finally {
        await new Promise(resolve => db.close(resolve));
    }
});

test('proposal insertion failure rolls back both capital spend and ledger entry', async () => {
    const db = await fixture();
    const originalRun = db.run.bind(db);
    db.run = function (sql, args, callback) {
        if (String(sql).includes('INSERT INTO civic_naming_proposals')) {
            const cb = typeof args === 'function' ? args : callback;
            queueMicrotask(() => cb.call({ changes: 0 }, new Error('injected proposal failure')));
            return this;
        }
        return callback === undefined ? originalRun(sql, args) : originalRun(sql, args, callback);
    };
    try {
        await assert.rejects(service.proposeCivicName(1, 2, { clientRequestId: 'req-fail', targetType: 'planet', targetId: 10, name: 'Rollback' }, db), /injected proposal failure/);
        db.run = originalRun;
        assert.equal((await get(db, 'SELECT political_capital FROM player_political_state')).political_capital, 2);
        assert.equal((await get(db, 'SELECT COUNT(*) AS c FROM political_capital_ledger')).c, 0);
    } finally {
        db.run = originalRun;
        await new Promise(resolve => db.close(resolve));
    }
});
