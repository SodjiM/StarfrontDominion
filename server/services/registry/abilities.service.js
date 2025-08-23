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
            };
        });
        return abilities;
    }
}

module.exports = { AbilitiesService };


