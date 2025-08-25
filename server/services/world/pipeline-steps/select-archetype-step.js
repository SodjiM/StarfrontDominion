const db = require('../../../db');
const { BaseStep } = require('./base-step');
const { hashString, mulberry32 } = require('../rng');
const { resolveKey } = require('../unified-archetype-registry');

class SelectArchetypeStep extends BaseStep {
    constructor() { super('selectArchetype'); }
    async execute(context, options) {
        const row = await new Promise((resolve)=>db.get('SELECT archetype FROM sectors WHERE id = ?', [context.sectorId], (e,r)=>resolve(r||{})));
        let archetype = row?.archetype;
        if (!archetype) {
            const picked = options.archetypeKey || 'standard';
            archetype = resolveKey(picked);
            await new Promise((resolve)=>db.run('UPDATE sectors SET archetype = ? WHERE id = ?', [archetype, context.sectorId], ()=>resolve()));
        }
        const seedBase = Number(options.seedBase ?? 0);
        const seed = seedBase ^ Number(context.sectorId || 0) ^ hashString(String(archetype || ''));
        context.archetype = archetype; context.seed = seed; context.rng = mulberry32(seed);
        this.result = { archetype, seed };
    }
}

module.exports = { SelectArchetypeStep };


