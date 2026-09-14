const { Abilities } = require('./abilities');

class AbilitiesService {
    listAbilities() {
        const abilities = {};
        Object.keys(Abilities || {}).forEach((key) => {
            const a = Abilities[key] || {};
            abilities[key] = {
                key: a.key || key,
                name: a.name || key,
                description: a.description || null,
                shortDescription: a.shortDescription || null,
                longDescription: a.longDescription || null,
                type: a.type || 'active',
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
            };
        });
        return abilities;
    }
}

module.exports = { AbilitiesService };
