// Players modal: show all players, lock status, and online status

export async function showPlayersModal(gameClient) {
    if (!gameClient || !gameClient.socket) return;
    try {
        const data = await new Promise((resolve) => {
            gameClient.socket.timeout(4000).emit('players:list', { gameId: gameClient.gameId }, (err, response) => {
                if (err) resolve({ success: false }); else resolve(response);
            });
        });
        if (!data || !data.success) { UI.showAlert(data?.error || 'Failed to load players'); return; }
        const players = data.players || []; const currentTurn = data.currentTurn;
        const container = document.createElement('div');
        container.innerHTML = `
            <div class="form-section">
                <h3>Players (Turn ${currentTurn})</h3>
                <div style="display:grid; gap:10px;">
                    ${players.map(p => {
                        const avatarSrc = p.avatar ? `assets/avatars/${p.avatar}.png` : 'assets/avatars/explorer.png';
                        const borderColor = p.colorPrimary || '#64b5f6';
                        return `
                        <div class=\"asset-item\" style=\"display:flex; align-items:center; justify-content:space-between;\">
                            <div style=\"display:flex; align-items:center; gap:10px;\">
                                <img src=\"${avatarSrc}\" alt=\"avatar\" data-avatar=\"1\" style=\"width:36px; height:36px; border-radius:50%; border:2px solid ${borderColor}; object-fit:cover;\">
                                <div>
                                    <div class=\"asset-name\">${p.username || 'Player ' + p.userId}</div>
                                    <div class=\"asset-position\" style=\"display:flex; gap:10px;\">
                                        <span title=\"Online status\">${renderPresence(p)}</span>
                                        <span title=\"Turn lock status\">${p.locked ? '🔒 Locked' : '🔓 Unlocked'}</span>
                                    </div>
                                </div>
                            </div>
                            <div style=\"text-align:right; color:#888; font-size:0.85em;\">
                                <div>Gov: —</div>
                                <div>Relation: —</div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `;
        UI.showModal({ title: '👥 Players', content: container, actions: [ { text: 'Close', style: 'primary', action: () => true } ] });
        container.querySelectorAll('img[data-avatar]')?.forEach(img => { img.addEventListener('error', () => { img.src = 'assets/avatars/explorer.png'; }); });
    } catch (e) {
        console.error('Error showing players modal:', e);
        UI.showAlert('Failed to load players');
    }
}

function timeAgo(isoString) {
    try {
        const then = new Date(isoString).getTime();
        const now = Date.now();
        const seconds = Math.max(0, Math.floor((now - then) / 1000));
        const units = [ ['year',31536000],['month',2592000],['week',604800],['day',86400],['hour',3600],['minute',60],['second',1] ];
        for (const [name, secs] of units) { if (seconds >= secs) { const value = Math.floor(seconds / secs); return `${value} ${name}${value !== 1 ? 's' : ''} ago`; } }
        return 'just now';
    } catch { return ''; }
}

function renderPresence(p){
    const now = Date.now();
    const lastSeen = p.lastSeenAt ? new Date(p.lastSeenAt).getTime() : 0;
    const lastActivity = p.lastActivityAt ? new Date(p.lastActivityAt).getTime() : lastSeen;
    const idleMs = now - lastActivity;
    if (p.online) { if (idleMs >= 180000) { return `🟠 Idle · ${timeAgo(new Date(now - idleMs).toISOString())}`; } return '🟢 Online'; }
    return `⚪ Offline${p.lastSeenAt ? ' · seen ' + timeAgo(p.lastSeenAt) : ''}`;
}

// Players modal UI module (ESM)

export async function showPlayers() {
        try {
            const client = window.gameClient;
            if (!client || !client.socket) return;
            const data = await new Promise((resolve) => {
                client.socket.timeout(4000).emit('players:list', { gameId: client.gameId }, (err, response) => {
                    if (err) resolve({ success: false }); else resolve(response);
                });
            });
            if (!data || !data.success) { UI.showAlert(data?.error || 'Failed to load players'); return; }
            const players = data.players || []; const currentTurn = data.currentTurn;
            const renderPresence = (p) => (p.online ? '🟢 Online' : '⚪ Offline');
            const container = document.createElement('div');
            container.innerHTML = `
                <div class="form-section">
                    <h3>Players (Turn ${currentTurn})</h3>
                    <div style="display:grid; gap:10px;">
                        ${players.map(p => {
                            const avatarSrc = p.avatar ? `assets/avatars/${p.avatar}.png` : 'assets/avatars/explorer.png';
                            const borderColor = p.colorPrimary || '#64b5f6';
                            return `
                            <div class="asset-item" style="display:flex; align-items:center; justify-content:space-between;">
                                <div style="display:flex; align-items:center; gap:10px;">
                                    <img src="${avatarSrc}" alt="avatar" style="width:36px; height:36px; border-radius:50%; border:2px solid ${borderColor}; object-fit:cover;" data-avatar-img="1">
                                    <div>
                                        <div class="asset-name">${p.username || 'Player ' + p.userId}</div>
                                        <div class="asset-position" style="display:flex; gap:10px;">
                                            <span title="Online status">${renderPresence(p)}</span>
                                            <span title="Turn lock status">${p.locked ? '🔒 Locked' : '🔓 Unlocked'}</span>
                                        </div>
                                    </div>
                                </div>
                                <div style="text-align:right; color:#888; font-size:0.85em;">
                                    <div>Gov: —</div>
                                    <div>Relation: —</div>
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                </div>`;
            container.querySelectorAll('img[data-avatar-img]').forEach(img => {
                img.addEventListener('error', () => { img.src = 'assets/avatars/explorer.png'; });
            });
            UI.showModal({ title: '👥 Players', content: container, actions: [{ text: 'Close', style: 'primary', action: () => true }] });
        } catch (e) {
            console.error('Players modal error:', e);
            UI.showAlert('Failed to load players');
        }
}


