let audioEl = null;
let hasStarted = false;

const VOLUME_KEY = 'SF_MUSIC_VOLUME';
const ENABLED_KEY = 'SF_MUSIC_ENABLED';

function readSavedVolume() {
    try {
        const v = localStorage.getItem(VOLUME_KEY);
        const num = Math.max(0, Math.min(1, Number(v)));
        return Number.isFinite(num) && num >= 0 && num <= 1 ? num : 0.25;
    } catch { return 0.25; }
}

function readSavedEnabled() {
    try {
        const v = localStorage.getItem(ENABLED_KEY);
        if (v == null) return true;
        const s = String(v).toLowerCase();
        return s === '1' || s === 'true' || s === 'yes' || s === 'on';
    } catch { return true; }
}

export function setupBackgroundMusic() {
    if (typeof window === 'undefined' || hasStarted) return;
    // Create hidden audio element
    audioEl = document.createElement('audio');
    audioEl.src = '/assets/audio/game_background.mp3';
    audioEl.loop = true;
    audioEl.volume = readSavedVolume();
    audioEl.preload = 'auto';
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);

    // Apply saved enabled/mute state
    const enabled = readSavedEnabled();
    audioEl.muted = !enabled;

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
    try { localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0'); } catch {}
}

export function setMusicVolume(volume) {
    if (!audioEl) return;
    const v = Math.max(0, Math.min(1, Number(volume) || 0));
    audioEl.volume = v;
    try { localStorage.setItem(VOLUME_KEY, String(v)); } catch {}
}

export function getMusicVolume() {
    if (audioEl) return audioEl.volume;
    return readSavedVolume();
}

export function isMusicEnabled() {
    if (audioEl) return !audioEl.muted;
    return readSavedEnabled();
}


