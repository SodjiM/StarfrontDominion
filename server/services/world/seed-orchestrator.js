// Orchestrates seeded system generation per archetype
const db = require('../../db');
const { mulberry32, hashString } = require('./rng');

async function seedSector({ sectorId, archetypeKey, seedBase }) {
    const seed = Number(seedBase ?? 0) ^ Number(sectorId || 0) ^ hashString(String(archetypeKey || ''));
    const rng = mulberry32(seed);

    // Resolve archetype module via unified registry
    const { getArchetypeModule } = require('./unified-archetype-registry');
    const archetypeModule = getArchetypeModule(archetypeKey);

    const plan = archetypeModule.plan({ sectorId, seed, rng });
    await archetypeModule.persist({ sectorId, plan, db });

    // Spawn resource nodes now that belts/regions are persisted
    try {
        const { spawnNodesForSector } = require('./resource-node-generator');
        await spawnNodesForSector(sectorId);
    } catch (e) {
        // spawnNodesForSector failed during seeding (silently handled)
    }

    await new Promise((resolve) => db.run('UPDATE sectors SET generation_seed = ?, generation_completed = 1 WHERE id = ?', [seed, sectorId], () => resolve()));
    return { success: true, sectorId, archetypeKey, seed };
}

module.exports = { seedSector };


