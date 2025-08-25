// Unified Archetype Registry: single source of truth for resolving archetype modules

function normalize(key) {
    return String(key || 'standard').toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
}

const ALIASES = new Map([
    ['astbelt','asteroid-heavy'],
    ['asteroid_heavy','asteroid-heavy'],
    ['wormhole_cluster','wormhole'],
    ['wormhole-cluster','wormhole'],
    ['binary','binary'],
    ['graviton','graviton'],
    ['graviton_sink','graviton'],
    ['solar_flare','solar'],
    ['dark_nebula','dark-nebula'],
    ['ion_tempest','ion-tempest'],
    ['relay','relay'],
    ['starlight_relay','relay'],
    ['cryo_comet','cryo-comet'],
    ['supernova','supernova'],
    ['diplomatic_expanse','diplomatic'],
    ['capital_forgeyard','forgeyard'],
    ['ghost_net','ghost-net'],
    ['ghost_net_array','ghost-net'],
]);

const AVAILABLE = [
    'standard','asteroid-heavy','wormhole','binary','graviton','solar','dark-nebula',
    'ion-tempest','relay','cryo-comet','supernova','diplomatic','forgeyard','ghost-net'
];

function resolveKey(key) {
    const k = normalize(key);
    if (AVAILABLE.includes(k)) return k;
    const aliased = ALIASES.get(k);
    return AVAILABLE.includes(aliased) ? aliased : 'standard';
}

function getArchetypeModule(key) {
    const k = resolveKey(key);
    try { return require(`./seeders/archetype-${k}.js`); }
    catch { return require('./seeders/archetype-standard.js'); }
}

function getArchetypeInfo(key) {
    const k = resolveKey(key);
    const mod = getArchetypeModule(k);
    const DISPLAY = mod.DISPLAY || {};
    return {
        key: k,
        name: DISPLAY.name || (k.replace(/-/g,' ').replace(/\b\w/g, c => c.toUpperCase())),
        description: DISPLAY.description || '',
        minerals: mod.MINERALS || { primary: [], secondary: [] },
        implemented: typeof mod.plan === 'function' && typeof mod.persist === 'function'
    };
}

module.exports = { getArchetypeModule, getArchetypeInfo, resolveKey, AVAILABLE };


