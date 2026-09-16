const SECTOR_SIZE = 5000;
const GRID_SIZE = 3;

function cellForPoint(x, y, { width = SECTOR_SIZE, height = SECTOR_SIZE } = {}) {
    const px = Number.isFinite(Number(x)) ? Number(x) : 0;
    const py = Number.isFinite(Number(y)) ? Number(y) : 0;
    const safeWidth = Math.max(1, Number(width) || SECTOR_SIZE);
    const safeHeight = Math.max(1, Number(height) || SECTOR_SIZE);
    return {
        col: Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(px / safeWidth * GRID_SIZE))),
        row: Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(py / safeHeight * GRID_SIZE)))
    };
}

function parseCells(value) {
    if (Array.isArray(value)) return value;
    try { return JSON.parse(value || '[]') || []; } catch { return []; }
}

function regionAt(x, y, regions, dimensions) {
    const width = Math.max(1, Number(dimensions?.width) || SECTOR_SIZE);
    const height = Math.max(1, Number(dimensions?.height) || SECTOR_SIZE);
    const px = Number(x);
    const py = Number(y);
    if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || py < 0 || px >= width || py >= height) return null;
    const cell = cellForPoint(x, y, dimensions);
    for (const region of regions || []) {
        const cells = parseCells(region.cells_json ?? region.cells);
        if (cells.some((candidate) => Number(candidate.row) === cell.row && Number(candidate.col) === cell.col)) {
            return String(region.region_id ?? region.id);
        }
    }
    return null;
}

module.exports = { SECTOR_SIZE, GRID_SIZE, cellForPoint, parseCells, regionAt };
