// Builds mineral_rules per region; helpers to spawn resource_nodes will be integrated with resource-node-generator
const db = require('../../db');

async function upsertMineralRule({ sectorId, regionId, mineral, weight, gated, unlockThreshold }) {
    return new Promise((resolve, reject) => db.run(
        `INSERT INTO mineral_rules (sector_id, region_id, mineral_name, weight, gated, unlock_threshold)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sectorId, regionId, mineral, weight, gated ? 1 : 0, unlockThreshold ?? null],
        (e)=> e?reject(e):resolve()
    ));
}

module.exports = { upsertMineralRule };


