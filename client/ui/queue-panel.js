// Starfront: Dominion - Queue panel UI (ESM)

export function renderQueueList(game, shipId, orders) {
        const el = document.getElementById('queueLog');
        if (!el) return;
        if (!orders || orders.length === 0) {
            el.innerHTML = '<div class="log-entry">Queue is empty</div>';
            return;
        }
        const items = orders.map((o, idx) => {
            let label = o.order_type;
            try {
                const p = o.payload ? JSON.parse(o.payload) : {};
                if (o.order_type === 'move' && p?.destination) label = `#${idx+1} Move to (${p.destination.x},${p.destination.y})`;
                else if (o.order_type === 'warp' && p?.destination) label = `#${idx+1} Warp to (${p.destination.x},${p.destination.y})`;
                else if (o.order_type === 'harvest_start') label = `#${idx+1} Start mining (node ${p?.nodeId || '?'})`;
                else if (o.order_type === 'harvest_stop') label = `#${idx+1} Stop mining`;
            } catch {}
            return `<div class="log-entry" data-qid="${o.id}">
                <span>${label}</span>
                <button class="sf-btn sf-btn-xs" data-remove="${o.id}">✖</button>
            </div>`;
        }).join('');
        el.innerHTML = items;
        el.querySelectorAll('button[data-remove]').forEach(btn => {
            btn.onclick = () => {
                const id = Number(btn.getAttribute('data-remove'));
                game.socket.emit('queue:remove', { gameId: game.gameId, shipId, id }, () => game.loadQueueLog(shipId, true));
            };
        });
}

export async function loadQueueLog(game, shipId, force) {
        try {
            if (!force && game._queuedByShipId.has(shipId)) {
                renderQueueList(game, shipId, game._queuedByShipId.get(shipId));
                return;
            }
            const orders = await new Promise((resolve) => {
                game.socket.timeout(3000).emit('queue:list', { gameId: game.gameId, shipId }, (err, data) => {
                    if (err || !data?.success) resolve([]); else resolve(data.orders || []);
                });
            });
            game._queuedByShipId.set(shipId, orders);
            renderQueueList(game, shipId, orders);
        } catch (e) {
            const el = document.getElementById('queueLog');
            if (el) el.innerHTML = '<div class="log-entry error">Failed to load queue</div>';
        }
}

export function clearQueue(game, shipId) {
        game.socket.emit('queue:clear', { gameId: game.gameId, shipId }, () => loadQueueLog(game, shipId, true));
}


