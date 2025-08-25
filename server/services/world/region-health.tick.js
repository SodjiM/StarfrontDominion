const db = require('../../db');

async function tickRegionHealth(gameId, turnNumber) {
    // For each sector in this game, decay or upkeep region health slightly and write history
    const sectors = await new Promise((resolve) => db.all('SELECT id FROM sectors WHERE game_id = ?', [gameId], (e, rows) => resolve(rows || [])));
    for (const s of (sectors || [])) {
        const sectorId = s.id;
        const regions = await new Promise((resolve) => db.all('SELECT region_id, health FROM regions WHERE sector_id = ?', [sectorId], (e, rows) => resolve(rows || [])));
        for (const r of (regions || [])) {
            const id = String(r.region_id);
            let h = Number(r.health || 50);
            // Simple passive drift toward 55
            if (h < 55) h = Math.min(55, h + 1);
            else if (h > 55) h = Math.max(55, h - 1);
            await new Promise((resolve) => db.run('UPDATE regions SET health = ?, updated_at = CURRENT_TIMESTAMP WHERE sector_id = ? AND region_id = ?', [h, sectorId, id], () => resolve()));
            await new Promise((resolve) => db.run(
                'INSERT INTO region_health_history (sector_id, region_id, turn_number, health) VALUES (?, ?, ?, ?)',
                [sectorId, id, turnNumber, h],
                () => resolve()
            ));
        }
    }
}

module.exports = { tickRegionHealth };


