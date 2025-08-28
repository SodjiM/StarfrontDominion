export function getCargoFill(unit) {
    try {
        const meta = unit.meta ? JSON.parse(unit.meta) : {};
        if (meta.cargoCapacity == null) return null;
        const used = (meta.cargoUsed != null) ? meta.cargoUsed : (meta.cargo?.reduce?.((s,c)=>s + (c.quantity||0), 0) || 0);
        return `${used}/${meta.cargoCapacity}`;
    } catch { return null; }
}

export function getEta(unit) {
    // Prefer live lane ETA if present
    if (unit.movementETA != null) return unit.movementETA;
    if (unit.eta_turns != null) return unit.eta_turns;
    if (unit.movement_path) {
        try {
            const p = JSON.parse(unit.movement_path);
            return Array.isArray(p) ? Math.max(1, Math.ceil(p.length / (unit.movement_speed||4))) : null;
        } catch { return null; }
    }
    return null;
}


