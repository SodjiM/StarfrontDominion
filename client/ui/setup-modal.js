// Starfront: Dominion - Setup modal UI (ESM)

export function showSetupModal(game) {
        const setupForm = createSetupForm(game);
        const validationMessage = document.createElement('p');
        validationMessage.className = 'setup-validation-message';
        validationMessage.setAttribute('role', 'alert');
        validationMessage.setAttribute('aria-live', 'assertive');
        validationMessage.hidden = true;

        if (!window.UI?.showModal) {
            throw new Error('UI modal service is unavailable');
        }
        const modal = UI.showModal({
            title: '🚀 Initialize Your Solar System',
            content: setupForm,
            allowClose: false,
            actions: [ { text: 'Complete Setup', style: 'primary', action: () => submit(game, validationMessage) } ]
        });
        modal.querySelector('.game-modal-actions')?.prepend(validationMessage);
}

    function createSetupForm(game) {
        const form = document.createElement('div');
        form.className = 'setup-form';
        form.innerHTML = `
            <div class="form-section">
                <h3>👤 Choose Your Avatar</h3>
                <div class="avatar-grid" id="avatarGrid">${createAvatarSelector()}</div>
            </div>
            <div class="form-section">
                <h3>🎨 Color Scheme</h3>
                <div class="color-picker-group">
                    <div class="color-picker">
                        <label for="primaryColor">Primary Color:</label>
                        <input type="color" id="primaryColor" value="#64b5f6">
                    </div>
                    <div class="color-picker">
                        <label for="secondaryColor">Secondary Color:</label>
                        <input type="color" id="secondaryColor" value="#42a5f5">
                    </div>
                </div>
            </div>
            <div class="form-section">
                <h3>🧬 Archetype</h3>
                <select id="archetypeSelect" class="form-input">
                    <option value="WORMHOLE">Wormhole Cluster — Doors & Drift</option>
                    <option value="ASTBELT">Asteroid-Heavy Belt — Rubble & Riches</option>
                    <option value="DIPLOMATIC_EXPANSE">Diplomatic Expanse — Auric Courts</option>
                    <option value="GRAVITON">Graviton Sink — Weight & Whorls</option>
                    <option value="RELAY">Starlight Relay — Beacons & Slipstreams</option>
                    <option value="FORGEYARD">Capital Forgeyard — Hull & Bulwark</option>
                    <option value="SOLAR">Solar Flare Engine — Light & Rhythm</option>
                    <option value="ION_TEMPEST">Ion Tempest — EM Weather</option>
                    <option value="DARK_NEBULA">Dark Nebula Nursery — Shadows & Birth</option>
                    <option value="CRYO_COMET">Cryo Comet Rain — Cold Logistics</option>
                    <option value="BINARY">Binary Star System — Duality & Tides</option>
                    <option value="SUPERNOVA">Supernova Remnant — Furnace & Shrapnel</option>
                    <option value="GHOST_NET">Ghost Net Array — Drones & Deception</option>
                    <option value="STANDARD">Standard Sector</option>
                </select>
            </div>
            <div class="form-section">
                <h3>🌌 Solar System Name</h3>
                <input type="text" id="systemName" class="form-input" placeholder="Enter system name..." maxlength="30" required>
            </div>`;
        setTimeout(() => attachSetupEventListeners(), 100);
        return form;
    }

function createAvatarSelector() {
        const avatars = [
            { id: 'commander', name: 'Commander' },
            { id: 'explorer', name: 'Explorer' },
            { id: 'merchant', name: 'Merchant' },
            { id: 'scientist', name: 'Scientist' },
            { id: 'warrior', name: 'Warrior' },
            { id: 'diplomat', name: 'Diplomat' }
        ];
        return avatars.map(avatar => `
            <button type="button" class="avatar-option" data-avatar="${avatar.id}" aria-pressed="false">
                <img src="assets/avatars/${avatar.id}.png" alt="${avatar.name}" data-avatar-img="1">
                <span>${avatar.name}</span>
            </button>`).join('');
}

function attachSetupEventListeners() {
        document.querySelectorAll('.avatar-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.avatar-option').forEach(o => {
                    o.classList.remove('selected');
                    o.setAttribute('aria-pressed', 'false');
                });
                option.classList.add('selected');
                option.setAttribute('aria-pressed', 'true');
                option.removeAttribute('aria-invalid');
            });
        });
        document.querySelectorAll('img[data-avatar-img]').forEach(img => {
            img.addEventListener('error', () => { img.src = 'assets/avatars/explorer.png'; });
        });
        const systemNameInput = document.getElementById('systemName');
        if (systemNameInput) systemNameInput.focus();
}

async function submit(game, validationMessage) {
        const selectedAvatar = document.querySelector('.avatar-option.selected')?.dataset.avatar;
        const primaryColor = document.getElementById('primaryColor')?.value;
        const secondaryColor = document.getElementById('secondaryColor')?.value;
        const archetypeKey = document.getElementById('archetypeSelect')?.value || 'STANDARD';
        const systemName = document.getElementById('systemName')?.value?.trim();
        const showValidationError = (message, target) => {
            if (validationMessage) {
                validationMessage.textContent = message;
                validationMessage.hidden = false;
            }
            target?.setAttribute('aria-invalid', 'true');
            target?.focus();
            return false;
        };

        if (validationMessage) {
            validationMessage.textContent = '';
            validationMessage.hidden = true;
        }
        document.querySelectorAll('[aria-invalid="true"]').forEach(element => element.removeAttribute('aria-invalid'));

        if (!selectedAvatar) return showValidationError("Please make sure that you've selected an avatar.", document.querySelector('.avatar-option'));
        if (!systemName) return showValidationError("Please make sure that you've named your solar system.", document.getElementById('systemName'));
        if (systemName.length > 30) return showValidationError('Your solar system name must be 30 characters or fewer.', document.getElementById('systemName'));
        try {
            const response = await fetch(`/game/setup/${game.gameId}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: game.userId,
                    avatar: selectedAvatar,
                    colorPrimary: primaryColor,
                    colorSecondary: secondaryColor,
                    systemName,
                    archetypeKey
                })
            });
            if (!response.ok) {
                let errorMessage = 'Setup failed';
                try {
                    const text = await response.text();
                    try { errorMessage = (JSON.parse(text).error) || errorMessage; } catch { errorMessage = text || errorMessage; }
                } catch {}
                return showValidationError(`Setup failed: ${errorMessage}`, document.getElementById('systemName'));
            }
            await response.json();
            game.addLogEntry('System setup completed successfully!', 'success');
            await game.loadGameState();
            return true;
        } catch (error) {
            return showValidationError(`Connection failed: ${error.message}. Please try again.`);
        }
}
