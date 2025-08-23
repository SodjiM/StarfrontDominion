function computePathBresenham(x0, y0, x1, y1) {
    const path = [];
    let ix = Math.round(Number(x0) || 0);
    let iy = Math.round(Number(y0) || 0);
    const tx = Math.round(Number(x1) || 0);
    const ty = Math.round(Number(y1) || 0);
    const dx = Math.abs(tx - ix);
    const dy = Math.abs(ty - iy);
    const sx = ix < tx ? 1 : -1;
    const sy = iy < ty ? 1 : -1;
    let err = dx - dy;
    while (true) {
        path.push({ x: ix, y: iy });
        if (ix === tx && iy === ty) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; ix += sx; }
        if (e2 < dx) { err += dx; iy += sy; }
    }
    return path;
}

module.exports = { computePathBresenham };


