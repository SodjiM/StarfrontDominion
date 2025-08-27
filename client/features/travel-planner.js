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
    const list = Array.isArray(routes) ? routes.slice(0,3) : [];
    return list.filter(r => {
        const legs = Array.isArray(r.legs) ? r.legs.map(normalizeLeg) : [];
        const nonZero = legs.filter(L => Math.abs(Number(L.sEnd||0) - Number(L.sStart||0)) > 1e-3);
        if (!legs.length || !nonZero.length) return false;
        r.legs = legs; return true;
    });
}

export function confirmRoute(client, route, onRedraw) {
    if (!client?.selectedUnit?.id) { client.addLogEntry('Select a ship first to confirm a route', 'warning'); return; }
    let rawLegs = [];
    if (Array.isArray(route?.legs) && route.legs.length > 0) rawLegs = route.legs;
    else return client.addLogEntry('Route data missing legs; cannot confirm', 'error');
    const legs = rawLegs.map(normalizeLeg).filter(L => Number.isFinite(L.edgeId));
    const nonZero = legs.filter(L => Math.abs(Number(L.sEnd||0) - Number(L.sStart||0)) > 1e-3);
    if (!nonZero.length) { client.addLogEntry('Route is empty; cannot confirm', 'error'); return; }
    const redraw = (typeof onRedraw === 'function') ? onRedraw : (client?.render ? client.render.bind(client) : null);
    try { client.__laneHighlight = { until: Date.now()+6000, legs }; redraw && redraw(); } catch {}
    client.socket && client.socket.emit('travel:confirm', {
        gameId: client.gameId,
        sectorId: client.gameState.sector.id,
        shipId: client.selectedUnit.id,
        freshnessTurns: 3,
        legs
    }, (resp)=>{
        if (!resp || !resp.success) { client.addLogEntry(resp?.error || 'Confirm failed', 'error'); return; }
        const serverLegs = Array.isArray(resp?.itinerary) ? resp.itinerary : (Array.isArray(resp?.legs) ? resp.legs : null);
        const confirmed = serverLegs ? serverLegs.map(normalizeLeg).filter(L=>Number.isFinite(L.edgeId)) : legs;
        const confirmedNonZero = confirmed.filter(L => Math.abs(Number(L.sEnd||0) - Number(L.sStart||0)) > 1e-3);
        client.addLogEntry(`Itinerary stored (${confirmed.length} leg${confirmed.length!==1?'s':''})`, 'success');
        try {
            client.__laneHighlight = { until: Date.now()+6000, legs: confirmedNonZero.length ? confirmed : legs };
            if (redraw) { redraw(); setTimeout(()=>redraw(), 100); setTimeout(()=>redraw(), 2000); }
        } catch {}
    });
}


