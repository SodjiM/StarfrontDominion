// Starfront: Dominion - Setup modal UI (ESM)

export function showSetupModal(game) {
        const setupForm = createSetupForm(game);
        UI.showModal({
            title: '🚀 Initialize Your Solar System',
            content: setupForm,
            allowClose: false,
            actions: [ { text: 'Complete Setup', style: 'primary', action: () => submit(game) } ]
        });
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
            <div class="avatar-option" data-avatar="${avatar.id}">
                <img src="assets/avatars/${avatar.id}.png" alt="${avatar.name}" data-avatar-img="1">
                <span>${avatar.name}</span>
            </div>`).join('');
}

function attachSetupEventListeners() {
        document.querySelectorAll('.avatar-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.avatar-option').forEach(o => o.classList.remove('selected'));
                option.classList.add('selected');
            });
        });
        document.querySelectorAll('img[data-avatar-img]').forEach(img => {
            img.addEventListener('error', () => { img.src = 'assets/avatars/explorer.png'; });
        });
        const systemNameInput = document.getElementById('systemName');
        if (systemNameInput) systemNameInput.focus();
}

async function submit(game) {
        const selectedAvatar = document.querySelector('.avatar-option.selected')?.dataset.avatar;
        const primaryColor = document.getElementById('primaryColor')?.value;
        const secondaryColor = document.getElementById('secondaryColor')?.value;
        const systemName = document.getElementById('systemName')?.value?.trim();
        if (!selectedAvatar) { UI.showAlert('Please select an avatar'); return false; }
        if (!systemName) { UI.showAlert('Please enter a system name'); return false; }
        if (systemName.length > 30) { UI.showAlert('System name too long (max 30 characters)'); return false; }
        try {
            const response = await fetch(`/game/setup/${game.gameId}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: game.userId,
                    avatar: selectedAvatar,
                    colorPrimary: primaryColor,
                    colorSecondary: secondaryColor,
                    systemName
                })
            });
            if (!response.ok) {
                let errorMessage = 'Setup failed';
                try {
                    const text = await response.text();
                    try { errorMessage = (JSON.parse(text).error) || errorMessage; } catch { errorMessage = text || errorMessage; }
                } catch {}
                UI.showAlert(`Setup failed: ${errorMessage}`);
                return false;
            }
            await response.json();
            game.addLogEntry('System setup completed successfully!', 'success');
            await game.loadGameState();
            return true;
        } catch (error) {
            UI.showAlert(`Connection failed: ${error.message}. Please try again.`);
            return false;
        }
}


