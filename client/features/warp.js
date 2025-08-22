// Warp Controller - ESM version (no globals)

export function showWarpConfirmation(client, target) {
        const distance = Math.sqrt(
            Math.pow(client.selectedUnit.x - target.x, 2) + 
            Math.pow(client.selectedUnit.y - target.y, 2)
        );
        const modalContent = document.createElement('div');
        const requiredPrep = (client.selectedUnit?.meta && typeof client.selectedUnit.meta.warpPreparationTurns === 'number')
            ? client.selectedUnit.meta.warpPreparationTurns
            : 2;
        modalContent.innerHTML = `
            <div class="warp-confirmation">
                <h3>🌌 Warp Jump Confirmation</h3>
                <div class="warp-info">
                    <p><strong>Ship:</strong> ${client.selectedUnit.meta.name}</p>
                    <p><strong>Destination:</strong> ${target.meta.name || target.type}</p>
                    <p><strong>Distance:</strong> ${Math.round(distance)} tiles</p>
                    <p><strong>Preparation Time:</strong> ${requiredPrep} turn${requiredPrep === 1 ? '' : 's'}</p>
                    <p><strong>Jump Time:</strong> Instant</p>
                </div>
                <div class="warp-warning">⚠️ Warp preparation cannot be interrupted once started</div>
            </div>
        `;
        window.UI.showModal({
            title: '🌌 Warp Jump',
            content: modalContent,
            actions: [
                { text: 'Cancel', style: 'secondary', action: () => true },
                { text: 'Engage Warp Drive', style: 'primary', action: () => executeWarpOrder(client, target) }
            ]
        });
}

export function executeWarpOrder(client, target) {
        if (client.queueMode) {
            client.socket.emit('queue-order', {
                gameId: client.gameId,
                shipId: client.selectedUnit.id,
                orderType: 'warp',
                payload: { targetId: target.id, destination: { x: target.x, y: target.y }, targetName: target.meta.name }
            }, (resp) => {
                if (resp && resp.success) client.addLogEntry(`Queued: Warp to ${target.meta.name}`, 'success');
                else client.addLogEntry(`Failed to queue warp: ${resp?.error || 'error'}`, 'error');
            });
            return true;
        } else {
            client.socket.emit('warp-ship', {
                gameId: client.gameId,
                shipId: client.selectedUnit.id,
                targetId: target.id,
                targetX: target.x,
                targetY: target.y,
                shipName: client.selectedUnit.meta.name,
                targetName: target.meta.name
            });
            client.addLogEntry(`${client.selectedUnit.meta.name} engaging warp drive. Target: ${target.meta.name}`, 'success');
            return true;
        }
}

export function enterWarpMode(client) { showWarpTargetSelection(client); }

export function showWarpTargetSelection(client) {
        const ship = client.selectedUnit; if (!ship) return;
        const warpTargets = getWarpTargets(client, ship);
        if (warpTargets.length === 0) { client.addLogEntry('No warp targets available in this sector', 'warning'); return; }
        const targetList = document.createElement('div'); targetList.className = 'warp-target-list';
        const header = document.createElement('div'); header.className = 'warp-target-header';
        header.innerHTML = `
            <h3>🌌 Select Warp Destination</h3>
            <p>Choose where ${ship.meta.name} should warp to:</p>
        `;
        targetList.appendChild(header);
        warpTargets.forEach(target => {
            const option = document.createElement('div'); option.className = 'warp-target-option';
            const distance = Math.sqrt(Math.pow(ship.x - target.x, 2) + Math.pow(ship.y - target.y, 2));
            const targetIcon = getWarpTargetIcon(target);
            const targetType = getWarpTargetType(client, target);
            option.innerHTML = `
                <div class="warp-target-info">
                    <div class="warp-target-name">${targetIcon} ${target.meta.name || target.type}</div>
                    <div class="warp-target-details">
                        <span class="warp-target-type">${targetType}</span>
                        <span class="warp-target-distance">${Math.round(distance)} tiles away</span>
                    </div>
                </div>
                <div class="warp-target-action"><button class="warp-select-btn">Select</button></div>
            `;
            option.querySelector('.warp-select-btn').addEventListener('click', () => { showWarpConfirmation(client, target); });
            targetList.appendChild(option);
        });
        window.UI.showModal({ title: '🌌 Warp Target Selection', content: targetList, actions: [{ text:'Cancel', style:'secondary', action: ()=>{ client.addLogEntry('Warp target selection cancelled', 'info'); return true; } }], className:'warp-target-modal' });
}

