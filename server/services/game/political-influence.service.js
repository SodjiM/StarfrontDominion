const dbDefault = require('../../db');

const all = (db, sql, args) => new Promise((resolve, reject) => db.all(sql, args, (e, rows) => e ? reject(e) : resolve(rows || [])));
const run = (db, sql, args) => new Promise((resolve, reject) => db.run(sql, args, e => e ? reject(e) : resolve()));

async function processPoliticalInfluence(gameId, turnNumber, db = dbDefault) {
  const players = await all(db, `SELECT user_id FROM game_players WHERE game_id=?`, [gameId]);
  for (const player of players) {
    const row = await new Promise((resolve, reject) => db.get(`SELECT COUNT(*) AS count FROM sector_objects station JOIN sector_objects host ON host.id=station.parent_object_id JOIN sectors s ON s.id=station.sector_id WHERE s.game_id=? AND station.owner_id=? AND station.type='station' AND station.meta LIKE '%planet-station%' AND (host.meta LIKE '%ocean%' OR host.celestial_type='ocean')`, [gameId, player.user_id], (e, r) => e ? reject(e) : resolve(r)));
    const amount = Number(row?.count || 0);
    if (amount > 0) await run(db, `UPDATE game_players SET political_influence=COALESCE(political_influence,0)+? WHERE game_id=? AND user_id=?`, [amount,gameId,player.user_id]);
  }
}

module.exports = { processPoliticalInfluence };
