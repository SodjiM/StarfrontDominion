// Senate progress UI and persistence

export function senateStorageKey(game) {
    return `senateProgress:${game.gameId}:${game.userId}`;
}

export function loadSenateProgress(game) {
    try {
        const val = localStorage.getItem(senateStorageKey(game));
        game.senateProgress = Math.min(100, Math.max(0, parseInt(val || '0', 10)));
    } catch { game.senateProgress = 0; }
    applySenateProgressToUI(game);
}

export function saveSenateProgress(game) {
    try { localStorage.setItem(senateStorageKey(game), String(game.senateProgress)); } catch {}
}

export function setSenateProgress(game, pct) {
    game.senateProgress = Math.min(100, Math.max(0, Math.floor(pct)));
    saveSenateProgress(game);
    applySenateProgressToUI(game);
}

export function incrementSenateProgress(game, delta) {
    const prev = game.senateProgress;
    setSenateProgress(game, prev + delta);
    if (game.senateProgress >= 100) {
        if (typeof window.showSenateModal === 'function') {
            window.showSenateModal();
        } else if (window.UI && typeof UI.showAlert === 'function') {
            UI.showAlert('Senate session begins. (Feature coming soon)', '🏛️ Senate');
        }
        setSenateProgress(game, 0);
    }
}

export function applySenateProgressToUI(game) {
    const arc = document.getElementById('senateArc');
    const label = document.getElementById('senateProgressLabel');
    const pct = Math.min(100, Math.max(0, game.senateProgress));
    if (arc) {
        const offset = 100 - pct;
        arc.setAttribute('stroke-dashoffset', String(offset));
    }
    if (label) label.textContent = `${pct}%`;
}

// Senate modal UI module (ESM)

export function showSenate() {
        const content = document.createElement('div');
        content.innerHTML = `
            <div style="display:grid; gap:12px;">
                <p>Government management is coming soon.</p>
                <ul style="margin-left:16px; color:#ccc; line-height:1.6;">
                    <li>Propose and vote on laws</li>
                    <li>Manage senators and political factions</li>
                    <li>Diplomacy and interstellar policies</li>
                </ul>
            </div>`;
        UI.showModal({ title:'🏛️ Senate', content, actions:[{ text:'Close', style:'secondary', action:()=>true }] });
}


