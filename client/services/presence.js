// Presence heartbeat service

export function startHeartbeat(game) {
    try {
        if (!game?.socket) return;
        let lastEvent = Date.now();
        const update = () => { lastEvent = Date.now(); };
        const events = ['mousemove','keydown','mousedown','touchstart','wheel'];
        events.forEach(evt => window.addEventListener(evt, update));
        const interval = setInterval(() => {
            if (Date.now() - lastEvent < 10000) {
                try { game.socket.emit('client:activity'); } catch {}
            }
        }, 15000);
        game._presence = { interval, events, update };
    } catch {}
}

export function stopHeartbeat(game) {
    try {
        if (game?._presence?.interval) clearInterval(game._presence.interval);
        if (game?._presence?.events && game?._presence?.update) {
            game._presence.events.forEach(evt => window.removeEventListener(evt, game._presence.update));
        }
        game._presence = null;
    } catch {}
}


