// Regional mineral rules are abundance biases under resource-profile-v2.
// Legacy health-gating columns remain in SQLite only for save compatibility.
const db = require('../../db');

async function upsertMineralBias({ sectorId, regionId, mineral, weight }) {
    return new Promise((resolve, reject) => db.run(
        `INSERT INTO mineral_rules (sector_id, region_id, mineral_name, weight, gated, unlock_threshold)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sectorId, regionId, mineral, weight, 0, null],
        (e)=> e?reject(e):resolve()
    ));
}

// Compatibility alias for any older importer. Gating arguments are
// intentionally ignored because health no longer controls mineral access.
const upsertMineralRule = upsertMineralBias;

module.exports = { upsertMineralBias, upsertMineralRule };

