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
        if (row) {
            const gateId = Number(row.dataset.gateId);
            const destName = row.dataset.destinationName || 'Unknown Sector';
            if (!game || !game.selectedUnit) { game?.addLogEntry('No ship selected', 'warning'); return; }
            game.socket.emit('interstellar:travel', { gameId: game.gameId, shipId: game.selectedUnit.id, gateId, userId: game.userId });
            game.addLogEntry(`${game.selectedUnit.meta.name} traveling to ${destName}...`, 'success');
            UI.closeModal();
        }
    });
}