export function getWarpTargets(client, ship) {
        const targets = [];
        const celestialObjects = client.objects.filter(obj => client.isCelestialObject(obj));
        targets.push(...celestialObjects);
        const playerStructures = client.objects.filter(obj => obj.owner_id === client.userId && (obj.type === 'station') && obj.id !== ship.id);
        targets.push(...playerStructures);
        const warpBeacons = client.objects.filter(obj => obj.type === 'warp-beacon' && (obj.owner_id === client.userId || obj.meta?.publicAccess === true));
        targets.push(...warpBeacons);
        const interstellarGates = client.objects.filter(obj => obj.type === 'interstellar-gate' && (obj.owner_id === client.userId || obj.meta?.publicAccess === true));
        targets.push(...interstellarGates);
        targets.sort((a, b) => Math.hypot(ship.x - a.x, ship.y - a.y) - Math.hypot(ship.x - b.x, ship.y - b.y));
        return targets;
}

export function getWarpTargetIcon(target) {
        if (target.celestial_type) {
            switch (target.celestial_type) {
                case 'star': return '⭐'; case 'planet': return '🪐'; case 'moon': return '🌙'; case 'belt': return '☄️'; case 'nebula': return '🌌'; case 'wormhole': return '🕳️'; case 'derelict': return '🛸'; default: return '🌟';
            }
        } else {
            switch (target.type) {
                case 'station': return '🏭';
                case 'warp-beacon': return '🌌';
                case 'storage-structure': return '📦';
                case 'interstellar-gate': return '🌀';
                default: return '🏗️';
            }
        }
}

export function getWarpTargetType(client, target) {
        if (target.celestial_type) {
            switch (target.celestial_type) {
                case 'star': return 'Star System'; case 'planet': return 'Planet'; case 'moon': return 'Moon'; case 'belt': return 'Asteroid Belt'; case 'nebula': return 'Nebula'; case 'wormhole': return 'Wormhole'; case 'derelict': return 'Derelict'; default: return 'Celestial Object';
            }
        } else {
            if (target.owner_id === client.userId) {
                switch (target.type) {
                    case 'station': return 'Your Station';
                    case 'warp-beacon': return 'Your Warp Beacon';
                    case 'storage-structure': return 'Your Storage';
                    case 'interstellar-gate': return 'Your Interstellar Gate';
                    default: return 'Your Structure';
                }
            } else if (target.type === 'warp-beacon' && target.meta?.publicAccess === true) {
                return 'Public Warp Beacon';
            } else if (target.type === 'interstellar-gate' && target.meta?.publicAccess === true) {
                return `Gate to ${target.meta?.destinationSectorName || 'Unknown Sector'}`;
            } else {
                return 'Allied Structure';
            }
        }
}

export function isAdjacentToInterstellarGate(client, ship) {
        if (!ship || !client.objects) return false;
        const adjacentGates = client.objects.filter(obj => {
            if (obj.type !== 'interstellar-gate') return false;
            const dx = Math.abs(obj.x - ship.x);
            const dy = Math.abs(obj.y - ship.y);
            return dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0);
        });
        return adjacentGates.length > 0;
}

export function getAdjacentInterstellarGates(client, ship) {
        if (!ship || !client.objects) return [];
        return client.objects.filter(obj => {
            if (obj.type !== 'interstellar-gate') return false;
            const dx = Math.abs(obj.x - ship.x);
            const dy = Math.abs(obj.y - ship.y);
            return dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0);
        });
}


