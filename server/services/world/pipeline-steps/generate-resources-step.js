const { BaseStep } = require('./base-step');

class GenerateResourceNodesStep extends BaseStep {
    constructor() { super('generateResources'); }
    async execute(context) {
        const { spawnNodesForSector } = require('../resource-node-generator');
        await spawnNodesForSector(context.sectorId);
        this.result = { resourcesGenerated: true };
    }
}

module.exports = { GenerateResourceNodesStep };


