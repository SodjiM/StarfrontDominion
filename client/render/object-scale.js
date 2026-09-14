import { physicalScale } from '../utils/physical-geometry.js';
import { isCelestialObject } from '../utils/objects.js';

// Display size is deliberately independent of server collision footprints.
const SHIP_SIZES = {
    'swift-courier': [2.2, 42], explorer: [2.6, 48],
    'needle-gunship': [3.2, 54], 'drill-skiff': [3.6, 58],
    frigate: [3.2, 54], cruiser: [4.2, 64], battleship: [5.5, 76], carrier: [6.5, 84]
};
export function objectDisplaySize(obj, tileSize) {
    if (isCelestialObject(obj)) return Math.max(1, Number(obj.radius) || 1) * tileSize * 2;
    if (obj.type === 'resource_node') return tileSize * 0.8;
    const meta = obj.meta || {};
    const key = meta.blueprintId || meta.stationClass || meta.shipClass || meta.shipType || meta.hull || meta.class || obj.subtype || obj.type;
    let size;
    if (obj.type === 'station' || String(key).endsWith('-station')) {
        size = key === 'sun-station' ? [13, 104] : key === 'moon-station' ? [5, 72] : [9, 88];
    } else if (obj.type === 'ship') size = SHIP_SIZES[key] || [2.8, 48];
    else size = [1.8, 30];
    // At tactical zoom show artwork. At system zoom gradually shrink icons to limit overlap.
    const floor = size[1] * Math.min(1, Math.max(0.28, tileSize / 4));
    return Math.max(floor, tileSize * Math.max(size[0], physicalScale.width(obj)));
}

export function pickMapObject(game, screenX, screenY, predicate = () => true) {
    let best = null, bestScore = Infinity;
    for (const obj of game.objects || []) {
        if (!predicate(obj)) continue;
        const center = physicalScale.shape(obj);
        const x = game.canvas.width / 2 + (center.x - game.camera.x) * game.tileSize;
        const y = game.canvas.height / 2 + (center.y - game.camera.y) * game.tileSize;
        const distance = Math.hypot(screenX - x, screenY - y);
        const radius = Math.max(6, objectDisplaySize(obj, game.tileSize) / 2);
        if (distance > radius) continue;
        // Ships/stations are drawn over celestial bodies; nearest unit wins overlaps.
        const score = distance / radius + (isCelestialObject(obj) ? 2 : 0);
        if (score < bestScore) { best = obj; bestScore = score; }
    }
    return best;
}
