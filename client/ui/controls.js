// Topbar/global controls binding

export function bindControls(game) {
    try {
        const byId = (id) => document.getElementById(id);
        const on = (id, fn) => { const el = byId(id); if (el) el.addEventListener('click', fn); };
        on('lockTurnBtn', () => game.lockCurrentTurn && game.lockCurrentTurn());
        on('playersStatusBtn', async () => { try { const mod = await import('./players-modal.js'); mod.showPlayers(); } catch {} });
        on('openEncyclopediaBtn', () => { try { if (typeof window.openEncyclopedia === 'function') window.openEncyclopedia(); else UI.showAlert('Encyclopedia coming soon'); } catch {} });
        on('settingsBtn', () => { try { if (typeof window.showSettings === 'function') window.showSettings(); else UI.showAlert('Settings coming soon'); } catch {} });
        on('exitGameBtn', () => { try { if (typeof window.exitGame === 'function') window.exitGame(); else window.location.href = '/play'; } catch {} });
        on('zoomInBtn', () => { if (game.tileSize < 40) { game.tileSize += 2; game.render && game.render(); } });
        on('zoomOutBtn', () => { if (game.tileSize > 8) { game.tileSize -= 2; game.render && game.render(); } });
        on('floatingMiniBtn', () => { try { const mod = require('./minimap.js'); mod.toggleFloatingMiniMap(game); } catch { import('./minimap.js').then(mod => mod.toggleFloatingMiniMap(game)); } });
        on('openMapBtn', async () => { try { const mod = await import('./map-ui.js'); mod.openMap(); } catch {} });
        on('playerAssetsBtn', async () => { try { const mod = await import('./assets-modal.js'); mod.showAssets(); } catch {} });
        on('senateBtn', async () => { try { const mod = await import('./senate.js'); mod.showSenate(); } catch {} });

        // Generic data-action fallbacks for common actions
        document.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.getAttribute('data-action');
            if (action === 'toggle-mining') {
                try { const mod = await import('../features/mining.js'); mod.toggleMining && mod.toggleMining(); } catch {}
            }
            if (action === 'show-cargo') {
                try { const mod = await import('./cargo-modal.js'); mod.showCargo && mod.showCargo(game); } catch {}
            }
        });
    } catch {}
}


