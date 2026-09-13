// Compatibility wrapper for callers of the pre-pipeline API.

const SystemGenerator = {
    async generateSystem(sectorId, archetypeKey) {
        const { SectorGenerationPipeline } = require('./generation-pipeline');
        return new SectorGenerationPipeline(sectorId, { archetypeKey }).execute();
    }
};

module.exports = { SystemGenerator };
