// Client-side estimate for the complete movement plan shown to the player.
// Active movement uses the server ETA when available; queued legs use the
// server-generated preview estimate, falling back to tile distance.

export function getEffectivePlanSpeed(ship, selectedUnit) {
    const meta = selectedUnit?.meta || ship?.meta || {};
    const base = Number(ship?.meta?.movementSpeed ?? meta.movementSpeed ?? 1);
    const flat = Number(meta.movementFlatBonus || 0);
    return Math.max(1, Math.floor(base) + Math.max(0, Math.floor(flat)));
}

export function calculatePlannedETA(ship, selectedUnit) {
    if (!ship) return 0;
    const speed = getEffectivePlanSpeed(ship, selectedUnit);
    let total = 0;

    if (Array.isArray(ship.movementPath) && ship.movementPath.length > 1) {
        const activeETA = Number(ship.movementETA);
        total += Number.isFinite(activeETA)
            ? Math.max(0, Math.ceil(activeETA))
            : Math.ceil((ship.movementPath.length - 1) / speed);
    }

    for (const segment of (ship.movementSegments || [])) {
        const previewETA = Number(segment.estimatedTurns);
        if (Number.isFinite(previewETA) && previewETA >= 0) {
            total += Math.ceil(previewETA);
            continue;
        }
        const pathLength = Array.isArray(segment.path) && segment.path.length > 1
            ? segment.path.length - 1
            : Math.max(Math.abs(Number(segment.to?.x) - Number(segment.from?.x)), Math.abs(Number(segment.to?.y) - Number(segment.from?.y)));
        total += Math.ceil(pathLength / speed);
    }
    return total;
}
