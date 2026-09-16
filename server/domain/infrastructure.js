const INFRASTRUCTURE_CATALOG_VERSION = 1;

// Prototype values are deliberately centralized and easy to rebalance. Only
// persistent deployables count here; stations anchor presence but do not
// consume the shared regional deployable budget in this first slice.
const INFRASTRUCTURE_TYPES = Object.freeze({
    'storage-box': Object.freeze({ label: 'Storage Box', load: 1, class: 'logistics' }),
    'warp-beacon': Object.freeze({ label: 'Warp Beacon', load: 2, class: 'navigation' }),
    'sensor-tower': Object.freeze({ label: 'Sensor Array', load: 3, class: 'reconnaissance' }),
    'interstellar-gate': Object.freeze({ label: 'Interstellar Gate', load: 8, class: 'transport' })
});

function parseMeta(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try { return JSON.parse(value) || {}; } catch { return {}; }
}

function isObjectOperational(object) {
    if (!object || object.type === 'wreck') return false;
    const meta = parseMeta(object.meta);
    const disabled = meta.disabled === true || Number(meta.disabled) === 1;
    const destroyed = meta.destroyed === true || Number(meta.destroyed) === 1;
    const explicitlyInactive = meta.operational === false || meta.operational === 0 || meta.operational === '0';
    if (disabled || destroyed || explicitlyInactive) return false;
    if (['disabled', 'destroyed', 'inactive'].includes(meta.status)) return false;
    return !(Object.prototype.hasOwnProperty.call(meta, 'hp') && Number(meta.hp) <= 0);
}

function infrastructureKeyForObject(object) {
    if (!object || ['station', 'starbase', 'ship', 'wreck'].includes(object.type)) return null;
    const meta = parseMeta(object.meta);
    if (!isObjectOperational(object)) return null;
    const key = meta.structureType || object.type;
    return INFRASTRUCTURE_TYPES[key] ? key : null;
}

function infrastructureDefinitionForObject(object) {
    const key = infrastructureKeyForObject(object);
    return key ? { key, ...INFRASTRUCTURE_TYPES[key] } : null;
}

function infrastructureDefinitionForKey(key) {
    return INFRASTRUCTURE_TYPES[key] ? { key, ...INFRASTRUCTURE_TYPES[key] } : null;
}

module.exports = {
    INFRASTRUCTURE_CATALOG_VERSION,
    INFRASTRUCTURE_TYPES,
    infrastructureKeyForObject,
    infrastructureDefinitionForObject,
    infrastructureDefinitionForKey,
    isObjectOperational,
    parseMeta
};
