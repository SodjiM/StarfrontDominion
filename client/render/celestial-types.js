// Shared by world generation and the browser; legacy bodies receive stable types.
(function(root) {
    const types = {
        ocean: { cell: 0, label: 'Ocean world', tint: '#69c9ee', gameplayTags: ['development', 'politics'] },
        rocky: { cell: 1, label: 'Desert world', tint: '#dca472', gameplayTags: ['mining', 'industry'] },
        iceWorld: { cell: 2, label: 'Ice world', tint: '#a4e9f2', gameplayTags: ['support', 'transport'] },
        gasGiant: { cell: 3, label: 'Gas giant', tint: '#e3bb7d', gameplayTags: ['fuel', 'mobility'] },
        cratered: { cell: 4, label: 'Cratered moon', tint: '#c5cad8', gameplayTags: ['reconnaissance', 'surveillance'] },
        volcanic: { cell: 5, label: 'Volcanic moon', tint: '#ff894f', gameplayTags: ['raiding', 'interdiction'] },
        yellowDwarf: { cell: 6, label: 'Yellow dwarf', tint: '#ffbf50', gameplayTags: ['stability', 'administration'] },
        redDwarf: { cell: 7, label: 'Red dwarf', tint: '#ff6046', gameplayTags: ['industry', 'endurance'] },
        blueStar: { cell: 8, label: 'Blue star', tint: '#77caff', gameplayTags: ['high-energy', 'military'] }
    };
    const families = { planet: ['ocean', 'rocky', 'iceWorld', 'gasGiant'], moon: ['cratered', 'volcanic'], star: ['yellowDwarf', 'redDwarf', 'blueStar'] };
    const aliases = { superEarth: 'ocean', terrestrial: 'ocean', 'resource-rich': 'ocean', 'gas-giant': 'gasGiant', ice: 'iceWorld' };
    function seed(obj) {
        let hash = 2166136261;
        for (const char of `${obj.sector_id || ''}:${obj.id ?? ''}:${obj.x}:${obj.y}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
        return hash >>> 0;
    }
    function resolve(obj) {
        const raw = obj.celestial_type || obj.type;
        const family = raw === 'sun' ? 'star' : raw;
        const choices = families[family];
        if (!choices) return null;
        let meta = obj.meta || {};
        if (typeof meta === 'string') { try { meta = JSON.parse(meta) || {}; } catch { meta = {}; } }
        const requested = meta.visualType || meta[family === 'star' ? 'starType' : `${family}Type`] || meta.type;
        const normalized = aliases[requested] || requested;
        const key = choices.includes(normalized) ? normalized : choices[seed(obj) % choices.length];
        return { key, family, ...types[key], phase: (seed(obj) % 6283) / 1000 };
    }
    const api = {
        types, families, resolve, seed,
        stationScopes: { 'sun-station': 'system', 'planet-station': 'region', 'moon-station': 'local' },
        stationBaseEffects: {
            'sun-station': { label: 'System command', effects: ['+10 pilot capacity', 'System-wide station effects'] },
            'planet-station': { label: 'Regional production', effects: ['+5 pilot capacity', 'Regional station effects'] },
            'moon-station': { label: 'Local forward base', effects: ['+3 pilot capacity', 'Local-radius station effects'] }
        },
        gameplayFor(obj) { const resolved = resolve(obj); return resolved ? { type: resolved.key, tags: resolved.gameplayTags || [] } : null; }
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.SFCelestialTypes = api;
})(typeof window !== 'undefined' ? window : null);
