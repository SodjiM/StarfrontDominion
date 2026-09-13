// Starfront: Dominion - Queue panel UI (ESM)

export function renderQueueList(game, shipId, orders) {
        const el = document.getElementById('queueLog');
        if (!el) return;
        const headerItems = [];
        // Active task indicator (movement only for now)
        try {
            const obj = game.objects && game.objects.find(o => o.id === shipId);
            if (obj) {
                let activeLabel = '';
                if ((obj.movementActive || obj.movementStatus === 'blocked') && (obj.plannedDestination || (obj.movementPath && obj.movementPath.length>1))) {
                    const dest = obj.plannedDestination || (obj.movementPath && obj.movementPath[obj.movementPath.length-1]);
                    const prefix = obj.movementStatus === 'blocked' ? 'Blocked; retrying' : 'Active';
                    if (dest && typeof dest.x === 'number' && typeof dest.y === 'number') activeLabel = `${prefix}: Move to (${dest.x},${dest.y})`;
                    else activeLabel = `${prefix}: Moving`;
                }
                if (activeLabel) {
                    headerItems.push(`<div class=\"log-entry\" style=\"background: rgba(76,175,80,0.15); border-left: 3px solid rgba(76,175,80,0.6);\">\n                        <span>${activeLabel}</span>\n                    </div>`);
                }
            }
        } catch {}
        if (!orders || orders.length === 0) {
            if (headerItems.length) { el.innerHTML = headerItems.join(''); return; }
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
        el.innerHTML = headerItems.join('') + items;
        el.querySelectorAll('button[data-remove]').forEach(btn => {
            btn.onclick = () => {
                const id = Number(btn.getAttribute('data-remove'));
                import('../features/queue-controller.js').then(mod => {
                    mod.remove(game, shipId, id, () => game.loadQueueLog(shipId, true));
                });
            };
        });
}

import * as Queue from '../features/queue-controller.js';

export async function loadQueueLog(game, shipId, force) {
        try {
            if (!force && game._queuedByShipId.has(shipId)) {
                renderQueueList(game, shipId, game._queuedByShipId.get(shipId));
                return;
            }
            const orders = await Queue.list(game, shipId);
            game._queuedByShipId.set(shipId, orders);
            renderQueueList(game, shipId, orders);
        } catch (e) {
            const el = document.getElementById('queueLog');
            if (el) el.innerHTML = '<div class="log-entry error">Failed to load queue</div>';
        }
}

export function clearQueue(game, shipId) {
        Queue.clear(game, shipId);
        loadQueueLog(game, shipId, true);
}

