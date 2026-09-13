// Shared by world generation and the browser; legacy bodies receive stable types.
(function(root) {
    const types = {
        ocean: { cell: 0, label: 'Ocean world', tint: '#69c9ee' },
        rocky: { cell: 1, label: 'Desert world', tint: '#dca472' },
        iceWorld: { cell: 2, label: 'Ice world', tint: '#a4e9f2' },
        gasGiant: { cell: 3, label: 'Gas giant', tint: '#e3bb7d' },
        cratered: { cell: 4, label: 'Cratered moon', tint: '#c5cad8' },
        volcanic: { cell: 5, label: 'Volcanic moon', tint: '#ff894f' },
        yellowDwarf: { cell: 6, label: 'Yellow dwarf', tint: '#ffbf50' },
        redDwarf: { cell: 7, label: 'Red dwarf', tint: '#ff6046' },
        blueStar: { cell: 8, label: 'Blue star', tint: '#77caff' }
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
    const api = { types, families, resolve, seed };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.SFCelestialTypes = api;
})(typeof window !== 'undefined' ? window : null);
