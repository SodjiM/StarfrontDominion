// Starfront: Dominion - Player panel UI (ESM)

export function updateAvatar(game) {
        const avatarMini = document.getElementById('playerAvatarMini');
        if (!avatarMini) return;
        const stored = localStorage.getItem('avatar');
        if (stored) avatarMini.src = stored;
}

export function updateInfo(game) {
        if (!game || !game.gameState) return;
        const commanderNameEl = document.getElementById('commanderName');
        const swatch = document.getElementById('playerColorSwatch');
        const systemNameLabel = document.getElementById('systemNameLabel');
        if (commanderNameEl) commanderNameEl.textContent = game.gameState.player?.username || (Session.getUser()?.username) || 'Commander';
        const me = (game.gameState.players || []).find(p => p.userId === game.userId);
        if (swatch && me) swatch.style.background = me.colorPrimary || '#64b5f6';
        if (systemNameLabel && game.gameState.sector?.name) systemNameLabel.textContent = game.gameState.sector.name;
}

function applySenate(game) {
        if (typeof game.applySenateProgressToUI === 'function') game.applySenateProgressToUI();
}

function updateStatsStrip(game) {
        if (!game || !game.gameState) return;
        const objects = Array.isArray(game.gameState.objects) ? game.gameState.objects : [];
        const mine = objects.filter(o => o.owner_id === game.userId);
        const ships = mine.filter(o => o.type === 'ship');
        const stations = mine.filter(o => o.type === 'station' || o.type === 'starbase');
        const pilots = ships.length; // one pilot per ship for now; refine if server provides
        const credits = (game.gameState.player && typeof game.gameState.player.credits === 'number') ? game.gameState.player.credits : '—';
        const byId = (id) => document.getElementById(id);
        const setText = (id, text) => { const el = byId(id); if (el) el.textContent = String(text); };
        setText('creditsChip', credits);
        setText('shipsChip', ships.length);
        setText('stationsChip', stations.length);
        setText('pilotsChip', pilots);
        // pilot breakdown (placeholder; can be expanded later when roles/crew exist)
        const breakdown = byId('pilotBreakdown');
        if (breakdown) breakdown.textContent = ships.length ? `${ships.length} active pilots` : '';
}

export function updatePlayerPanel(game) {
        updateAvatar(game);
        updateInfo(game);
        updateStatsStrip(game);
        applySenate(game);
}


