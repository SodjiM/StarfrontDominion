// Topbar UI helpers: turn counter, title, lock button, countdown
// Note: gate travel button moved to UnitDetails; no direct gate button in topbar anymore

export function updateTopbar(game) {
    try {
        // Turn counter
        const turn = game.gameState?.currentTurn?.turn_number || 1;
        const turnEl = game._els.turnCounter || (game._els.turnCounter = document.getElementById('turnCounter'));
        if (turnEl) turnEl.textContent = `Turn ${turn}`;

        // Title
        const title = game.gameState?.sector?.name || 'Your System';
        const titleEl = game._els.gameTitle || (game._els.gameTitle = document.getElementById('gameTitle'));
        if (titleEl) titleEl.innerHTML = `🌌 ${title}`;

        // Lock state
        const lockBtn = game._els.lockTurnBtn || (game._els.lockTurnBtn = document.getElementById('lockTurnBtn'));
        if (lockBtn) {
            if (game.gameState?.turnLocked) {
                lockBtn.textContent = '🔒 Turn Locked';
                lockBtn.classList.add('locked');
                game.turnLocked = true;
            } else {
                lockBtn.textContent = '🔓 Lock Turn';
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


