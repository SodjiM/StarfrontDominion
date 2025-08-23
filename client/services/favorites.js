// Favorites service: localStorage helpers

export function isFavorite(unitId) {
    try { const s = localStorage.getItem('favoriteUnits'); if (!s) return false; const set = new Set(JSON.parse(s)); return set.has(unitId); } catch { return false; }
}

export function toggle(game, unitId) {
    try {
        const s = localStorage.getItem('favoriteUnits');
        const arr = s ? JSON.parse(s) : [];
        const set = new Set(arr);
        if (set.has(unitId)) set.delete(unitId); else set.add(unitId);
        localStorage.setItem('favoriteUnits', JSON.stringify([...set]));
        game.updateMultiSectorFleet && game.updateMultiSectorFleet();
    } catch {}
}


