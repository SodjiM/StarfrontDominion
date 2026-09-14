// Objects that may participate in the basic combat loop. Target ownership is
// intentionally not part of this rule: neutral and friendly-fire attacks are
// valid gameplay actions. Individual weapons may add narrower restrictions.
const COMBAT_TARGET_TYPES = new Set(['ship', 'station', 'wreck', 'cargo_can']);

function isCombatTarget(object) {
    if (!object || !COMBAT_TARGET_TYPES.has(String(object.type))) return false;
    try {
        const meta = typeof object.meta === 'string' ? JSON.parse(object.meta || '{}') : (object.meta || {});
        return meta.destroyed !== true;
    } catch {
        return true;
    }
}

function isLiveShip(object) {
    if (!object || object.type !== 'ship') return false;
    try {
        const meta = typeof object.meta === 'string' ? JSON.parse(object.meta || '{}') : (object.meta || {});
        return Number(meta.hp) > 0;
    } catch {
        return false;
    }
}

module.exports = { COMBAT_TARGET_TYPES, isCombatTarget, isLiveShip };
