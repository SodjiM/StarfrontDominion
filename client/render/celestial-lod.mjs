// Resolution selection for celestial textures. The thresholds use projected
// diameter in CSS pixels, so they work across camera zoom and DPR settings.
export const CELESTIAL_LOD = Object.freeze({
    thumbnail: Object.freeze({ maxDiameter: 56, atlas: 'assets/celestial/atlas-thumb.png' }),
    tactical: Object.freeze({ maxDiameter: 220, atlas: 'assets/celestial/atlas.png' }),
    close: Object.freeze({ maxDiameter: Infinity, atlas: 'assets/celestial/atlas-close.png' })
});

export function celestialLodForDiameter(diameter) {
    const value = Number.isFinite(Number(diameter)) ? Number(diameter) : 0;
    if (value <= CELESTIAL_LOD.thumbnail.maxDiameter) return 'thumbnail';
    if (value <= CELESTIAL_LOD.tactical.maxDiameter) return 'tactical';
    return 'close';
}

export function atlasPathForLod(lod) {
    return (CELESTIAL_LOD[lod] || CELESTIAL_LOD.tactical).atlas;
}
