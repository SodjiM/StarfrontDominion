const defaultDb = require('../../db');
const { RegionInfrastructureService } = require('./region-infrastructure.service');

class RegionPressureSnapshotService {
    constructor(database = defaultDb) { this.db = database; }

    all(sql, params = []) {
        return new Promise((resolve, reject) => this.db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => this.db.run(sql, params, function(error) {
            if (error) reject(error);
            else resolve({ changes: this.changes, lastID: this.lastID });
        }));
    }

    async snapshotGame(gameId, turnNumber) {
        const sectors = await this.all('SELECT id FROM sectors WHERE game_id=? ORDER BY id', [gameId]);
        let inserted = 0;
        const infrastructure = new RegionInfrastructureService(this.db);
        for (const sector of sectors) {
            const status = await infrastructure.getSectorStatus(sector.id);
            for (const region of status.regions) {
                const result = await this.run(
                    `INSERT OR IGNORE INTO region_pressure_history
                     (sector_id,region_id,turn_number,capacity,infrastructure_load,utilization,pressure_score,pressure_band,status_version,catalog_version)
                     VALUES(?,?,?,?,?,?,?,?,?,?)`,
                    [sector.id, region.id, turnNumber, region.capacity, region.load, region.utilization, region.pressureScore, region.pressureBand, status.version, status.catalogVersion]
                );
                inserted += result.changes;
            }
        }
        return { gameId: Number(gameId), turnNumber: Number(turnNumber), inserted };
    }
}

module.exports = { RegionPressureSnapshotService };
