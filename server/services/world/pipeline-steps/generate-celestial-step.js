const db = require('../../../db');
const { BaseStep } = require('./base-step');

class GenerateCelestialObjectsStep extends BaseStep {
    constructor() { super('generateCelestial'); }
    async execute(context) {
        const { getArchetypeModule } = require('../unified-archetype-registry');
        // Skip if already has a star
        const existing = await new Promise((resolve)=>db.get('SELECT COUNT(1) as c FROM sector_objects WHERE sector_id = ? AND celestial_type = "star"', [context.sectorId], (e,r)=>resolve(Number(r?.c||0))));
        if (existing > 0) { this.result = { skipped: true }; return; }
        const mod = getArchetypeModule(context.archetype);
        const plan = mod.plan({ sectorId: context.sectorId, seed: context.seed, rng: context.rng });
        await mod.persist({ sectorId: context.sectorId, plan, db });
        this.result = { objectsGenerated: true };
    }
}

module.exports = { GenerateCelestialObjectsStep };


