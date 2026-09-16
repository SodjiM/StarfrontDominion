const db = require('../../db');

async function tickRegionHealth(gameId, turnNumber) {
    // Health changes are event-driven. Until incidents and explicit
    // stabilization actions exist, a turn records history without passive
    // drift or station-based automatic healing.
    const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
    const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, (error) => error ? reject(error) : resolve()));
    const sectors = await all('SELECT id FROM sectors WHERE game_id = ?', [gameId]);
    for (const s of (sectors || [])) {
        const sectorId = s.id;
        const regions = await all('SELECT region_id, health FROM regions WHERE sector_id = ?', [sectorId]);
        for (const r of (regions || [])) {
            const id = String(r.region_id);
            const h = Number(r.health ?? 50);
            await run(
                `INSERT INTO region_health_history (sector_id, region_id, turn_number, health)
                 SELECT ?, ?, ?, ?
                  WHERE NOT EXISTS (
                    SELECT 1 FROM region_health_history
                     WHERE sector_id = ? AND region_id = ? AND turn_number = ?
                  )`,
                [sectorId, id, turnNumber, h, sectorId, id, turnNumber]
            );
        }
    }
}

module.exports = { tickRegionHealth };
