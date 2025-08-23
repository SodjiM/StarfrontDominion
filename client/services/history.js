// Movement history service and cache management

export async function fetchMovementHistory(game, shipId = null, turns = 10) {
    try {
        const data = await SFApi.State.movementHistory(game.gameId, game.userId, shipId, turns);
        if (!data.success) throw new Error(data.error || 'Failed to fetch movement history');
        if (!game.movementHistoryCache) game.movementHistoryCache = new Map();
        data.movementHistory.forEach(movement => {
            if (!game.movementHistoryCache.has(movement.shipId)) {
                game.movementHistoryCache.set(movement.shipId, []);
            }
            const shipHistory = game.movementHistoryCache.get(movement.shipId);
            if (!shipHistory.some(h => h.turnNumber === movement.turnNumber && h.segment.from.x === movement.segment.from.x && h.segment.from.y === movement.segment.from.y)) {
                shipHistory.push(movement);
            }
        });
        return data.movementHistory;
    } catch (error) {
        console.error('❌ Failed to fetch movement history:', error);
        return [];
    }
}


