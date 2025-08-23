let audioEl = null;
let hasStarted = false;

export function setupBackgroundMusic() {
    if (typeof window === 'undefined' || hasStarted) return;
    // Create hidden audio element
    audioEl = document.createElement('audio');
    audioEl.src = 'assets/audio/game_background.mp3';
    audioEl.loop = true;
    audioEl.volume = 0.25;
    audioEl.preload = 'auto';
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);

    const start = async () => {
        if (hasStarted) return;
        hasStarted = true;
        try { await audioEl.play(); } catch {}
        removeListeners();
    };

    const removeListeners = () => {
        document.removeEventListener('pointerdown', start, { capture: true });
        document.removeEventListener('keydown', start, { capture: true });
        document.removeEventListener('touchstart', start, { capture: true });
    };

    // User interaction required by browsers
    document.addEventListener('pointerdown', start, { once: true, capture: true });
    document.addEventListener('keydown', start, { once: true, capture: true });
    document.addEventListener('touchstart', start, { once: true, capture: true });
}

export function setMusicEnabled(enabled) {
    if (!audioEl) return;
    if (enabled) {
        audioEl.muted = false;
        if (audioEl.paused) { try { audioEl.play(); } catch {} }
    } else {
        audioEl.muted = true;
    }
}

export function setMusicVolume(volume) {
    if (!audioEl) return;
    audioEl.volume = Math.max(0, Math.min(1, Number(volume) || 0));
}


