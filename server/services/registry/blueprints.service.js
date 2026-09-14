const { SHIP_BLUEPRINTS, computeAllRequirements } = require('./blueprints');
const { Abilities } = require('./abilities');

const RESOURCE_LABELS = {
    'ferrite-alloy': 'Ferrite Alloy', crytite: 'Crytite', vornite: 'Vornite',
    fluxium: 'Fluxium', auralite: 'Auralite', corvexite: 'Corvexite',
    magnetrine: 'Magnetrine', gravium: 'Gravium', solarite: 'Solarite'
};

function displayRequirements(requirements) {
    const map = (group) => Object.fromEntries(Object.entries(group || {}).map(([key, value]) => [RESOURCE_LABELS[key] || key, value]));
    return { core: map(requirements?.core), specialized: map(requirements?.specialized) };
}
function requirementDetails(requirements) {
    const map = (group) => Object.entries(group || {}).map(([key, quantity]) => ({ key, label: RESOURCE_LABELS[key] || key, quantity }));
    return { core: map(requirements?.core), specialized: map(requirements?.specialized) };
}

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
                    effectKey: a.effectKey || null,
                    duration: typeof a.duration === 'number' ? a.duration : null,
                    movementFlatBonus: typeof a.movementFlatBonus === 'number' ? a.movementFlatBonus : null,
                    movementBonus: typeof a.movementBonus === 'number' ? a.movementBonus : null,
                    healPercentPerTurn: typeof a.healPercentPerTurn === 'number' ? a.healPercentPerTurn : null,
                    scanRangeMultiplier: typeof a.scanRangeMultiplier === 'number' ? a.scanRangeMultiplier : null,
                    baseDamage: typeof a.baseDamage === 'number' ? a.baseDamage : null,
                    optimal: typeof a.optimal === 'number' ? a.optimal : null,
                    falloff: typeof a.falloff === 'number' ? a.falloff : null,
                    tags: Array.isArray(a.tags) ? a.tags : [],
                    shortDescription: a.shortDescription || a.description || null,
                    longDescription: a.longDescription || null,
                };
            });
            return {
                ...bp,
                abilities: bp.abilities || [],
                abilitiesMeta,
                requirements: displayRequirements(computeAllRequirements(bp)),
                requirementKeys: computeAllRequirements(bp),
                requirementDetails: requirementDetails(computeAllRequirements(bp)),
            };
        });
        return enriched;
    }
}

module.exports = { BlueprintsService };
