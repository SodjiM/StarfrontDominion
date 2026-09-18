const { test } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
process.env.DATABASE_PATH = ':memory:';
const service = require('../server/services/game/political-capital.service');

const run = (db, sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function (e) { e ? reject(e) : resolve(this); }));
const exec = (db, sql) => new Promise((resolve, reject) => db.exec(sql, e => e ? reject(e) : resolve()));
const get = (db, sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (e, row) => e ? reject(e) : resolve(row)));

test('political capital awards every active senator once, including one appointed after objectives opened', async () => {
    const db = new sqlite3.Database(':memory:');
    await exec(db, `CREATE TABLE senate_senators(id INTEGER,game_id INTEGER,user_id INTEGER,status TEXT,happiness INTEGER);
        CREATE TABLE senator_objectives(senator_id INTEGER,session_id INTEGER);
        CREATE TABLE player_political_state(game_id INTEGER,user_id INTEGER,political_capital REAL,updated_turn INTEGER);
        CREATE TABLE political_capital_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,game_id INTEGER,user_id INTEGER,amount REAL,entry_type TEXT,source_key TEXT UNIQUE,source_type TEXT,source_id TEXT,session_id INTEGER,turn_number INTEGER,happiness INTEGER,metadata_json TEXT)`);
    await run(db, 'INSERT INTO player_political_state VALUES(1,2,7,1)');
    await run(db, 'INSERT INTO senate_senators VALUES(10,1,2,"active",100),(11,1,2,"active",19),(12,1,2,"active",40)');
    await run(db, 'INSERT INTO senator_objectives VALUES(10,50),(11,50)');
    const first = await service.awardPoliticalCapital(1, 2, 50, 9, db);
    assert.equal(first.award, 7);
    assert.equal((await get(db, 'SELECT political_capital FROM player_political_state')).political_capital, 14);
    assert.equal((await get(db, 'SELECT COUNT(*) AS c FROM political_capital_ledger')).c, 3);
    assert.equal((await service.awardPoliticalCapital(1, 2, 50, 9, db)).award, 0);
    assert.equal((await get(db, 'SELECT political_capital FROM player_political_state')).political_capital, 14);
    await new Promise(resolve => db.close(resolve));
});

test('capital award bands use inclusive lower bounds', () => {
    assert.deepEqual([0, 0, 1, 2, 4, 5], [0, 19, 20, 40, 80, 100].map(service.capitalAwardForHappiness));
});
