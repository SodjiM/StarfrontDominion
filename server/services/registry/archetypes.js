// Sector archetypes registry

const SECTOR_ARCHETYPES = {
    standard: {
        key: 'standard',
        name: 'Standard Sector',
        weights: { star: 1, planet: 3, moon: 2, asteroid_belt: 2, nebula: 1 }
    },
    resource_rich: {
        key: 'resource_rich',
        name: 'Resource-Rich Belt',
        weights: { star: 1, planet: 2, moon: 2, asteroid_belt: 4, nebula: 1 }
    },
    nebula: {
        key: 'nebula',
        name: 'Nebula Cloud',
        weights: { star: 1, planet: 2, moon: 1, asteroid_belt: 1, nebula: 4 }
    }
};

const ALL_ARCHETYPES_KEYS = Object.keys(SECTOR_ARCHETYPES);

function getArchetype(key) {
    return SECTOR_ARCHETYPES[key] || SECTOR_ARCHETYPES.standard;
}

module.exports = { SECTOR_ARCHETYPES, ALL_ARCHETYPES_KEYS, getArchetype };

