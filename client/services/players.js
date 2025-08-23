// Players service: name cache and lookups

export async function primeCache(game) {
    try {
        if (!game?.socket) return;
        const data = await new Promise((resolve) => {
            game.socket.timeout(4000).emit('players:list', { gameId: game.gameId }, (err, response) => {
                if (err) resolve({ success: false }); else resolve(response);
            });
        });
        if (data && data.success && Array.isArray(data.players)) {
            data.players.forEach(p => {
                if (p?.userId) game.playerNameById.set(p.userId, p.username || `Player ${p.userId}`);
            });
        }
        // Ensure current user present
        try {
            const me = (typeof Session !== 'undefined' && typeof Session.getUser === 'function') ? Session.getUser() : null;
            if (me?.userId && me?.username) game.playerNameById.set(Number(me.userId), me.username);
        } catch {}
    } catch {}
}

export function getName(game, ownerId) {
    if (!ownerId) return '';
    if (game.playerNameById.has(ownerId)) return game.playerNameById.get(ownerId);
    if (ownerId === game.userId) return (Session.getUser()?.username) || 'You';
    return `Player ${ownerId}`;
}


