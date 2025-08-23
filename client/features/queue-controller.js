// Queue controller: server interactions for order queues (no DOM)

export async function list(game, shipId) {
    return new Promise((resolve) => {
        try {
            game.socket.timeout(3000).emit('queue:list', { gameId: game.gameId, shipId }, (err, data) => {
                if (err || !data?.success) resolve([]); else resolve(data.orders || []);
            });
        } catch {
            resolve([]);
        }
    });
}

export function clear(game, shipId) {
    try { game.socket.emit('queue:clear', { gameId: game.gameId, shipId }); } catch {}
}

export function remove(game, shipId, id, cb) {
    try { game.socket.emit('queue:remove', { gameId: game.gameId, shipId, id }, cb); } catch { if (cb) cb(); }
}

export function addMove(game, shipId, x, y, cb) {
    try {
        game.socket.emit('queue-order', {
            gameId: game.gameId,
            shipId,
            orderType: 'move',
            payload: { destination: { x, y } }
        }, cb);
    } catch { if (cb) cb({ success: false }); }
}

export function addHarvestStart(game, shipId, nodeId, cb) {
    try {
        game.socket.emit('queue-order', {
            gameId: game.gameId,
            shipId,
            orderType: 'harvest_start',
            payload: { nodeId }
        }, cb);
    } catch { if (cb) cb({ success: false }); }
}

export function addAbility(game, casterId, abilityKey, payload, cb) {
    try {
        game.socket.emit('queue-order', {
            gameId: game.gameId,
            shipId: casterId,
            orderType: 'ability',
            payload: { abilityKey, ...payload }
        }, cb);
    } catch { if (cb) cb({ success: false }); }
}


