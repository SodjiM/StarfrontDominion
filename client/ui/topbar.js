// Topbar UI helpers: turn counter, title, lock button, countdown
// Note: gate travel button moved to UnitDetails; no direct gate button in topbar anymore

export function updateTopbar(game) {
    try {
        // Turn counter
        const turn = game.gameState?.currentTurn?.turn_number || 1;
        const turnEl = game._els.turnCounter || (game._els.turnCounter = document.getElementById('turnCounter'));
        const turnLabel = document.getElementById('turnCounterLabel');
        if (turnLabel) turnLabel.textContent = `Turn ${turn}`;
        else if (turnEl) turnEl.textContent = `Turn ${turn}`;

        // Title
        const title = game.gameState?.sector?.name || 'Your System';
        const titleEl = document.getElementById('systemContext');
        if (titleEl) titleEl.textContent = `${title} · ${String(game.gameState?.sector?.archetype || 'standard').replace(/-/g,' ')}`;

        // Lock state
        const lockBtn = game._els.lockTurnBtn || (game._els.lockTurnBtn = document.getElementById('lockTurnBtn'));
        if (lockBtn) {
            const lockIcon = lockBtn.querySelector('.button-icon');
            const lockLabel = lockBtn.querySelector('.button-label');
            if (game.gameState?.turnLocked) {
                if (lockIcon) lockIcon.textContent = '🔒';
                if (lockLabel) lockLabel.textContent = 'Turn Locked';
                if (!lockLabel) lockBtn.textContent = '🔒 Turn Locked';
                lockBtn.setAttribute('aria-label', 'Unlock turn');
                lockBtn.classList.add('locked');
                game.turnLocked = true;
            } else {
                if (lockIcon) lockIcon.textContent = '🔓';
                if (lockLabel) lockLabel.textContent = 'Lock Turn';
                if (!lockLabel) lockBtn.textContent = '🔓 Lock Turn';
                lockBtn.setAttribute('aria-label', 'Lock turn');
                lockBtn.classList.remove('locked');
                game.turnLocked = false;
            }
        }

        // Countdown
        updateTurnCountdown(game);
    } catch {}
}

export function updateTurnCountdown(game) {
    try {
        const countdownEl = document.getElementById('turnCountdown');
        if (!countdownEl) return;
        const autoMin = game.gameState?.autoTurnMinutes;
        const createdAt = game.gameState?.currentTurn?.created_at;
        if (typeof autoMin !== 'number' || !createdAt) {
            countdownEl.style.display = 'none';
            if (game.turnCountdownTimer) { clearInterval(game.turnCountdownTimer); game.turnCountdownTimer = null; }
            return;
        }
        const dueMs = autoMin * 60 * 1000;
        const createdStr = String(createdAt);
        const normalized = createdStr.includes('T') ? createdStr : (createdStr.replace(' ', 'T') + 'Z');
        const createdMs = Date.parse(normalized);
        if (!Number.isFinite(createdMs) || dueMs <= 0) {
            countdownEl.style.display = 'none';
            if (game.turnCountdownTimer) { clearInterval(game.turnCountdownTimer); game.turnCountdownTimer = null; }
            return;
        }
        const tick = () => {
            const remaining = (createdMs + dueMs) - Date.now();
            if (remaining <= 0) {
                countdownEl.textContent = 'Next in 00:00';
            } else {
                const totalSec = Math.floor(remaining / 1000);
                const m = Math.floor(totalSec / 60);
                const s = totalSec % 60;
                const h = Math.floor(m / 60);
                const mm = (h > 0) ? String(m % 60).padStart(2,'0') : String(m).padStart(2,'0');
                const ss = String(s).padStart(2,'0');
                countdownEl.textContent = h > 0 ? `Next in ${h}:${mm}:${ss}` : `Next in ${mm}:${ss}`;
            }
        };
        countdownEl.style.display = '';
        if (game.turnCountdownTimer) clearInterval(game.turnCountdownTimer);
        tick();
        game.turnCountdownTimer = setInterval(tick, 1000);
    } catch {}
}

export function updateSectorOverviewTitle(game) {
    try {
        const titleElement = document.getElementById('sectorOverviewTitle');
        if (!titleElement) return;
        if (game.gameState?.sector?.name) {
            titleElement.textContent = `🌌 ${game.gameState.sector.name}`;
        } else {
            titleElement.textContent = 'Sector Overview';
        }
    } catch {}
}
