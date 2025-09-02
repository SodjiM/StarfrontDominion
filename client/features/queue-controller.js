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
        // Optimistic local preview: extend queued segments immediately
        try {
            const obj = game.objects && game.objects.find(o => o.id === shipId);
            if (obj) {
                let start = null;
                if (obj.movementSegments && obj.movementSegments.length > 0) {
                    const last = obj.movementSegments[obj.movementSegments.length - 1];
                    start = { x: last.to.x, y: last.to.y };
                } else if (obj.movementPath && obj.movementPath.length > 1 && obj.movementActive) {
                    start = obj.movementPath[obj.movementPath.length - 1];
                } else if (obj.plannedDestination && typeof obj.plannedDestination.x === 'number') {
                    start = { x: obj.plannedDestination.x, y: obj.plannedDestination.y };
                } else {
                    start = { x: obj.x, y: obj.y };
                }
                const seg = { from: { x: start.x, y: start.y }, to: { x: Number(x), y: Number(y) } };
                const segs = (obj.movementSegments ? obj.movementSegments.slice() : []);
                segs.push(seg);
                obj.movementSegments = segs;
                if (game.selectedUnit && game.selectedUnit.id === shipId) game.selectedUnit.movementSegments = segs;
                if (typeof game.render === 'function') game.render();
            }
        } catch {}
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


