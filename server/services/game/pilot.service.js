const dbDefault = require('../../db');

const query = (db, method, sql, params = []) => new Promise((resolve, reject) => {
  db[method](sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

function pilotCost(meta) {
  try { return Math.max(1, Number(JSON.parse(meta || '{}').pilotCost || 1)); } catch { return 1; }
}

async function capacityFor(db, gameId, userId) {
  const rows = await query(db, 'all', `SELECT so.meta FROM sector_objects so
    JOIN sectors s ON s.id = so.sector_id
    WHERE s.game_id = ? AND so.owner_id = ? AND so.type IN ('station','starbase')`, [gameId, userId]);
  let capacity = 5;
  for (const row of rows || []) {
    let cls = null; try { cls = JSON.parse(row.meta || '{}').stationClass; } catch {}
    capacity += cls === 'sun-station' ? 10 : cls === 'moon-station' ? 3 : 5;
  }
  return capacity;
}

async function deployedFor(db, gameId, userId) {
  const rows = await query(db, 'all', `SELECT so.meta FROM sector_objects so
    JOIN sectors s ON s.id = so.sector_id
    WHERE s.game_id = ? AND so.owner_id = ? AND so.type = 'ship'`, [gameId, userId]);
  return (rows || []).reduce((sum, row) => sum + pilotCost(row.meta), 0);
}

async function recoveringFor(db, gameId, userId) {
  const row = await query(db, 'get', `SELECT COALESCE(SUM(count),0) AS count FROM dead_pilots_queue WHERE game_id = ? AND user_id = ?`, [gameId, userId]);
  return Number(row?.count || 0);
}

async function ensureLedger(db, gameId, userId, currentTurn = 1) {
  const capacity = await capacityFor(db, gameId, userId);
  const deployed = await deployedFor(db, gameId, userId);
  const recovering = await recoveringFor(db, gameId, userId);
  let ledger = await query(db, 'get', `SELECT * FROM pilot_ledgers WHERE game_id=? AND user_id=?`, [gameId, userId]);
  if (!ledger) {
    const available = Math.max(0, capacity - deployed - recovering);
    await query(db, 'run', `INSERT INTO pilot_ledgers(game_id,user_id,capacity,available,regen_rate,regen_progress,last_regenerated_turn) VALUES(?,?,?,?,?,?,?)`, [gameId,userId,capacity,available,1,0,currentTurn]);
    ledger = { capacity, available, regen_rate: 1, regen_progress: 0, last_regenerated_turn: currentTurn };
  } else {
    const maxAvailable = Math.max(0, capacity - deployed - recovering);
    const available = Math.min(Number(ledger.available || 0) + Math.max(0, capacity - (Number(ledger.capacity || capacity))), maxAvailable);
    if (available !== Number(ledger.available || 0) || Number(ledger.capacity || 0) !== capacity) await query(db, 'run', `UPDATE pilot_ledgers SET capacity=?, available=?, updated_at=CURRENT_TIMESTAMP WHERE game_id=? AND user_id=?`, [capacity,available,gameId,userId]);
    ledger.capacity = capacity;
    ledger.available = available;
  }
  return { capacity, deployed, recovering, available: Math.max(0, Number(ledger.available || 0)), regenRate: Math.max(0.1, Number(ledger.regen_rate || 1)), regenProgress: Number(ledger.regen_progress || 0), lastRegeneratedTurn: Number(ledger.last_regenerated_turn || 0) };
}

async function getPilotStats(gameId, userId, currentTurn = 1, db = dbDefault) {
  return ensureLedger(db, Number(gameId), Number(userId), Number(currentTurn));
}

async function reservePilots(gameId, userId, amount = 1, currentTurn = 1, db = dbDefault) {
  const stats = await ensureLedger(db, gameId, userId, currentTurn);
  amount = Math.max(1, Number(amount));
  if (stats.available < amount) return { success: false, stats };
  await query(db, 'run', `UPDATE pilot_ledgers SET available=available-?, updated_at=CURRENT_TIMESTAMP WHERE game_id=? AND user_id=? AND available>=?`, [amount,gameId,userId,amount]);
  return { success: true, stats: { ...stats, available: stats.available - amount, deployed: stats.deployed + amount } };
}

async function releasePilots(gameId, userId, amount = 1, db = dbDefault) {
  amount = Math.max(1, Number(amount));
  await query(db, 'run', `UPDATE pilot_ledgers SET available=available+?, updated_at=CURRENT_TIMESTAMP WHERE game_id=? AND user_id=?`, [amount, gameId, userId]);
  return { success: true };
}

async function processPilotTurn(gameId, turnNumber, db = dbDefault) {
  const players = await query(db, 'all', `SELECT user_id FROM game_players WHERE game_id=?`, [gameId]);
  for (const p of players || []) {
    const stats = await ensureLedger(db, gameId, p.user_id, turnNumber);
    const hosts = await query(db, 'all', `SELECT parent.meta AS host_meta FROM sector_objects so JOIN sector_objects parent ON parent.id=so.parent_object_id WHERE so.owner_id=? AND so.type='station'`, [p.user_id]);
    const regenMultiplier = (hosts || []).reduce((sum, row) => { const meta = (() => { try { return JSON.parse(row.host_meta || '{}'); } catch { return {}; } })(); return sum + (meta.gameplayType === 'yellowDwarf' || meta.visualType === 'yellowDwarf' || meta.gameplayType === 'ocean' || meta.visualType === 'ocean' ? 0.10 : 0); }, 0);
    let regeneration = stats.regenProgress + stats.regenRate * (1 + Math.min(0.5, regenMultiplier));
    let budget = Math.floor(regeneration);
    regeneration -= budget;
    let recovered = 0;
    let recruited = 0;
    const due = await query(db, 'all', `SELECT id,count FROM dead_pilots_queue WHERE game_id=? AND user_id=? AND respawn_turn<=? ORDER BY respawn_turn,id`, [gameId,p.user_id,turnNumber]);
    for (const row of due || []) {
      if (budget <= 0) break;
      const amount = Math.min(budget, Number(row.count || 0));
      await query(db, 'run', `UPDATE dead_pilots_queue SET count=count-? WHERE id=?`, [amount,row.id]);
      await query(db, 'run', `DELETE FROM dead_pilots_queue WHERE id=? AND count<=0`, [row.id]);
      await query(db, 'run', `UPDATE pilot_ledgers SET available=available+?, regen_progress=?, last_regenerated_turn=?, updated_at=CURRENT_TIMESTAMP WHERE game_id=? AND user_id=?`, [amount,regeneration,turnNumber,gameId,p.user_id]);
      recovered += amount;
      budget -= amount;
    }
    if (budget > 0 && stats.available + budget < Math.max(0, stats.capacity - stats.deployed - stats.recovering)) {
      await query(db, 'run', `UPDATE pilot_ledgers SET available=MIN(available+?,?), regen_progress=?, last_regenerated_turn=?, updated_at=CURRENT_TIMESTAMP WHERE game_id=? AND user_id=?`, [budget, Math.max(0,stats.capacity-stats.deployed-stats.recovering),regeneration,turnNumber,gameId,p.user_id]);
      recruited = budget;
    }
    if (!recovered && !recruited) await query(db, 'run', `UPDATE pilot_ledgers SET regen_progress=?, last_regenerated_turn=?, updated_at=CURRENT_TIMESTAMP WHERE game_id=? AND user_id=?`, [regeneration,turnNumber,gameId,p.user_id]);
    if (recovered || recruited) await query(db, 'run', `INSERT INTO turn_pilot_events(game_id,turn_number,user_id,recovered,recruited) VALUES(?,?,?,?,?)`, [gameId,turnNumber,p.user_id,recovered,recruited]);
  }
}

module.exports = { getPilotStats, reservePilots, releasePilots, processPilotTurn, capacityFor, deployedFor, recoveringFor };
