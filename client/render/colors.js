// Color helpers for rendering

export function getPlayerColors(game, ownerId) {
    try {
        const players = game.gameState?.players || [];
        const p = players.find(pl => pl.userId === ownerId);
        return { primary: p?.colorPrimary || '#4caf50', secondary: p?.colorSecondary || 'rgba(76, 175, 80, 1)' };
    } catch { return { primary: '#4caf50', secondary: 'rgba(76,175,80,1)' }; }
}

export function hexToRgba(hex, alpha) {
    try {
        const m = hex.replace('#', '');
        const r = parseInt(m.substring(0, 2), 16);
        const g = parseInt(m.substring(2, 4), 16);
        const b = parseInt(m.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    } catch { return hex; }
}

export function getCelestialColors(obj) {
    const type = obj.celestial_type || obj.type;
    switch (type) {
        case 'star':
            return { border: '#FFD700', background: 'radial-gradient(circle, rgba(255,215,0,0.8) 0%, rgba(255,140,0,0.4) 50%, rgba(255,69,0,0.2) 100%)', text: '#FFD700', glow: '#FFD700' };
        case 'planet':
            const planetType = obj.meta?.type || 'terrestrial';
            if (planetType === 'resource-rich') return { border: '#8BC34A', background: 'rgba(139, 195, 74, 0.6)', text: '#8BC34A' };
            if (planetType === 'gas-giant') return { border: '#9C27B0', background: 'rgba(156, 39, 176, 0.6)', text: '#9C27B0' };
            return { border: '#795548', background: 'rgba(121, 85, 72, 0.6)', text: '#795548' };
        case 'moon':
            return { border: '#BDBDBD', background: 'rgba(189, 189, 189, 0.5)', text: '#BDBDBD' };
        case 'belt':
            return { border: 'rgba(255,255,255,0.08)', background: 'rgba(255, 255, 255, 0.05)', text: '#CCCCCC' };
        case 'nebula':
            return { border: '#E91E63', background: 'rgba(233, 30, 99, 0.4)', text: '#E91E63' };
        case 'wormhole':
        case 'jump-gate':
            return { border: '#9C27B0', background: 'rgba(156, 39, 176, 0.7)', text: '#9C27B0', glow: '#9C27B0' };
        case 'derelict':
            return { border: '#607D8B', background: 'rgba(96, 125, 139, 0.5)', text: '#607D8B' };
        case 'graviton-sink':
            return { border: '#000000', background: 'rgba(0, 0, 0, 0.9)', text: '#FF0000', glow: '#FF0000' };
        default:
            return { border: '#64b5f6', background: 'rgba(100, 181, 246, 0.3)', text: '#64b5f6' };
    }
}

export function getObjectColors(game, obj, isOwned, visibility, isCelestial) {
    if (!isCelestial) {
        const palette = getPlayerColors(game, obj.owner_id);
        if (obj.owner_id) {
            return {
                border: palette.primary,
                background: (palette.secondary.startsWith('#') ? hexToRgba(palette.secondary, 0.25) : palette.secondary.replace(/\)$|$/, ', 0.25)').replace('rgba(', 'rgba(')),
                text: '#ffffff'
            };
        }
    }
    if (isCelestial) return getCelestialColors(obj);
    if (visibility.dimmed) return { border: '#64b5f6', background: 'rgba(100, 181, 246, 0.1)', text: '#64b5f6' };
    if (visibility.visible) return { border: '#ff9800', background: 'rgba(255, 152, 0, 0.1)', text: '#ffffff' };
    return { border: '#666', background: 'rgba(255, 255, 255, 0.1)', text: '#ffffff' };
}


