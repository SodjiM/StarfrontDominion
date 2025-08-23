const { SHIP_BLUEPRINTS, computeAllRequirements } = require('./blueprints');
const { Abilities } = require('./abilities');

class BlueprintsService {
    listBlueprints() {
        const enriched = (SHIP_BLUEPRINTS || []).map((bp) => {
            const abilitiesMeta = (bp.abilities || []).filter((k) => !!Abilities[k]).map((key) => {
                const a = Abilities[key];
                return {
                    key,
                    name: a.name,
                    type: a.type,
                    target: a.target || 'self',
                    cooldown: a.cooldown || 0,
                    range: a.range || null,
                    energyCost: a.energyCost || 0,
                    shortDescription: a.shortDescription || a.description || null,
                    longDescription: a.longDescription || null,
                };
            });
            return {
                ...bp,
                abilities: bp.abilities || [],
                abilitiesMeta,
                requirements: computeAllRequirements(bp),
            };
        });
        return enriched;
    }
}

module.exports = { BlueprintsService };


