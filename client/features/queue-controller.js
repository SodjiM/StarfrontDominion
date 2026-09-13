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

export async function actions(game, shipId) {
    return new Promise((resolve) => {
        try {
            game.socket.timeout(3000).emit('queue:actions', { gameId: game.gameId, shipId }, (err, data) => {
                if (err || !data?.success) resolve([]); else resolve(data.actions || []);
            });
        } catch { resolve([]); }
    });
}

export function clear(game, shipId, cb) {
    try { game.socket.emit('queue:clear', { gameId: game.gameId, shipId }, cb); } catch { cb?.({ success: false }); }
}

function orderId() {
    try { return crypto.randomUUID(); } catch { return `order-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

export function remove(game, shipId, id, cb) {
    try { game.socket.emit('queue:remove', { gameId: game.gameId, shipId, id }, cb); } catch { if (cb) cb(); }
}

export function popLast(game, shipId, cb) {
    try { game.socket.emit('queue:pop-last', { gameId: game.gameId, shipId }, cb); } catch { cb?.({ success: false }); }
}

export function addMove(game, shipId, x, y, cb) {
    try {
        game.socket.emit('queue-order', {
            gameId: game.gameId,
            shipId,
            actionType: 'movement.move',
            clientOrderId: orderId(),
            payload: { destination: { x, y } }
        }, (resp) => {
            if (resp?.success && game.selectedUnit?.id === shipId) game.loadQueueLog?.(shipId, true);
            cb?.(resp);
        });
    } catch { if (cb) cb({ success: false }); }
}

export function replaceMove(game, shipId, x, y, cb) {
    try {
        game.socket.emit('queue:replace', {
            gameId: game.gameId,
            shipId,
            actionType: 'movement.move',
            clientOrderId: orderId(),
            payload: { destination: { x, y } }
        }, cb);
    } catch { if (cb) cb({ success: false }); }
}

export function addHarvestStart(game, shipId, nodeId, cb) {
    try {
        game.socket.emit('queue-order', {
            gameId: game.gameId,
            shipId,
            actionType: 'harvest.start',
            clientOrderId: orderId(),
            payload: { nodeId }
        }, cb);
    } catch { if (cb) cb({ success: false }); }
}

export function addAbility(game, casterId, abilityKey, payload, cb) {
    try {
        game.socket.emit('queue-order', {
            gameId: game.gameId,
            shipId: casterId,
            actionType: 'combat.ability',
            clientOrderId: orderId(),
            payload: { abilityKey, ...payload }
        }, cb);
    } catch { if (cb) cb({ success: false }); }
}

export function addHarvestStop(game, shipId, cb) {
    try {
        game.socket.emit('queue-order', {
            gameId: game.gameId,
            shipId,
            actionType: 'harvest.stop',
            clientOrderId: orderId(),
            payload: {}
        }, cb);
    } catch { if (cb) cb({ success: false }); }
}
