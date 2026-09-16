// Topbar/global controls binding

export function bindControls(game) {
    try {
        const byId = (id) => document.getElementById(id);
        const on = (id, fn) => { const el = byId(id); if (el) el.addEventListener('click', fn); };
        on('lockTurnBtn', () => game.lockCurrentTurn && game.lockCurrentTurn());
        const focusActive = () => game.centerOnActiveShip && game.centerOnActiveShip();
        on('centerActiveShipBtn', focusActive);
        on('centerActiveShipHeaderBtn', focusActive);
        on('playersStatusBtn', async () => { try { const mod = await import('./players-modal.js'); mod.showPlayers(); } catch {} });
        const openActivity = () => {
            try { game.toggleTurnReport && game.toggleTurnReport(); } catch {}
        };
        on('turnCounter', openActivity);
        on('turnReportBtn', openActivity);
        const closeMenu = () => {
            const menu = byId('utilityMenu'); const trigger = byId('menuBtn');
            if (!menu || !trigger) return;
            menu.hidden = true; trigger.setAttribute('aria-expanded', 'false');
        };
        on('menuBtn', () => {
            const menu = byId('utilityMenu'); const trigger = byId('menuBtn');
            if (!menu || !trigger) return;
            const open = menu.hidden;
            menu.hidden = !open; trigger.setAttribute('aria-expanded', String(open));
            if (open) menu.querySelector('[role="menuitem"]')?.focus();
        });
        on('openEncyclopediaBtn', () => { closeMenu(); try { if (typeof window.openEncyclopedia === 'function') window.openEncyclopedia(); else UI.showAlert('Encyclopedia coming soon'); } catch {} });
        on('settingsBtn', async () => { closeMenu(); try { const mod = await import('./settings-modal.js'); mod.showSettingsModal && mod.showSettingsModal(); } catch {} });
        on('exitGameBtn', () => { closeMenu(); try { if (typeof window.exitGame === 'function') window.exitGame(); else window.location.href = '/play'; } catch {} });
        on('zoomInBtn', () => { if (game.tileSize < 40) { game.tileSize += 2; game.render && game.render(); } });
        on('zoomOutBtn', () => { if (game.tileSize > 8) { game.tileSize -= 2; game.render && game.render(); } });
        const openMap = async () => { try { const mod = await import('./map-ui.js'); mod.openMap(); } catch {} };
        const toggleMini = () => { try { const mod = require('./minimap.js'); mod.toggleFloatingMiniMap(game); } catch { import('./minimap.js').then(mod => mod.toggleFloatingMiniMap(game)); } };
        on('floatingMiniBtn', toggleMini);
        on('openMapBtn', openMap);
        on('mobileStrategicMapBtn', () => { closeMenu(); openMap(); });
        on('mobileMiniMapBtn', () => { closeMenu(); toggleMini(); });
        on('playerAssetsBtn', async () => { try { const mod = await import('./assets-modal.js'); mod.showAssets(); } catch {} });
        on('senateBtn', async () => { try { const mod = await import('./senate.js'); mod.showSenate(); } catch {} });

        // Generic data-action fallbacks for common actions
        document.addEventListener('click', async (e) => {
            if (!e.target.closest('#utilityMenu, #menuBtn')) closeMenu();
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
        document.addEventListener('keydown', (e) => {
            const menu = byId('utilityMenu');
            if (menu && !menu.hidden && e.target.closest('#utilityMenu') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                const items = [...menu.querySelectorAll('[role="menuitem"]')].filter(item => !item.hidden && getComputedStyle(item).display !== 'none');
                const index = Math.max(0, items.indexOf(document.activeElement));
                items[(index + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
                return;
            }
            if (e.key !== 'Escape') return;
            const wasOpen = menu && !menu.hidden;
            closeMenu();
            if (wasOpen) byId('menuBtn')?.focus();
        });
    } catch {}
}
