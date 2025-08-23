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
    return {
        'player-locked-turn': (data) => {
            game.addLogEntry(`Player ${data.userId} locked turn ${data.turnNumber}`, 'info');
            if (data.userId === game.userId) {
                game.turnLocked = true;
                if (game.gameState) { game.withState && game.withState(state => { state.turnLocked = true; }); }
                try { const tb = require('../ui/topbar.js'); tb.updateTopbar && tb.updateTopbar(game); } catch { import('../ui/topbar.js').then(tb => tb.updateTopbar && tb.updateTopbar(game)); }
                game.updateUnitDetails && game.updateUnitDetails();
            }
        },
        'player-unlocked-turn': (data) => {
            game.addLogEntry(`Player ${data.userId} unlocked turn ${data.turnNumber}`, 'info');
            if (data.userId === game.userId) {
                game.turnLocked = false;
                if (game.gameState) { game.withState && game.withState(state => { state.turnLocked = false; }); }
                try { const tb = require('../ui/topbar.js'); tb.updateTopbar && tb.updateTopbar(game); } catch { import('../ui/topbar.js').then(tb => tb.updateTopbar && tb.updateTopbar(game)); }
                game.updateUnitDetails && game.updateUnitDetails();
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
                    }, 0);
                });
        },
        'harvesting-started': (data) => { game.addLogEntry(data.message, 'success'); game.loadGameState && game.loadGameState(); },
        'harvesting-stopped': (data) => { game.addLogEntry(data.message, 'info'); game.loadGameState && game.loadGameState(); },
        'harvesting-error': (data) => { game.addLogEntry(`Mining error: ${data.error}`, 'error'); },
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


