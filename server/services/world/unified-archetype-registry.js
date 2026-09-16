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

const CONTRACT_VERSION = 1;
const DEFAULT_SIGNATURES = ['Fluxium', 'Auralite'];
const PROTOTYPE_ARCHETYPES = new Set(['asteroid-heavy', 'wormhole', 'dark-nebula']);
const LEGACY_ARCHETYPES = new Set(['diplomatic', 'forgeyard']);

function lifecycleFor(key) {
    if (PROTOTYPE_ARCHETYPES.has(key)) return 'prototype';
    if (LEGACY_ARCHETYPES.has(key)) return 'legacy';
    if (key === 'standard') return 'fallback';
    return 'experimental';
}

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
    const contract = getArchetypeContract(key);
    const { key: k, module: mod } = contract;
    const DISPLAY = mod.DISPLAY || {};
    return {
        key: k,
        name: DISPLAY.name || (k.replace(/-/g,' ').replace(/\b\w/g, c => c.toUpperCase())),
        description: DISPLAY.description || '',
        minerals: mod.MINERALS || { primary: [], secondary: [] },
        contractVersion: contract.contractVersion,
        lifecycle: contract.lifecycle,
        recommendedForPrototype: contract.recommendedForPrototype,
        playerSelectable: contract.playerSelectable,
        signatureMinerals: contract.signatureMinerals,
        randomSpecialtyCount: contract.randomSpecialtyCount,
        implemented: typeof mod.plan === 'function' && typeof mod.persist === 'function'
    };
}

function getArchetypeContract(key) {
    const k = resolveKey(key);
    const mod = getArchetypeModule(k);
    const signatures = Array.isArray(mod.MINERALS?.primary) && mod.MINERALS.primary.length >= 2
        ? mod.MINERALS.primary.slice(0, 2)
        : DEFAULT_SIGNATURES.slice();
    return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        key: k,
        module: mod,
        lifecycle: lifecycleFor(k),
        recommendedForPrototype: PROTOTYPE_ARCHETYPES.has(k),
        // Compatibility remains enabled until setup UI and saved games migrate.
        playerSelectable: true,
        signatureMinerals: Object.freeze(signatures),
        randomSpecialtyCount: 5
    });
}

module.exports = { getArchetypeModule, getArchetypeInfo, getArchetypeContract, resolveKey, AVAILABLE, CONTRACT_VERSION };

