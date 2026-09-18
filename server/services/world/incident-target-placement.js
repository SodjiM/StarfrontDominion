const crypto = require('node:crypto');
const navigation = require('../../utils/navigation');
const { physicalObjects } = require('./physical-placement');
const { parseCells, regionAt } = require('./region-geometry');

async function findDeterministicIncidentTarget({
    db,
    sectorId,
    regionId,
    cellsJson,
    width = navigation.WORLD_SIZE,
    height = navigation.WORLD_SIZE,
    seed,
    mover
}) {
    const cells = parseCells(cellsJson)
        .filter(cell => Number.isInteger(Number(cell.row)) && Number.isInteger(Number(cell.col)))
        .sort((a, b) => Number(a.row) - Number(b.row) || Number(a.col) - Number(b.col));
    if (!cells.length) return null;

    const safeWidth = Math.max(1, Number(width) || navigation.WORLD_SIZE);
    const safeHeight = Math.max(1, Number(height) || navigation.WORLD_SIZE);
    const cellWidth = safeWidth / 3;
    const cellHeight = safeHeight / 3;
    const digest = crypto.createHash('sha256').update(String(seed)).digest();
    const start = digest.readUInt16BE(0) % cells.length;
    const preferred = [
        0.2 + (digest.readUInt16BE(2) / 0xffff) * 0.6,
        0.2 + (digest.readUInt16BE(4) / 0xffff) * 0.6
    ];
    const fractions = [preferred, [0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
    const objects = await physicalObjects(db, sectorId);

    for (let offset = 0; offset < cells.length; offset += 1) {
        const cell = cells[(start + offset) % cells.length];
        const minX = Math.max(0, Math.ceil(Number(cell.col) * cellWidth));
        const maxX = Math.min(navigation.WORLD_SIZE - 1, Math.floor((Number(cell.col) + 1) * cellWidth - Number.EPSILON));
        const minY = Math.max(0, Math.ceil(Number(cell.row) * cellHeight));
        const maxY = Math.min(navigation.WORLD_SIZE - 1, Math.floor((Number(cell.row) + 1) * cellHeight - Number.EPSILON));
        if (minX > maxX || minY > maxY) continue;

        for (const [xFraction, yFraction] of fractions) {
            const origin = {
                x: Math.max(minX, Math.min(maxX, Math.round((Number(cell.col) + xFraction) * cellWidth))),
                y: Math.max(minY, Math.min(maxY, Math.round((Number(cell.row) + yFraction) * cellHeight)))
            };
            const target = navigation.findPlacement(objects, mover, origin, {
                maxRadius: 96,
                accept: point => regionAt(point.x, point.y, [{ region_id: regionId, cells_json: cellsJson }], {
                    width: safeWidth,
                    height: safeHeight
                }) === String(regionId)
            });
            if (target) return target;
        }
    }
    return null;
}

module.exports = { findDeterministicIncidentTarget };
