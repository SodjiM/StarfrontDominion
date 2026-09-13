import { physicalScale } from '../utils/physical-geometry.js';
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

export function getAdjacentTileNear(targetX, targetY, fromX, fromY, game) {
    const mover=game?.selectedUnit || {type:'ship'};
    const target=(game?.objects||[]).find(o=>o.x===targetX&&o.y===targetY) || {x:targetX,y:targetY};
    const candidates=[];
    const r=Math.ceil(physicalScale.extent(target)+physicalScale.extent(mover))+2;
    for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++) {
        const p={x:targetX+dx,y:targetY+dy},body={...mover,...p};
        if(!physicalScale.inBounds(body)||!physicalScale.adjacent(body,target))continue;
        if((game?.objects||[]).some(o=>o.id!==mover.id&&physicalScale.isSolid(o)&&physicalScale.overlaps(body,o)))continue;
        candidates.push(p);
    }
    candidates.sort((a,b)=>Math.hypot(a.x-fromX,a.y-fromY)-Math.hypot(b.x-fromX,b.y-fromY));
    return candidates[0] || null;
}
