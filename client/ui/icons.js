export function getUnitIcon(typeOrUnit) {
    const unit = (typeOrUnit && typeof typeOrUnit === 'object' && typeOrUnit.type) ? typeOrUnit : null;
    const type = unit ? unit.type : typeOrUnit;
    const celestialType = type?.celestial_type || type;
    if (unit && typeof window !== 'undefined' && window.SFSprites) {
        const meta = unit.meta || {};
        const key = (meta.blueprintId || meta.hull || meta.stationClass || (unit.type==='ship'?'ship':unit.type)).toLowerCase();
        const url = window.SFSprites.getSpriteUrlForKey ? window.SFSprites.getSpriteUrlForKey(key) : null;
        if (url) {
            return `<img src="${url}" alt="ship" style="width:16px;height:16px;image-rendering:auto;vertical-align:-2px;border-radius:2px;"/>`;
        }
    }
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


