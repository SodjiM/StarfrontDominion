// Trails: sector trails fetch + client lingering trail lifecycle

export async function fetchSectorTrails(game) {
    try {
        const sectorId = game.gameState?.sector?.id;
        const currentTurn = game.gameState?.currentTurn?.turn_number || 1;
        if (!sectorId) return;
        const data = await SFApi.State.sectorTrails(sectorId, currentTurn, 10);
        if (!data || !Array.isArray(data.segments)) return;
        const byTurn = game.trailBuffer.byTurn;
        const minTurn = currentTurn - 9;
        data.segments.forEach(seg => {
            const t = seg.turn;
            if (t < minTurn || t > currentTurn) return;
            if (!byTurn.has(t)) byTurn.set(t, []);
            byTurn.get(t).push(seg);
        });
        Array.from(byTurn.keys()).forEach(t => { if (t < minTurn) byTurn.delete(t); });
        game.render && game.render();
    } catch (e) {
        console.warn('Failed to fetch sector trails', e);
    }
}

export function handleLingeringTrailsOnTurn(game) {
    const currentTurn = game.gameState?.currentTurn?.turn_number || 1;
    const initialCount = game.clientLingeringTrails.length;
    game.clientLingeringTrails = game.clientLingeringTrails.filter(trail => {
        const turnAge = currentTurn - trail.createdOnTurn;
        if (turnAge >= 10) return false;
        if (!trail.isAccurate) {
            const hasAccurate = game.clientLingeringTrails.some(other =>
                other.shipId === trail.shipId && other.isAccurate && Math.abs(other.createdOnTurn - trail.createdOnTurn) <= 1
            );
            if (hasAccurate) return false;
        }
        return true;
    });
    const serverCompletedMovements = new Set(
        (game.objects||[]).filter(obj => obj.movementStatus === 'completed' && obj.movementPath).map(obj => obj.id)
    );
    game.clientLingeringTrails = game.clientLingeringTrails.filter(trail => {
        if (trail.createdOnTurn === currentTurn && String(trail.id||'').startsWith('completion-')) return true;
        return !serverCompletedMovements.has(trail.shipId);
    });
    if (initialCount !== game.clientLingeringTrails.length) {
        console.log(`🧹 Cleaned up ${initialCount - game.clientLingeringTrails.length} expired/duplicate client trails`);
    }
}


