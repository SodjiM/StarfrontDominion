// Orchestrates seeded system generation per archetype
const db = require('../../db');
const { mulberry32, hashString } = require('./rng');

async function seedSector({ sectorId, archetypeKey, seedBase }) {
    const seed = Number(seedBase ?? 0) ^ Number(sectorId || 0) ^ hashString(String(archetypeKey || ''));
    const rng = mulberry32(seed);

    // Resolve archetype module
    const key = String(archetypeKey || 'standard').toUpperCase();
    let generator;
    try {
        if (key === 'WORMHOLE' || key === 'WORMHOLE_CLUSTER') generator = require('./seeders/archetype-wormhole');
        else if (key === 'ASTBELT' || key === 'ASTEROID_HEAVY') generator = require('./seeders/archetype-asteroid-heavy');
        else generator = require('./seeders/archetype-standard');
    } catch {
        generator = require('./seeders/archetype-standard');
    }

    const plan = generator.plan({ sectorId, seed, rng });
    await generator.persist({ sectorId, plan, db });

    await new Promise((resolve) => db.run('UPDATE sectors SET generation_seed = ?, generation_completed = 1 WHERE id = ?', [seed, sectorId], () => resolve()));
    return { success: true, sectorId, archetypeKey, seed };
}

module.exports = { seedSector };


