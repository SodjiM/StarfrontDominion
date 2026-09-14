// Player assets modal UI module (ESM)

export async function showAssets() {
        const client = window.gameClient;
        if (!client || !client.gameState) { client?.addLogEntry?.('Game state not available', 'warning'); return; }
        try {
            const playerObjects = client.gameState.objects.filter(obj => obj.owner_id === client.userId);
            if (playerObjects.length === 0) { UI.showAlert('No assets found'); return; }
            const assetsDisplay = document.createElement('div'); assetsDisplay.className = 'player-assets-display';
            const pilots = client.gameState.pilotStats;
            if (pilots) {
                const pilotSection = document.createElement('div'); pilotSection.className = 'assets-summary-section';
                pilotSection.innerHTML = `<h3>🧑‍✈️ Pilot Pool</h3><div class="resource-summary-grid"><div class="resource-summary-item"><span class="resource-name">Available</span><span class="resource-quantity">${pilots.available}/${pilots.capacity}</span></div><div class="resource-summary-item"><span class="resource-name">Deployed</span><span class="resource-quantity">${pilots.deployed ?? pilots.active ?? 0}</span></div><div class="resource-summary-item"><span class="resource-name">Recovering</span><span class="resource-quantity">${pilots.recovering ?? pilots.dead ?? 0}</span></div></div>`;
                assetsDisplay.appendChild(pilotSection);
            }
            const systemName = client.gameState.sector.name || 'Your System';
            const systemSection = document.createElement('div'); systemSection.className = 'assets-system-section'; systemSection.innerHTML = `<h3>🌌 ${systemName}</h3>`;
            const assetPromises = playerObjects.map(async (obj) => {
                let cargoData = null; try { const data = await SFApi.Cargo.getCargo(obj.id, client.userId); if (data) cargoData = data.cargo; } catch {}
                return { obj, cargoData };
            });
            const assetsWithCargo = await Promise.all(assetPromises);
            assetsWithCargo.forEach(({ obj, cargoData }) => {
                const assetItem = document.createElement('div'); assetItem.className = 'asset-item';
                const icon = client.getUnitIcon(obj.type); const name = obj.meta.name || obj.type; const position = `(${obj.x}, ${obj.y})`;
                let cargoInfo = '';
                if (cargoData && cargoData.items.length > 0) {
                    const cargoSummary = cargoData.items.map(item => `${item.icon_emoji} ${item.quantity} ${item.resource_name}`).join(', ');
                    cargoInfo = `<div class="asset-cargo">📦 ${cargoSummary}</div>`;
                } else if (cargoData) { cargoInfo = '<div class="asset-cargo">📦 Empty cargo hold</div>'; }
                assetItem.innerHTML = `
                    <div class="asset-header">
                        <span class="asset-name">${icon} ${name}</span>
                        <span class="asset-position">${position}</span>
                    </div>
                    ${cargoInfo}
                `;
                systemSection.appendChild(assetItem);
            });
            assetsDisplay.appendChild(systemSection);
            const totalResources = new Map();
            assetsWithCargo.forEach(({ cargoData }) => {
                if (cargoData && cargoData.items) {
                    cargoData.items.forEach(item => { const existing = totalResources.get(item.resource_name) || 0; totalResources.set(item.resource_name, existing + item.quantity); });
                }
            });
            if (totalResources.size > 0) {
                const summarySection = document.createElement('div'); summarySection.className = 'assets-summary-section'; summarySection.innerHTML = '<h3>📊 Total Resources</h3>';
                const summaryGrid = document.createElement('div'); summaryGrid.className = 'resource-summary-grid';
                totalResources.forEach((quantity, resourceName) => {
                    const resourceItem = document.createElement('div'); resourceItem.className = 'resource-summary-item';
                    resourceItem.innerHTML = `<span class="resource-name">${resourceName}</span><span class="resource-quantity">${quantity}</span>`;
                    summaryGrid.appendChild(resourceItem);
                });
                summarySection.appendChild(summaryGrid); assetsDisplay.appendChild(summarySection);
            }
            UI.showModal({ title: '📊 Player Assets', content: assetsDisplay, actions: [{ text:'Close', style:'primary', action:()=>true }], className:'player-assets-modal' });
        } catch (e) { console.error('Error showing player assets:', e); client.addLogEntry?.('Failed to load player assets', 'error'); }
}

