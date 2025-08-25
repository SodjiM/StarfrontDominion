const db = require('../../../db');
const { BaseStep } = require('./base-step');

class CreateStartingObjectsStep extends BaseStep {
    constructor() { super('createStartingObjects'); }
    async execute(context, options) {
        if (!options.createStartingObjects || !options.player) { this.result = { skipped: true }; return; }
        // Minimal: ensure at least one station exists; otherwise create one near a planet/sun
        const exists = await new Promise((resolve)=>db.get('SELECT id FROM sector_objects WHERE sector_id = ? AND type = "station" LIMIT 1', [context.sectorId], (e,r)=>resolve(!!r)));
        if (!exists) {
            // Pick a planet; if none, place near sun
            const planet = await new Promise((resolve)=>db.get('SELECT id, x, y FROM sector_objects WHERE sector_id = ? AND celestial_type = "planet" LIMIT 1', [context.sectorId], (e,r)=>resolve(r||null)));
            let x = 2500, y = 2500;
            if (planet) {
                const angle = Math.random() * Math.PI * 2; const dist = 22;
                x = Math.max(1, Math.min(4999, Math.round(planet.x + Math.cos(angle) * dist)));
                y = Math.max(1, Math.min(4999, Math.round(planet.y + Math.sin(angle) * dist)));
            } else {
                const sun = await new Promise((resolve)=>db.get('SELECT x,y FROM sector_objects WHERE sector_id = ? AND celestial_type = "star" LIMIT 1', [context.sectorId], (e,r)=>resolve(r||{x:2500,y:2500})));
                const angle = Math.random() * Math.PI * 2; const dist = 28;
                x = Math.max(1, Math.min(4999, Math.round(sun.x + Math.cos(angle) * dist)));
                y = Math.max(1, Math.min(4999, Math.round(sun.y + Math.sin(angle) * dist)));
            }
            const meta = JSON.stringify({ name: `${options.player.username || 'Player'} Station`, hp: 100, maxHp: 100, scanRange: 200, cargoCapacity: 50, stationClass: 'planet-station' });
            await new Promise((resolve)=>db.run(
                `INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta, parent_object_id) VALUES (?, 'station', ?, ?, ?, ?, NULL)`,
                [context.sectorId, x, y, options.player.user_id, meta], ()=>resolve()
            ));
        }
        this.result = { startingObjectsCreated: true };
    }
}

module.exports = { CreateStartingObjectsStep };


