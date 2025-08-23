export function getUnitIcon(type) {
    const celestialType = type?.celestial_type || type;
    const icons = {
        'ship': '🚢', 'station': '🏭', 'starbase': '🛰️', 'storage-structure': '📦', 'warp-beacon': '🌌', 'interstellar-gate': '🌀',
        'star': '⭐', 'planet': '🪐', 'moon': '🌙', 'belt': '🪨', 'nebula': '☁️', 'wormhole': '🌀', 'jump-gate': '🚪', 'derelict': '🛸', 'graviton-sink': '🕳️',
        'asteroid': '🪨', 'anomaly': '❓'
    };
    return icons[celestialType] || icons[type] || '⚪';
}

export function formatArchetype(archetype) {
    const archetypes = {
        'resource-rich': 'Resource Rich ⛏️',
        'asteroid-heavy': 'Asteroid Belt 🪨',
        'nebula': 'Nebula Cloud ☁️',
        'binary-star': 'Binary Star ⭐⭐'
    };
    return archetypes[archetype] || (archetype || 'Unknown');
}


