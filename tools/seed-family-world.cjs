#!/usr/bin/env node

// Creates a small, deterministic local world for movement and lane testing.
// It defaults to a disposable database so it cannot modify the normal save.
const fs = require('node:fs');
const path = require('node:path');

const dbPath = process.env.DATABASE_PATH || path.resolve('.data/family-test.sqlite');
if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
process.env.DATABASE_PATH = dbPath;

const bcrypt = require('bcrypt');
const db = require('../server/db');

const run = (sql, params = []) => new Promise((resolve, reject) =>
  db.run(sql, params, function onRun(err) { if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes }); })
);
const get = (sql, params = []) => new Promise((resolve, reject) =>
  db.get(sql, params, (err, row) => err ? reject(err) : resolve(row))
);

async function main() {
  await db.ready;
  const gameName = 'Family QA World';
  const password = 'family-test';

  await run('BEGIN IMMEDIATE');
  try {
    const old = await get('SELECT id FROM games WHERE name = ?', [gameName]);
    if (old) {
      const gameId = old.id;
      const tables = [
        'lane_tap_queue', 'lane_transits', 'lane_itineraries', 'lane_edges_runtime',
        'lane_taps', 'lane_edges', 'movement_history', 'movement_orders',
        'turn_locks', 'turns', 'object_visibility', 'sector_objects',
        'game_players', 'sectors'
      ];
      for (const table of tables) {
        const column = table === 'lane_tap_queue' ? 'ship_id' :
          ['lane_edges_runtime', 'lane_edges', 'lane_taps'].includes(table) ? 'edge_id' :
          ['turns', 'turn_locks', 'object_visibility', 'sectors', 'game_players'].includes(table) ? 'game_id' :
          ['lane_transits', 'lane_itineraries'].includes(table) ? 'ship_id' :
          ['movement_orders', 'movement_history'].includes(table) ? 'object_id' : null;
        if (table === 'sector_objects') await run('DELETE FROM sector_objects WHERE sector_id IN (SELECT id FROM sectors WHERE game_id = ?)', [gameId]);
        else if (table === 'lane_edges') await run('DELETE FROM lane_edges WHERE sector_id IN (SELECT id FROM sectors WHERE game_id = ?)', [gameId]);
        else if (table === 'lane_taps') await run('DELETE FROM lane_taps WHERE edge_id IN (SELECT id FROM lane_edges WHERE sector_id IN (SELECT id FROM sectors WHERE game_id = ?))', [gameId]);
        else if (table === 'lane_edges_runtime') await run('DELETE FROM lane_edges_runtime WHERE edge_id IN (SELECT id FROM lane_edges WHERE sector_id IN (SELECT id FROM sectors WHERE game_id = ?))', [gameId]);
        else if (table === 'lane_tap_queue') await run('DELETE FROM lane_tap_queue WHERE ship_id IN (SELECT id FROM sector_objects WHERE sector_id IN (SELECT id FROM sectors WHERE game_id = ?))', [gameId]);
        else if (column === 'game_id') await run(`DELETE FROM ${table} WHERE game_id = ?`, [gameId]);
        else if (column === 'ship_id') await run(`DELETE FROM ${table} WHERE ship_id IN (SELECT id FROM sector_objects WHERE sector_id IN (SELECT id FROM sectors WHERE game_id = ?))`, [gameId]);
        else if (column === 'object_id') await run(`DELETE FROM ${table} WHERE object_id IN (SELECT id FROM sector_objects WHERE sector_id IN (SELECT id FROM sectors WHERE game_id = ?))`, [gameId]);
      }
      await run('DELETE FROM games WHERE id = ?', [gameId]);
    }

    const hash = await bcrypt.hash(password, 10);
    await run('INSERT OR IGNORE INTO users(username,password) VALUES(?,?)', ['family-alice', hash]);
    await run('INSERT OR IGNORE INTO users(username,password) VALUES(?,?)', ['family-bob', hash]);
    const alice = (await get('SELECT id FROM users WHERE username = ?', ['family-alice'])).id;
    const bob = (await get('SELECT id FROM users WHERE username = ?', ['family-bob'])).id;
    const game = (await run('INSERT INTO games(name,mode,status,auto_turn_minutes) VALUES(?,?,?,?)', [gameName, 'family-test', 'active', null])).lastID;
    const sector = (await run('INSERT INTO sectors(game_id,name,archetype,width,height,generation_seed,generation_completed) VALUES(?,?,?,?,?,?,1)', [game, 'QA Sector', 'standard', 5000, 5000, 424242])).lastID;
    await run('INSERT INTO game_players(user_id,game_id,setup_completed) VALUES(?,?,1)', [alice, game]);
    await run('INSERT INTO game_players(user_id,game_id,setup_completed) VALUES(?,?,1)', [bob, game]);
    await run('INSERT INTO turns(game_id,turn_number,status) VALUES(?,1,\'waiting\')', [game]);

    const object = async (type, x, y, ownerId, meta, radius = 1) =>
      (await run('INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta,radius,celestial_type) VALUES(?,?,?,?,?,?,?,?)', [sector, type, x, y, ownerId, JSON.stringify(meta || {}), radius, type])).lastID;

    await object('star', 2500, 2500, null, { name: 'Primary Star', alwaysKnown: true }, 120);
    await object('planet', 1500, 1700, null, { name: 'P1', alwaysKnown: true }, 28);
    await object('planet', 3500, 3200, null, { name: 'P2', alwaysKnown: true }, 34);
    await object('planet', 850, 900, null, { name: 'P3', alwaysKnown: true }, 30);
    await object('station', 2100, 2500, alice, { name: 'Alice Outpost', hp: 100, alwaysKnown: true }, 12);
    const aliceShip = await object('ship', 1950, 2500, alice, { name: 'Alice Scout', movementSpeed: 120, warpSpeedMultiplier: 1, hp: 100 });
    await object('ship', 3200, 3000, bob, { name: 'Bob Scout', movementSpeed: 120, warpSpeedMultiplier: 1, hp: 100 });
    await object('asteroid', 2000, 2450, null, { name: 'Obstacle A' }, 18);
    await object('asteroid', 2200, 2500, null, { name: 'Obstacle B' }, 18);

    const lane = async (name, points, speed = 100) => {
      const edge = (await run('INSERT INTO lane_edges(sector_id,cls,region_id,polyline_json,width_core,width_shoulder,lane_speed,cap_base,headway,mass_limit) VALUES(?,?,?,?,?,?,?,?,?,?)', [sector, name, 'qa', JSON.stringify(points), 150, 250, speed, 100, 20, 'all'])).lastID;
      await run('INSERT INTO lane_edges_runtime(edge_id,load_cu) VALUES(?,0)', [edge]);
      return edge;
    };
    const spur = await lane('qa-spur', [{ x: 1950, y: 2500 }, { x: 1200, y: 2500 }, { x: 850, y: 900 }]);
    const ring = await lane('qa-ring', [{ x: 1950, y: 2500 }, { x: 2500, y: 1200 }, { x: 3500, y: 3200 }, { x: 850, y: 900 }]);
    for (const [edge, x, y] of [[spur, 1950, 2500], [spur, 1200, 2500], [ring, 1950, 2500], [ring, 2500, 1200], [ring, 3500, 3200]]) {
      await run('INSERT INTO lane_taps(edge_id,x,y) VALUES(?,?,?)', [edge, x, y]);
    }

    await run('COMMIT');
    console.log(JSON.stringify({ database: dbPath, gameId: game, sectorId: sector, users: [{ username: 'family-alice', password }, { username: 'family-bob', password }], ships: { alice: aliceShip }, lanes: { spur, ring } }, null, 2));
  } catch (error) {
    await run('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    db.close(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
