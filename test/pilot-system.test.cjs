const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const { getPilotStats, reservePilots, processPilotTurn } = require('../server/services/game/pilot.service');

const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function (err) { err ? reject(err) : resolve(this); }));
const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (err, row) => err ? reject(err) : resolve(row)));

let gameId;
let userId;
let sectorId;

before(async () => {
  await db.ready;
  userId = (await run("INSERT INTO users(username,password) VALUES(?, 'hash')", [`pilot-test-${Date.now()}`])).lastID;
  gameId = (await run("INSERT INTO games(name,status) VALUES('pilot-test','active')")).lastID;
  sectorId = (await run("INSERT INTO sectors(game_id,name) VALUES(?, 'Pilot Test')", [gameId])).lastID;
  await run('INSERT INTO game_players(game_id,user_id) VALUES(?,?)', [gameId, userId]);
});

after(() => new Promise(resolve => db.close(resolve)));

test('station types determine pilot capacity and capacity expansion preserves available pilots', async () => {
  let stats = await getPilotStats(gameId, userId, 1, db);
  assert.deepEqual({ capacity: stats.capacity, available: stats.available, deployed: stats.deployed, recovering: stats.recovering }, { capacity: 5, available: 5, deployed: 0, recovering: 0 });

  assert.equal((await reservePilots(gameId, userId, 2, 1, db)).success, true);
  stats = await getPilotStats(gameId, userId, 1, db);
  assert.equal(stats.available, 3);

  await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?, 'station', 0, 0, ?, ?)", [sectorId, userId, JSON.stringify({ stationClass: 'sun-station' })]);
  stats = await getPilotStats(gameId, userId, 1, db);
  assert.equal(stats.capacity, 15);
  assert.equal(stats.available, 13);
});

test('deployed pilot counts use each ship pilotCost and reservations cannot overdraw the pool', async () => {
  await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?, 'ship', 5, 5, ?, ?)", [sectorId, userId, JSON.stringify({ pilotCost: 3 })]);
  let stats = await getPilotStats(gameId, userId, 1, db);
  assert.equal(stats.deployed, 3);
  assert.equal(stats.available, 12);
  assert.equal((await reservePilots(gameId, userId, 12, 1, db)).success, true);
  assert.equal((await reservePilots(gameId, userId, 1, 1, db)).success, false);
});

test('dead pilots recover one per turn and return to the available pool', async () => {
  await run('DELETE FROM sector_objects WHERE type = \'ship\' AND owner_id = ?', [userId]);
  await run('DELETE FROM dead_pilots_queue WHERE game_id=? AND user_id=?', [gameId, userId]);
  await run('DELETE FROM pilot_ledgers WHERE game_id=? AND user_id=?', [gameId, userId]);
  await getPilotStats(gameId, userId, 1, db);
  await run('UPDATE pilot_ledgers SET available=2 WHERE game_id=? AND user_id=?', [gameId, userId]);
  await run('INSERT INTO dead_pilots_queue(game_id,user_id,count,respawn_turn) VALUES(?,?,3,2)', [gameId, userId]);

  await processPilotTurn(gameId, 2, db);
  let stats = await getPilotStats(gameId, userId, 2, db);
  assert.equal(stats.available, 3);
  assert.equal(stats.recovering, 2);
  assert.equal((await get('SELECT count FROM dead_pilots_queue WHERE game_id=? AND user_id=?', [gameId, userId])).count, 2);

  await processPilotTurn(gameId, 3, db);
  stats = await getPilotStats(gameId, userId, 3, db);
  assert.equal(stats.available, 4);
  assert.equal(stats.recovering, 1);
});
