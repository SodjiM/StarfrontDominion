const { BaseStep } = require('./base-step');

class GenerateResourceNodesStep extends BaseStep {
    constructor() { super('generateResources'); }
    async execute(context) {
        const { spawnNodesForSector } = require('../resource-node-generator');
        await spawnNodesForSector(context.sectorId, { seed: context.seed, rng: context.rngStreams.resources });
        await require('../physical-placement').clearResourceOverlaps(require('../../../db'),context.sectorId);
        this.result = { resourcesGenerated: true };
    }
}

module.exports = { GenerateResourceNodesStep };

