// Interstellar Travel modal

export function showTravelOptions(game, adjacentGates) {
    const travelModal = document.createElement('div');
    travelModal.className = 'interstellar-travel-modal';
    travelModal.innerHTML = `
        <div class="travel-header">
            <h3>🌀 Interstellar Travel</h3>
            <p>Select a gate to travel through:</p>
        </div>
        <div class="gate-list">
            ${adjacentGates.map(gate => {
                const gateMeta = gate.meta || {};
                return `
                    <div class="gate-option" data-action="travel-gate" data-gate-id="${gate.id}" data-destination-name="${gateMeta.destinationSectorName || 'Unknown Sector'}">
                        <div class="gate-info">
                            <div class="gate-name">🌀 ${gateMeta.name || 'Interstellar Gate'}</div>
                            <div class="gate-destination">Destination: ${gateMeta.destinationSectorName || 'Unknown Sector'}</div>
                        </div>
                        <div class="gate-action"><button class="travel-btn">Travel</button></div>
                    </div>`;
            }).join('')}
        </div>`;
    UI.showModal({ title: '🌀 Interstellar Travel', content: travelModal, actions: [{ text: 'Cancel', style: 'secondary', action: () => true }], className: 'interstellar-travel-modal-container' });
    travelModal.addEventListener('click', (e) => {
        const row = e.target.closest('[data-action="travel-gate"]');
        if (row) { const gateId = Number(row.dataset.gateId); const destName = row.dataset.destinationName || 'Unknown Sector'; travelThroughGate(game, gateId, destName); }
    });
}

export async function travelThroughGate(game, gateId, destinationName) {
    if (!game || !game.selectedUnit) { game?.addLogEntry('No ship selected', 'warning'); return; }
    try {
        const data = await SFApi.Travel.interstellarTravel(game.selectedUnit.id, gateId, game.userId);
        if (data) {
            game.addLogEntry(`${game.selectedUnit.meta.name} traveled to ${destinationName}!`, 'success');
            UI.closeModal();
            game.socket.emit('get-game-state', { gameId: game.gameId, userId: game.userId });
        }
    } catch (error) {
        console.error('Error traveling through gate:', error);
        game.addLogEntry(error?.data?.error || 'Failed to travel through gate', 'error');
    }
}


