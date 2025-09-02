// Socket wiring with event map

export function connectSocket(game) {
    const socket = io();
    game.socket = socket;

    const handlers = buildHandlers(game);
    Object.keys(handlers).forEach(evt => {
        socket.on(evt, handlers[evt]);
    });

    socket.on('connect', () => {
        console.log('🔌 Connected to server');
        socket.emit('join-game', game.gameId, game.userId);
        try {
            if (typeof populateChatRecipients === 'function') populateChatRecipients();
            if (typeof requestChatHistory === 'function') requestChatHistory();
        } catch {}
        game.primePlayerNameCache && game.primePlayerNameCache();
        try {
            const me = (typeof Session !== 'undefined' && typeof Session.getUser === 'function') ? Session.getUser() : null;
            if (me?.userId && me?.username) {
                game.playerNameById.set(Number(me.userId), me.username);
            }
        } catch {}
    });

    socket.on('disconnect', () => console.log('🔌 Disconnected from server'));
}

function buildHandlers(game) {
    // Debounce map for queue UI refresh per ship
    const queueRefreshTimers = new Map();
    async function rebuildQueuedSegmentsForShip(shipId) {
        try {
            if (!shipId || !game || !game.socket) return { orders: [], segments: [] };
            const mod = await import('../features/queue-controller.js');
            const orders = await mod.list(game, shipId);
            const obj = game.objects.find(o => o.id === shipId);
            if (!obj) return { orders, segments: [] };
            // Build client preview segments chaining from current/active endpoint
            let start = null;
            if (obj.movementPath && obj.movementPath.length > 1 && obj.movementActive) {
                start = obj.movementPath[obj.movementPath.length - 1];
            } else if (obj.plannedDestination && typeof obj.plannedDestination.x === 'number') {
                start = { x: obj.plannedDestination.x, y: obj.plannedDestination.y };
            } else {
                start = { x: obj.x, y: obj.y };
            }
            const segments = [];
            let cursor = { x: start.x, y: start.y };
            for (const q of orders) {
                if (String(q.order_type) !== 'move') continue;
                let dest = null;
                try { const p = q.payload ? JSON.parse(q.payload) : {}; dest = p?.destination || p; } catch { dest = null; }
                if (!dest || typeof dest.x !== 'number' || typeof dest.y !== 'number') continue;
                segments.push({ from: { x: cursor.x, y: cursor.y }, to: { x: Number(dest.x), y: Number(dest.y) } });
                cursor = { x: Number(dest.x), y: Number(dest.y) };
            }
            if (segments.length) {
                obj.movementSegments = segments;
            } else if (obj.movementSegments) {
                delete obj.movementSegments;
            }
            if (game.selectedUnit && game.selectedUnit.id === shipId) {
                game.selectedUnit.movementSegments = obj.movementSegments;
            }
            game.render && game.render();
            return { orders, segments };
        } catch { return { orders: [], segments: [] }; }
    }

    function scheduleQueueRefresh(shipId) {
        try {
            if (!shipId) return;
            if (queueRefreshTimers.has(shipId)) clearTimeout(queueRefreshTimers.get(shipId));
            const t = setTimeout(() => {
                try { if (game.loadQueueLog) game.loadQueueLog(shipId, true); } catch {}
                queueRefreshTimers.delete(shipId);
            }, 120);
            queueRefreshTimers.set(shipId, t);
        } catch {}
    }

    return {
        'player-locked-turn': (data) => {
            game.addLogEntry(`Player ${data.userId} locked turn ${data.turnNumber}`, 'info');
            if (data.userId === game.userId) {
                game.turnLocked = true;
                if (game.gameState) { game.withState && game.withState(state => { state.turnLocked = true; }); }
                try { const tb = require('../ui/topbar.js'); tb.updateTopbar && tb.updateTopbar(game); } catch { import('../ui/topbar.js').then(tb => tb.updateTopbar && tb.updateTopbar(game)); }
                game.updateUnitDetails && game.updateUnitDetails();
                // Nudge queue panel and preview for selected unit
                try { const sel = game.selectedUnit; if (sel && sel.type === 'ship') { (async ()=>{ await rebuildQueuedSegmentsForShip(sel.id); scheduleQueueRefresh(sel.id); })(); } } catch {}
            }
        },
        'player-unlocked-turn': (data) => {
            game.addLogEntry(`Player ${data.userId} unlocked turn ${data.turnNumber}`, 'info');
            if (data.userId === game.userId) {
                game.turnLocked = false;
                if (game.gameState) { game.withState && game.withState(state => { state.turnLocked = false; }); }
                try { const tb = require('../ui/topbar.js'); tb.updateTopbar && tb.updateTopbar(game); } catch { import('../ui/topbar.js').then(tb => tb.updateTopbar && tb.updateTopbar(game)); }
                game.updateUnitDetails && game.updateUnitDetails();
                try { const sel = game.selectedUnit; if (sel && sel.type === 'ship') { (async ()=>{ await rebuildQueuedSegmentsForShip(sel.id); scheduleQueueRefresh(sel.id); })(); } } catch {}
            }
        },
        'turn-resolving': (data) => {
            game.addLogEntry(`Turn ${data.turnNumber} is resolving...`, 'warning');
        },
        'turn-resolved': (data) => {
            Promise.resolve()
                .then(() => game.loadGameState())
                .then(() => {
                    game.addLogEntry(`Turn ${data.turnNumber} resolved! Starting turn ${data.nextTurn}`, 'success');
                })
                .then(() => {
                    setTimeout(() => {
                        try { game.fetchSectorTrails && game.fetchSectorTrails(); } catch {}
                        try { game.incrementSenateProgress && game.incrementSenateProgress(1); } catch {}
                        try {
                            SFApi.State.combatLogs(game.gameId, data.turnNumber)
                                .then(payload => {
                                    const rows = Array.isArray(payload?.logs) ? payload.logs : [];
                                    rows.forEach(log => {
                                        const kind = (log.event_type === 'kill') ? 'success' : (log.event_type === 'ability' || log.event_type === 'status') ? 'info' : 'info';
                                        game.addLogEntry(log.summary || 'Combat event', kind);
                                    });
                                })
                                .catch(() => {});
                        } catch {}
                        setTimeout(() => game.refreshAbilityCooldowns && game.refreshAbilityCooldowns(), 50);
                        // After state refresh, rebuild queued movement previews and refresh queue panel for selected unit
                        try {
                            const sel = game.selectedUnit;
                            if (sel && sel.type === 'ship') {
                                rebuildQueuedSegmentsForShip(sel.id);
                                scheduleQueueRefresh(sel.id);
                            }
                        } catch {}
                    }, 0);
                });
        },
        'harvesting-started': (data) => { game.addLogEntry(data.message, 'success'); game.loadGameState && game.loadGameState(); },
        'harvesting-stopped': (data) => { game.addLogEntry(data.message, 'info'); game.loadGameState && game.loadGameState(); },
        'harvesting-error': (data) => { game.addLogEntry(`Mining error: ${data.error}`, 'error'); },
        'lane:hard-offramp': (data) => {
            if (data && data.shipId) {
                game.addLogEntry('Hard off-ramp: forced off lane and stunned', 'warning');
            }
        },
        'object:teleport': (payload) => {
            try {
                const obj = game.objects.find(o => o.id === payload.id);
                if (obj) { obj.x = payload.x; obj.y = payload.y; }
                if (game.selectedUnit && game.selectedUnit.id === payload.id) {
                    game.selectedUnit.x = payload.x; game.selectedUnit.y = payload.y;
                }
                game.render && game.render();
            } catch {}
        },
        'travel:cancelled': (data) => {
            try {
                // Clear planned lane highlight when a transit is cancelled mid-edge
                if (game.__laneHighlight) game.__laneHighlight.until = 0;
                game.render && game.render();
            } catch {}
        },
        'travel:arrived': (data) => {
            try {
                // On arrival, clear the persistent planner overlay so UI doesn't show stale itinerary
                if (game.__laneHighlight) game.__laneHighlight.until = 0;
                game.render && game.render();
            } catch {}
        },
        'movement:cancelled': (data) => {
            try {
                const shipId = Number(data?.shipId || 0);
                if (!shipId) return;
                const obj = game.objects.find(o => o.id === shipId);
                if (obj) { delete obj.movementSegments; delete obj.movementPath; obj.movementActive = false; delete obj.plannedDestination; }
                if (game.selectedUnit && game.selectedUnit.id === shipId) {
                    delete game.selectedUnit.movementSegments; delete game.selectedUnit.movementPath; game.selectedUnit.movementActive = false; delete game.selectedUnit.plannedDestination;
                    try { game.updateUnitDetails && game.updateUnitDetails(); } catch {}
                }
                game.render && game.render();
            } catch {}
        },
        'travel:entered': (data) => {
            try {
                const obj = game.objects.find(o => o.id === data.shipId);
                if (obj) {
                    obj.meta = obj.meta || {}; obj.meta.travelMode = String(data.mode || 'core');
                }
                try { game.addLogEntry('🌌 Lane travel started', 'info'); } catch {}
                try { if (game.selectedUnit && game.selectedUnit.id === data.shipId) game.updateUnitDetails && game.updateUnitDetails(); } catch {}
                game.render && game.render();
            } catch {}
        },
        'travel:progress': (data) => {
            try {
                const obj = game.objects.find(o => o.id === data.shipId);
                if (obj) {
                    obj.x = Number(data.x||obj.x); obj.y = Number(data.y||obj.y);
                    if (typeof data.eta === 'number') obj.movementETA = Math.max(0, Math.ceil(data.eta));
                    if (!obj.meta) obj.meta = {}; if (typeof data.tpt === 'number') obj.meta.warpTPT = Number(data.tpt);
                }
                if (game.selectedUnit && game.selectedUnit.id === data.shipId) {
                    game.selectedUnit.x = Number(data.x||game.selectedUnit.x);
                    game.selectedUnit.y = Number(data.y||game.selectedUnit.y);
                    if (typeof data.eta === 'number') game.selectedUnit.movementETA = Math.max(0, Math.ceil(data.eta));
                    try { if (!game.selectedUnit.meta) game.selectedUnit.meta = {}; if (typeof data.tpt === 'number') game.selectedUnit.meta.warpTPT = Number(data.tpt); } catch {}
                    try { game.updateUnitDetails && game.updateUnitDetails(); } catch {}
                }
                game.render && game.render();
            } catch {}
        },
        'travel:arrived': (data) => {
            try {
                const obj = game.objects.find(o => o.id === data.shipId);
                if (obj) {
                    obj.x = Number(data.x || obj.x); obj.y = Number(data.y || obj.y);
                    if (obj.meta) { delete obj.meta.travelMode; delete obj.meta.warpTPT; }
                }
                if (game.selectedUnit && game.selectedUnit.id === data.shipId) {
                    game.selectedUnit.x = Number(data.x || game.selectedUnit.x);
                    game.selectedUnit.y = Number(data.y || game.selectedUnit.y);
                    try { if (game.selectedUnit.meta) { delete game.selectedUnit.meta.travelMode; delete game.selectedUnit.meta.warpTPT; } } catch {}
                    try { game.updateUnitDetails && game.updateUnitDetails(); } catch {}
                }
                // Clear planned lane highlight when transit completes
                try { if (game.__laneHighlight) game.__laneHighlight.until = 0; } catch {}
                try { game.addLogEntry('🚀 Exited lane', 'info'); } catch {}
                game.render && game.render();
            } catch {}
        },
        'queue:updated': async (payload) => {
            try {
                const shipId = Number(payload?.shipId || 0);
                if (!shipId || !game || !game.socket) return;
                const { orders } = await rebuildQueuedSegmentsForShip(shipId);
                // If the updated ship is currently selected, refresh the queue panel with debounce
                if (game.selectedUnit && game.selectedUnit.id === shipId) {
                    scheduleQueueRefresh(shipId);
                    // Also refresh lane highlight if an itinerary exists
                    try {
                        const sectorId = game.gameState?.sector?.id;
                        if (sectorId) {
                            const resp = await SFApi.State.itineraries(game.gameId, game.userId, sectorId);
                            const items = Array.isArray(resp?.itineraries) ? resp.itineraries.filter(it => it.status === 'active') : [];
                            const it = items.find(r => Number(r.shipId||r.ship_id) === Number(shipId));
                            if (it) {
                                const legs = (it.legs||[]).map(L => {
                                    try {
                                        const edgeId = Number(L?.edgeId ?? L?.edge_id);
                                        const entryRaw = (L?.entry ?? L?.entry_type ?? 'tap');
                                        const sStart = Number(L?.sStart ?? L?.s_start ?? 0);
                                        const sEnd = Number(L?.sEnd ?? L?.s_end ?? sStart);
                                        return { edgeId, entry: (String(entryRaw)==='tap'?'tap':'wildcat'), sStart, sEnd };
                                    } catch { return null; }
                                }).filter(Boolean);
                                if (legs.length) { game.__laneHighlight = { until: Number.MAX_SAFE_INTEGER, legs }; game.render && game.render(); }
                            }
                        }
                    } catch {}
                    // If nothing remains queued, clear any local active movement visuals for immediate feedback
                    if (!orders || orders.length === 0) {
                        try {
                            const obj = game.objects.find(o => o.id === shipId);
                            if (obj) {
                                delete obj.movementSegments; delete obj.movementPath; obj.movementActive = false; delete obj.plannedDestination;
                            }
                            if (game.selectedUnit) {
                                delete game.selectedUnit.movementSegments; delete game.selectedUnit.movementPath; game.selectedUnit.movementActive = false; delete game.selectedUnit.plannedDestination;
                            }
                            game.render && game.render();
                        } catch {}
                    }
                }
            } catch {}
        },
        'chat:game': (msg) => { if (window.appendChat) window.appendChat(msg); },
        'chat:channel': (msg) => { if (window.appendChat) window.appendChat(msg); },
        'chat:dm': (msg) => { if (window.appendChat) window.appendChat(msg); },
        'ability-queued': (payload) => {
            try {
                game.refreshAbilityCooldowns && game.refreshAbilityCooldowns();
                const casterId = payload?.casterId;
                const abilityKey = payload?.abilityKey;
                if (abilityKey === 'microthruster_shift' && casterId) {
                    if (game.selectedUnit && game.selectedUnit.id === casterId) {
                        const currentTurn = game.gameState?.currentTurn?.turn_number || 0;
                        game.selectedUnit.meta = game.selectedUnit.meta || {};
                        game.selectedUnit.meta.movementFlatBonus = Math.max(game.selectedUnit.meta.movementFlatBonus || 0, 3);
                        game.selectedUnit.meta.movementFlatExpires = Number(currentTurn) + 1;
                        game.render && game.render();
                    }
                    const unit = game.units?.find(u => u.id === casterId);
                    if (unit) {
                        const currentTurn = game.gameState?.currentTurn?.turn_number || 0;
                        unit.meta = unit.meta || {};
                        unit.meta.movementFlatBonus = Math.max(unit.meta.movementFlatBonus || 0, 3);
                        unit.meta.movementFlatExpires = Number(currentTurn) + 1;
                    }
                }
            } catch {}
        }
    };
}
