// Mining Feature Module (ESM-ready)

function bindUI() {
        const byId = (id) => document.getElementById(id);
        const safe = (el, fn) => { if (el) el.addEventListener('click', fn); };
        // Zoom and map controls are bound in GameClient; nothing here yet
}

    export async function toggleMining() {
        const client = window.gameClient;
        if (!client || !client.selectedUnit) { client?.addLogEntry('No ship selected', 'warning'); return; }
        const ship = client.selectedUnit;
        if (ship.harvestingStatus === 'active') {
            client.socket.emit('stop-harvesting', { gameId: client.gameId, shipId: ship.id });
        } else {
            await showResourceSelection(ship.id);
        }
    }

    export async function showResourceSelection(shipId) {
        const client = window.gameClient;
        try {
            const data = await SFApi.Resources.listNearbyNodes(client.gameId, shipId, client.userId);
            if (data.resourceNodes.length === 0) { client.addLogEntry('No mineable resources nearby. Move closer to asteroid rocks, gas clouds, or other resources.', 'warning'); return; }
            const resourceList = document.createElement('div'); resourceList.className = 'resource-selection-list';
            const header = document.createElement('div'); header.innerHTML = `<h3>⛏️ Select Resource to Mine</h3><p>Choose which resource node to harvest:</p>`; resourceList.appendChild(header);
            data.resourceNodes.forEach(node => {
                const resourceOption = document.createElement('div'); resourceOption.className = 'resource-option';
                resourceOption.innerHTML = `
                    <div class="resource-info">
                        <div class="resource-name">${node.icon_emoji} ${node.resource_name}</div>
                        <div class="resource-details"><span class="resource-amount">${node.resource_amount} available</span><span class="resource-distance">${node.distance} tile${node.distance !== 1 ? 's' : ''} away</span></div>
                    </div>
                    <div class="resource-action"><button class="mine-select-btn">Mine</button></div>`;
                resourceOption.querySelector('.mine-select-btn').addEventListener('click', () => { startMining(shipId, node.id, node.resource_name); UI.closeModal(); });
                resourceList.appendChild(resourceOption);
            });
            UI.showModal({ title: '⛏️ Mining Target Selection', content: resourceList, actions: [{ text: 'Cancel', style: 'secondary', action: () => true }], className: 'resource-selection-modal' });
        } catch (error) {
            console.error('Error getting resource nodes:', error);
            client.addLogEntry('Failed to get nearby resources', 'error');
        }
    }

    export function startMining(shipId, resourceNodeId, resourceName) {
        const client = window.gameClient;
        if (client.queueMode) {
            client.socket.emit('queue-order', { gameId: client.gameId, shipId, orderType: 'harvest_start', payload: { nodeId: resourceNodeId } }, (resp) => {
                if (resp && resp.success) client.addLogEntry(`Queued: Start mining ${resourceName}`, 'info');
                else client.addLogEntry(`Failed to queue mining: ${resp?.error || 'error'}`, 'error');
            });
        } else {
            client.socket.emit('start-harvesting', { gameId: client.gameId, shipId, resourceNodeId });
            client.addLogEntry(`Starting to mine ${resourceName}...`, 'info');
        }
    }

bindUI();



