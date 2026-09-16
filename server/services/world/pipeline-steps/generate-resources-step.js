const { BaseStep } = require('./base-step');

class GenerateResourceNodesStep extends BaseStep {
    constructor() { super('generateResources'); }
    async execute(context) {
        const { getArchetypeContract } = require('../unified-archetype-registry');
        const { createResourceProfile } = require('../resource-profile');
        const { spawnNodesForSector } = require('../resource-node-generator');
        const contract = getArchetypeContract(context.archetype);
        const resourceProfile = createResourceProfile({
            archetypeKey: contract.key,
            signatureMinerals: contract.signatureMinerals,
            randomSpecialtyCount: contract.randomSpecialtyCount,
            rng: context.rngStreams.resourceProfile
        });
        context.resourceProfile = resourceProfile;
        await spawnNodesForSector(context.sectorId, {
            seed: context.seed,
            rng: context.rngStreams.resources,
            resourceProfile
        });
        await require('../physical-placement').clearResourceOverlaps(require('../../../db'),context.sectorId);
        this.result = { resourcesGenerated: true, resourceProfile };
    }
}

module.exports = { GenerateResourceNodesStep };
