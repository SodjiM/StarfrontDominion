// Players modal: show all players, lock status, and online status
import { renderPresence } from '../utils/time.js';
import { escapeAttr } from '../utils/dom.js';

const safeText = (value, fallback = '') => escapeAttr(value == null || value === '' ? fallback : value);
const safeAvatar = (value) => {
    const name = String(value || 'explorer').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
    return `assets/avatars/${name || 'explorer'}.png`;
};
const safeColor = (value) => /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? String(value) : '#64b5f6';

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
                <h3>Players (Turn ${safeText(currentTurn, '—')})</h3>
                <div style="display:grid; gap:10px;">
                    ${players.map(p => {
                        const avatarSrc = safeAvatar(p.avatar);
                        const borderColor = safeColor(p.colorPrimary);
                        return `
                        <div class=\"asset-item\" style=\"display:flex; align-items:center; justify-content:space-between;\">
                            <div style=\"display:flex; align-items:center; gap:10px;\">
                                <img src=\"${avatarSrc}\" alt=\"avatar\" data-avatar=\"1\" style=\"width:36px; height:36px; border-radius:50%; border:2px solid ${borderColor}; object-fit:cover;\">
                                <div>
                                    <div class=\"asset-name\">${safeText(p.username, 'Player ' + p.userId)}</div>
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

// time/presence helpers imported from ../utils/time.js

// Players modal UI module (ESM)

export async function showPlayers(target = null) {
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
            const presence = (p) => renderPresence(p);
            const container = document.createElement('div');
            container.innerHTML = `
                <div class="form-section">
                    <h3>Players (Turn ${safeText(currentTurn, '—')})</h3>
                    <div style="display:grid; gap:10px;">
                        ${players.map(p => {
                            const avatarSrc = safeAvatar(p.avatar);
                            const borderColor = safeColor(p.colorPrimary);
                            return `
                            <div class="asset-item" style="display:flex; align-items:center; justify-content:space-between;">
                                <div style="display:flex; align-items:center; gap:10px;">
                                    <img src="${avatarSrc}" alt="avatar" style="width:36px; height:36px; border-radius:50%; border:2px solid ${borderColor}; object-fit:cover;" data-avatar-img="1">
                                    <div>
                                        <div class="asset-name">${safeText(p.username, 'Player ' + p.userId)}</div>
                                        <div class="asset-position" style="display:flex; gap:10px;">
                                            <span title="Online status">${presence(p)}</span>
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
            if (target) {
                target.replaceChildren(...Array.from(container.children));
                return;
            }
            UI.showModal({ title: '👥 Players', content: container, actions: [{ text: 'Close', style: 'primary', action: () => true }] });
        } catch (e) {
            console.error('Players modal error:', e);
            UI.showAlert('Failed to load players');
        }
}
