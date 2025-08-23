// Movement helpers and calculations

export function calculateMovementPath(startX, startY, endX, endY) {
    const path = [];
    let x0 = Math.round(startX);
    let y0 = Math.round(startY);
    const x1 = Math.round(endX);
    const y1 = Math.round(endY);

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
        path.push({ x: x0, y: y0 });
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
    return path;
}

export function calculateETA(path, movementSpeed, unit, gameState) {
    if (!path || path.length <= 1) return 0;
    const distance = path.length - 1;
    let effectiveSpeed = movementSpeed || 1;
    try {
        const meta = unit?.meta || {};
        if (typeof meta.movementFlatBonus === 'number') {
            effectiveSpeed += Math.max(0, Math.floor(meta.movementFlatBonus));
        }
    } catch {}
    return Math.ceil(distance / Math.max(1, effectiveSpeed));
}

export function getAdjacentTileNear(targetX, targetY, fromX, fromY) {
    const candidates = [
        { x: targetX + 1, y: targetY },
        { x: targetX - 1, y: targetY },
        { x: targetX, y: targetY + 1 },
        { x: targetX, y: targetY - 1 },
    ];
    candidates.sort((a, b) => {
        const da = Math.hypot(a.x - fromX, a.y - fromY);
        const db = Math.hypot(b.x - fromX, b.y - fromY);
        return da - db;
    });
    return candidates[0] || null;
}


