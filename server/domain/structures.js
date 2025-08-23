// Structure type definitions (as cargo items)
const STRUCTURE_TYPES = {
    'storage-box': {
        name: 'Storage Box',
        emoji: '📦',
        description: 'Deployable storage structure',
        cargoCapacity: 25,
        deployable: true
    },
    'warp-beacon': {
        name: 'Warp Beacon',
        emoji: '🌌',
        description: 'Deployable warp destination',
        deployable: true,
        publicAccess: true
    },
    'interstellar-gate': {
        name: 'Interstellar Gate',
        emoji: '🌀',
        description: 'Gateway between solar systems',
        deployable: true,
        publicAccess: true,
        requiresSectorSelection: true
    },
    'sun-station': {
        name: 'Sun Station',
        emoji: '☀️',
        description: 'Anchors in orbit around a star',
        deployable: true,
        requiresAnchor: true,
        anchorType: 'star',
        cargoCapacity: 50
    },
    'planet-station': {
        name: 'Planet Station',
        emoji: '🪐',
        description: 'Anchors in orbit around a planet',
        deployable: true,
        requiresAnchor: true,
        anchorType: 'planet',
        cargoCapacity: 50
    },
    'moon-station': {
        name: 'Moon Station',
        emoji: '🌘',
        description: 'Anchors in orbit around a moon',
        deployable: true,
        requiresAnchor: true,
        anchorType: 'moon',
        cargoCapacity: 50
    }
};

module.exports = { STRUCTURE_TYPES };


