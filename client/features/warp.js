import { physicalScale } from '../utils/physical-geometry.js';
// Warp Controller - ESM version (no globals)

export function showWarpConfirmation(client, target) {
    client.__plannerTarget = target ? {x:target.x,y:target.y} : null;
    return import('../ui/map-modal.js').then(m=>m.openMapModal());
}
export function executeWarpOrder(client,target) { showWarpConfirmation(client,target); return true; }
export function enterWarpMode(client) { return showWarpConfirmation(client); }

export function exitWarpMode(client) {
        if (!client || !client.canvas) return;
        client.warpMode = false;
        client.warpTargets = [];
        client.canvas.style.cursor = 'default';
        client.render && client.render();
}

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

export function drawWarpTargetHighlight(game, ctx, x, y, size) {
        const time = Date.now() / 1000;
        const pulse = 0.5 + 0.5 * Math.sin(time * 4);
        ctx.strokeStyle = `rgba(138, 43, 226, ${pulse * 0.8})`;
        ctx.lineWidth = Math.max(3, size * 0.02);
        ctx.setLineDash([10, 5]);
        ctx.beginPath();
        ctx.arc(x, y, size/2 + 15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255, 255, 255, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.arc(x, y, size/2 + 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (size > game.tileSize) {
            ctx.fillStyle = `rgba(255, 255, 255, ${pulse})`;
            ctx.font = `${Math.max(12, game.tileSize * 0.3)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🌌', x, y - size/2 - 20);
        }
}

export function drawWarpPreparationEffect(game, ctx, ship, x, y, size) {
        const time = Date.now() / 1000;
        const phase = ship.warpPhase;
        const preparationTurns = ship.warpPreparationTurns || 0;
        const maxPrepTurns = (ship.meta && Number(ship.meta.warpPreparationTurns)) || 2;
        if (phase === 'preparing') {
            const intensity = Math.min(1.0, maxPrepTurns ? (preparationTurns / maxPrepTurns) : 1);
            const pulse = 0.3 + 0.7 * Math.sin(time * 6) * intensity;
            ctx.strokeStyle = `rgba(0, 191, 255, ${pulse})`;
            ctx.lineWidth = 3;
            for (let i = 0; i < 3; i++) {
                const ringSize = size/2 + 10 + (i * 8) + (Math.sin(time * 3 + i) * 5);
                ctx.beginPath();
                ctx.arc(x, y, ringSize, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.shadowColor = '#00BFFF';
            ctx.shadowBlur = 20 * intensity;
            ctx.fillStyle = `rgba(0, 191, 255, ${pulse * 0.3})`;
            ctx.beginPath();
            ctx.arc(x, y, size/2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#FFFFFF';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(`Charging ${preparationTurns}/${maxPrepTurns}`, x, y + size/2 + 5);
        } else if (phase === 'ready') {
            ctx.shadowColor = '#FFFFFF';
            ctx.shadowBlur = 25;
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(x, y, size/2 + 12, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('WARP READY', x, y + size/2 + 5);
        }
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
            return physicalScale.adjacent(obj,ship);
        });
        return adjacentGates.length > 0;
}

export function getAdjacentInterstellarGates(client, ship) {
        if (!ship || !client.objects) return [];
        return client.objects.filter(obj => {
            if (obj.type !== 'interstellar-gate') return false;
            const dx = Math.abs(obj.x - ship.x);
            const dy = Math.abs(obj.y - ship.y);
            return physicalScale.adjacent(obj,ship);
        });
}

export function travelThroughInterstellarGate(client) {
        const ship = client.selectedUnit; if (!ship) return false;
        const gates = getAdjacentInterstellarGates(client, ship);
        if (gates.length === 0) { client.addLogEntry('No adjacent interstellar gate', 'warning'); return false; }
        const gate = gates[0];
        client.socket.emit('interstellar:travel', {
            gameId: client.gameId,
            shipId: ship.id,
            gateId: gate.id,
            userId: client.userId
        });
        client.addLogEntry(`${ship.meta.name} traveling through interstellar gate...`, 'success');
        return true;
}


