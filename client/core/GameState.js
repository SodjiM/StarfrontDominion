// Core GameState utilities: normalization and selectors

export function parseMetaIfString(obj) {
    if (!obj) return obj;
    if (obj.meta && typeof obj.meta === 'string') {
        try { obj.meta = JSON.parse(obj.meta); } catch { obj.meta = {}; }
    }
    return obj;
}

export function normalizeObjects(objects) {
    if (!Array.isArray(objects)) return [];
    return objects.map(o => parseMetaIfString(o));
}

export function normalizeGameState(state) {
    if (!state || typeof state !== 'object') return state;
    if (Array.isArray(state.objects)) {
        state.objects = normalizeObjects(state.objects);
    }
    return state;
}

export function getEffectiveMovementSpeed(unit) {
    try {
        const base = unit?.meta?.movementSpeed || 0;
        const boostMult = (typeof unit?.meta?.movementBoostMultiplier === 'number' && unit.meta.movementBoostMultiplier > 0)
            ? unit.meta.movementBoostMultiplier
            : 1;
        const effective = Math.max(1, Math.floor(base * boostMult));
        return effective;
    } catch { return unit?.meta?.movementSpeed || 0; }
}

export function getEffectiveScanRange(unit) {
    try {
        const meta = unit?.meta || {};
        let range = meta.scanRange || 0;
        if (typeof meta.scanRangeMultiplier === 'number' && meta.scanRangeMultiplier > 1) {
            range = Math.ceil(range * meta.scanRangeMultiplier);
        }
        return range;
    } catch { return unit?.meta?.scanRange || 0; }
}

export function getUnitStatus(meta, unit) {
    const list = getUnitStatuses(meta, unit);
    return list[0] || 'idle';
}

export function getUnitStatuses(meta, unit) {
    try {
        const active = new Set();

        const m = meta || {};

        if (unit.pendingAttackTarget || m.attacking === true || unit.attackStatus === 'active') {
            active.add('attacking');
        }

        if (m.fuel != null && m.maxFuel != null && m.maxFuel > 0) {
            const fuelPct = m.fuel / m.maxFuel;
            if (fuelPct <= 0.2) active.add('lowFuel');
        }

        if (m.constructing === true || m.building === true || m.buildProgress > 0 || unit.constructionStatus === 'active') {
            active.add('constructing');
        }

        if (m.scanningActive === true || unit.scanningStatus === 'active') {
            active.add('scanning');
        }

        // Standardize: prefer movementStatus as the single source of truth; treat movementActive as derived
        if (unit.movementStatus === 'active' || unit.movement_path || m.moving === true) {
            active.add('moving');
        }

        if (unit.harvestingStatus === 'active' || m.mining === true) {
            active.add('mining');
        }

        if (m.docked === true) {
            active.add('docked');
        }

        if (m.stealthed === true || m.stealth === true || m.cloaked === true) {
            active.add('stealthed');
        }

        const priority = ['attacking','lowFuel','constructing','scanning','moving','mining','docked','stealthed'];
        const ordered = priority.filter(k => active.has(k));
        if (ordered.length === 0) return ['idle'];
        return ordered;
    } catch {
        return ['idle'];
    }
}


