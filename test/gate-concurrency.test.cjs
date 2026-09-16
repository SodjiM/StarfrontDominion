const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
process.env.DATABASE_PATH = ':memory:';
const { InfrastructureLifecycleService } = require('../server/services/game/infrastructure-lifecycle.service');
const defaultDb = require('../server/db');

let tempDirectory;
let firstDb;
let secondDb;

const exec = (database, sql) => new Promise((resolve, reject) => database.exec(sql, (error) => error ? reject(error) : resolve()));
const get = (database, sql, params = []) => new Promise((resolve, reject) => database.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
const close = (database) => new Promise((resolve, reject) => database.close((error) => error ? reject(error) : resolve()));

before(async () => {
    await defaultDb.ready;
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'starfront-gates-'));
    const databasePath = path.join(tempDirectory, 'concurrency.sqlite');
    firstDb = new sqlite3.Database(databasePath);
    secondDb = new sqlite3.Database(databasePath);
    firstDb.configure('busyTimeout', 3000);
    secondDb.configure('busyTimeout', 3000);
    await exec(firstDb, `
        PRAGMA journal_mode=WAL;
        CREATE TABLE sectors(id INTEGER PRIMARY KEY, gate_slots INTEGER DEFAULT 3, gates_used INTEGER DEFAULT 0);
        CREATE TABLE interstellar_gate_pairs(
            pair_id TEXT PRIMARY KEY, game_id INTEGER NOT NULL,
            sector_a_id INTEGER NOT NULL, sector_b_id INTEGER NOT NULL,
            gate_a_object_id INTEGER, gate_b_object_id INTEGER,
            status TEXT NOT NULL DEFAULT 'reserving', slots_reserved INTEGER NOT NULL DEFAULT 0,
            disabled_reason TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(game_id,sector_a_id,sector_b_id)
        );
        INSERT INTO sectors(id,gate_slots,gates_used) VALUES(1,1,0),(2,1,0);
    `);
    await exec(secondDb, 'PRAGMA journal_mode=WAL;');
});

after(async () => {
    await Promise.all([close(firstDb), close(secondDb)]);
    await close(defaultDb);
    fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('separate SQLite connections cannot reserve the same canonical gate pair twice', async () => {
    const first = new InfrastructureLifecycleService(firstDb);
    const second = new InfrastructureLifecycleService(secondDb);
    const results = await Promise.all([
        first.createGateReservation({ pairId: 'forward', gameId: 1, originSectorId: 1, destinationSectorId: 2 }),
        second.createGateReservation({ pairId: 'reverse', gameId: 1, originSectorId: 2, destinationSectorId: 1 })
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => result.error === 'connection_already_exists').length, 1);
    assert.equal((await get(firstDb, 'SELECT COUNT(*) AS count FROM interstellar_gate_pairs')).count, 1);
});

test('conditional slot reservation is authoritative across database connections', async () => {
    const first = new InfrastructureLifecycleService(firstDb);
    const second = new InfrastructureLifecycleService(secondDb);
    const results = await Promise.all([first.reserveGateSlot(1), second.reserveGateSlot(1)]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal((await get(firstDb, 'SELECT gates_used FROM sectors WHERE id=1')).gates_used, 1);
});
