import { setMusicVolume, getMusicVolume, setMusicEnabled, isMusicEnabled } from '../services/music.js';

export function showSettingsModal() {
    const container = document.createElement('div');
    const currentVolume = Math.round((getMusicVolume() || 0.25) * 100);
    const enabled = !!isMusicEnabled();

    container.innerHTML = `
        <div class="form-section">
            <h3>Audio</h3>
            <div style="display:grid; gap:12px;">
                <label style="display:flex; align-items:center; gap:10px;">
                    <input id="musicEnabledToggle" type="checkbox" ${enabled ? 'checked' : ''} />
                    <span>Enable Background Music</span>
                </label>
                <div>
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                        <label for="musicVolumeRange">Music Volume</label>
                        <span id="musicVolumeLabel">${currentVolume}%</span>
                    </div>
                    <input id="musicVolumeRange" type="range" min="0" max="100" step="1" value="${currentVolume}" style="width:100%" />
                </div>
            </div>
        </div>
    `;

    // Attach listeners immediately; Modal.show does not call onShow
    const range = container.querySelector('#musicVolumeRange');
    const label = container.querySelector('#musicVolumeLabel');
    const toggle = container.querySelector('#musicEnabledToggle');
    if (range && label) {
        range.addEventListener('input', () => {
            const v = Number(range.value) || 0;
            label.textContent = `${v}%`;
            setMusicVolume(v / 100);
        });
    }
    if (toggle) {
        toggle.addEventListener('change', () => {
            setMusicEnabled(!!toggle.checked);
        });
    }

    UI.showModal({
        title: '⚙️ Settings',
        content: container,
        actions: [ { text: 'Close', style: 'primary', action: () => true } ],
        className: 'settings-modal'
    });
}


