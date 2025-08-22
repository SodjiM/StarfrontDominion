// Cargo & Transfer Feature Module (ESM-ready)

function bindUI() {
        const byId = (id) => document.getElementById(id);
        const safe = (el, fn) => { if (el) el.addEventListener('click', fn); };
        safe(byId('chatSendBtn'), () => { try { if (typeof sendChat === 'function') sendChat(); } catch {} });
}

    export async function showCargo() {
        const client = window.gameClient; if (!client || !client.selectedUnit) { client?.addLogEntry('No unit selected', 'warning'); return; }
        const selectedUnit = client.selectedUnit; const unitType = selectedUnit.type === 'ship' ? 'Ship' : 'Structure';
        try {
            const data = await SFApi.Cargo.getCargo(selectedUnit.id, client.userId);
            const cargo = data.cargo;
            const adjacentObjects = client.gameState.objects.filter(obj => {
                if (obj.id === selectedUnit.id) return false;
                const dx = Math.abs(obj.x - selectedUnit.x); const dy = Math.abs(obj.y - selectedUnit.y);
                if (!(dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0))) return false;
                if (obj.owner_id === client.userId) return true;
                try { const m = obj.meta || {}; return !!m.publicAccess; } catch { return false; }
            });
            const cargoDisplay = document.createElement('div'); cargoDisplay.className = 'cargo-display';
            const header = document.createElement('div'); header.innerHTML = `
                <h3>📦 ${unitType} Cargo</h3>
                <div class="cargo-summary">
                    <div class="capacity-bar">
                        <div class="capacity-fill" style="width: ${(cargo.spaceUsed / cargo.capacity) * 100}%"></div>
                        <span class="capacity-text">${cargo.spaceUsed}/${cargo.capacity} units</span>
                    </div>
                </div>
            `; cargoDisplay.appendChild(header);
            if (adjacentObjects.length > 0) {
                const transferSection = document.createElement('div'); transferSection.className = 'transfer-section';
                transferSection.innerHTML = `<h4>🔄 Transfer Options</h4><p>Adjacent units available for resource transfer:</p>`;
                adjacentObjects.forEach(obj => {
                    const btn = document.createElement('button');
                    btn.className = 'transfer-target-btn';
                    btn.innerHTML = `${client.getUnitIcon(obj.type)} ${obj.meta.name || obj.type} (${obj.x}, ${obj.y})`;
                    btn.dataset.action = 'open-transfer';
                    btn.dataset.fromId = String(selectedUnit.id);
                    btn.dataset.toId = String(obj.id);
                    btn.dataset.toName = obj.meta.name || obj.type;
                    transferSection.appendChild(btn);
                });
                cargoDisplay.appendChild(transferSection);
            }
            if (cargo.items.length === 0) {
                const emptyMessage = document.createElement('div'); emptyMessage.className = 'cargo-empty'; emptyMessage.innerHTML = '<p>🚫 Cargo hold is empty</p>'; cargoDisplay.appendChild(emptyMessage);
            } else {
                cargo.items.forEach(item => {
                    const cargoItem = document.createElement('div'); cargoItem.className = 'cargo-item';
                    const isDeployable = item.category === 'structure' && selectedUnit.type === 'ship';
                    cargoItem.innerHTML = `
                        <div class="cargo-item-info">
                            <span class="cargo-icon" style="color: ${item.color_hex}">${item.icon_emoji}</span>
                            <div class="cargo-details">
                                <div class="cargo-name">${item.resource_name}</div>
                                <div class="cargo-stats">${item.quantity} units (${item.quantity * item.base_size} space)</div>
                            </div>
                        </div>
                        <div class="cargo-actions">
                            <div class="cargo-value">Value: ${item.quantity * (item.base_value || 1)}</div>
                            ${isDeployable ? `<button class="deploy-btn" data-action="deploy-structure" data-resource="${item.resource_name}" data-ship-id="${selectedUnit.id}">🚀 Deploy</button>` : ''}
                        </div>`;
                    cargoDisplay.appendChild(cargoItem);
                });
            }
            // Delegate actions inside cargo modal
            cargoDisplay.addEventListener('click', (e) => {
                const deployBtn = e.target.closest('[data-action="deploy-structure"]');
                if (deployBtn) {
                    const res = deployBtn.dataset.resource;
                    const shipId = Number(deployBtn.dataset.shipId);
                    try { deployStructure(res, shipId); } catch {}
                    return;
                }
                const openBtn = e.target.closest('[data-action="open-transfer"]');
                if (openBtn) {
                    const fromId = Number(openBtn.dataset.fromId);
                    const toId = Number(openBtn.dataset.toId);
                    const toName = openBtn.dataset.toName || 'Target';
                    showTransferModal(fromId, toId, toName);
                    return;
                }
            });
            UI.showModal({ title: `📦 ${unitType} Cargo`, content: cargoDisplay, actions: [{ text:'Close', style:'primary', action: ()=>true }], className: 'cargo-modal' });
        } catch (error) { console.error('Error getting cargo:', error); client.addLogEntry('Failed to get cargo information', 'error'); }
    }

    export async function showTransferModal(fromObjectId, toObjectId, toObjectName) {
        const client = window.gameClient;
        try {
            const [fromData, toData] = await Promise.all([
                SFApi.Cargo.getCargo(fromObjectId, client.userId),
                SFApi.Cargo.getCargo(toObjectId, client.userId)
            ]);
            const fromCargo = fromData.cargo; const toCargo = toData.cargo;
            const transferDisplay = document.createElement('div'); transferDisplay.className = 'transfer-display';
            const header = document.createElement('div'); header.innerHTML = `<h3>🔄 Transfer Resources</h3><p>Between selected object and: <strong>${toObjectName}</strong></p>`; transferDisplay.appendChild(header);
            const toTitle = document.createElement('h4'); toTitle.textContent = `Send to ${toObjectName}`; transferDisplay.appendChild(toTitle);
            fromCargo.items.forEach(item => {
                const transferItem = document.createElement('div'); transferItem.className = 'transfer-item';
                const inputId = `transfer-${item.resource_name}`;
                transferItem.innerHTML = `
                    <div class="transfer-item-info"><span class="cargo-icon" style="color: ${item.color_hex}">${item.icon_emoji}</span>
                    <div class="transfer-details"><div class="transfer-name">${item.resource_name}</div><div class="transfer-available">Available: ${item.quantity} units</div></div></div>
                    <div class="transfer-controls"><input type="number" class="transfer-quantity" min="1" max="${item.quantity}" value="1" id="${inputId}">
                    <button class="transfer-btn" data-action="transfer" data-from-id="${fromObjectId}" data-to-id="${toObjectId}" data-resource="${item.resource_name}" data-input-id="${inputId}" data-to-name="${toObjectName}">Transfer</button></div>`;
                transferDisplay.appendChild(transferItem);
            });
            if (toCargo.items && toCargo.items.length > 0) {
                const fromTitle = document.createElement('h4'); fromTitle.textContent = `Take from ${toObjectName}`; transferDisplay.appendChild(fromTitle);
                toCargo.items.forEach(item => {
                    const transferItem = document.createElement('div'); transferItem.className = 'transfer-item';
                    const inputId = `transfer-from-${item.resource_name}`;
                    transferItem.innerHTML = `
                        <div class="transfer-item-info"><span class="cargo-icon" style="color: ${item.color_hex}">${item.icon_emoji}</span>
                        <div class="transfer-details"><div class="transfer-name">${item.resource_name}</div><div class="transfer-available">Available: ${item.quantity} units</div></div></div>
                        <div class="transfer-controls"><input type="number" class="transfer-quantity" min="1" max="${item.quantity}" value="1" id="${inputId}">
                        <button class="transfer-btn" data-action="transfer" data-from-id="${toObjectId}" data-to-id="${fromObjectId}" data-resource="${item.resource_name}" data-input-id="${inputId}" data-to-name="Selected">Transfer</button></div>`;
                    transferDisplay.appendChild(transferItem);
                });
            }
            // Delegate transfer actions
            transferDisplay.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-action="transfer"]');
                if (!btn) return;
                const fromId = Number(btn.dataset.fromId);
                const toId = Number(btn.dataset.toId);
                const res = btn.dataset.resource;
                const inputId = btn.dataset.inputId;
                const toName = btn.dataset.toName || 'Target';
                const qty = document.getElementById(inputId)?.value;
                performTransfer(fromId, toId, res, qty, toName);
            });
            UI.showModal({ title:'🔄 Transfer Resources', content: transferDisplay, actions:[{ text:'Cancel', style:'secondary', action:()=>true }], className:'transfer-modal' });
        } catch (error) { console.error('Error showing transfer modal:', error); client.addLogEntry('Failed to show transfer options', 'error'); }
    }

    export async function performTransfer(fromObjectId, toObjectId, resourceName, quantity, toObjectName) {
        const client = window.gameClient; const transferQuantity = parseInt(quantity);
        if (!transferQuantity || transferQuantity <= 0) { client.addLogEntry('Invalid transfer quantity', 'warning'); return; }
        try {
            const result = await SFApi.Cargo.transfer(parseInt(fromObjectId), parseInt(toObjectId), resourceName, transferQuantity, client.userId);
            if (result && result.success) {
                client.addLogEntry(`Successfully transferred ${transferQuantity} ${resourceName} to ${toObjectName}`, 'success');
                UI.closeModal();
                if (client.selectedUnit && client.selectedUnit.id === fromObjectId) { setTimeout(() => showCargo(), 100); }
            } else { client.addLogEntry(result?.error || 'Transfer failed', 'error'); }
        } catch (error) { console.error('Error performing transfer:', error); client.addLogEntry(error?.data?.error || 'Failed to transfer resources', 'error'); }
    }

    export async function updateCargoStatus(shipId) {
        const client = window.gameClient;
        try {
            const data = await SFApi.Cargo.getCargo(shipId, client.userId);
            if (data) {
                const cargoElement = document.getElementById('cargoStatus');
                if (cargoElement) {
                    const cargo = data.cargo; const percentFull = Math.round((cargo.spaceUsed / cargo.capacity) * 100);
                    cargoElement.innerHTML = `${cargo.spaceUsed}/${cargo.capacity} (${percentFull}%)`;
                    cargoElement.style.color = percentFull >= 90 ? '#FF5722' : percentFull >= 70 ? '#FF9800' : '#4CAF50';
                }
            }
        } catch (error) { console.error('Error updating cargo status:', error); }
    }

bindUI();


