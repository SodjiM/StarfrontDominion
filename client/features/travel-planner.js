// Travel Planner helpers (ESM)

export function normalizeLeg(L) {
    try {
        const edgeId = Number(L?.edgeId ?? L?.edge_id);
        const entryRaw = (L?.entry ?? L?.entry_type ?? 'wildcat');
        const sStart = Number(L?.sStart ?? L?.s_start ?? 0);
        const sEnd = Number(L?.sEnd ?? L?.s_end ?? sStart);
        const mergeTurns = (L?.mergeTurns ?? L?.merge_turns);
        const tapId = (L?.tapId ?? L?.tap_id ?? L?.nearestTapId ?? L?.nearest_tap_id);
        return {
            edgeId,
            entry: (String(entryRaw) === 'tap') ? 'tap' : 'wildcat',
            sStart: Number.isFinite(sStart) ? sStart : 0,
            sEnd: Number.isFinite(sEnd) ? sEnd : (Number.isFinite(sStart)?sStart:0),
            mergeTurns: (mergeTurns != null ? Number(mergeTurns) : undefined),
            tapId: (tapId != null ? Number(tapId) : undefined)
        };
    } catch { return { edgeId: NaN, entry: 'wildcat', sStart: 0, sEnd: 0 }; }
}

export function filterAndNormalizeRoutes(routes) {
    return (Array.isArray(routes) ? routes : []).slice(0,3).filter((route) => route?.routeId && route?.mode);
}

export function confirmRoute(client, route, onRedraw) {
    if (!client?.selectedUnit?.id) { client.addLogEntry('Select a ship first to confirm a route', 'warning'); return; }
    if (!route?.routeId) return client.addLogEntry('Route expired; recalculate before confirming', 'error');
    const redraw = (typeof onRedraw === 'function') ? onRedraw : (client?.render ? client.render.bind(client) : null);
    const dest = (client && client.__laneHighlight && client.__plannerTarget) ? client.__plannerTarget : (client && client.__plannerTarget) ? client.__plannerTarget : null;
    client.socket && client.socket.emit('travel:confirm', {
        routeId: route.routeId,
        queue: true,
        clientOrderId: `warp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        gameId: client.gameId,
        sectorId: client.gameState.sector.id,
        shipId: client.selectedUnit.id,
        freshnessTurns: 6,
        destX: (dest && typeof dest.x === 'number') ? dest.x : undefined,
        destY: (dest && typeof dest.y === 'number') ? dest.y : undefined
    }, (resp)=>{
        if (!resp || !resp.success) { client.addLogEntry(resp?.error || 'Confirm failed', 'error'); return; }
        client.addLogEntry(resp.mode === 'impulse' ? 'Movement queued' : 'Warp route queued', 'success');
        if (redraw) redraw();
    });
}
