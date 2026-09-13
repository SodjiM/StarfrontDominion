// Compatibility wrapper. New generation must go through SectorGenerationPipeline.

async function seedSector({ sectorId, archetypeKey, seedBase }) {
    const { SectorGenerationPipeline } = require('./generation-pipeline');
    return new SectorGenerationPipeline(sectorId, { archetypeKey, seedBase }).execute();
}

module.exports = { seedSector };

