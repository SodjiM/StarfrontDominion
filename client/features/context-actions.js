// Right-click context actions for the map

export function onRightClick(game, worldX, worldY) {
    if (!game?.selectedUnit || game.turnLocked || game.selectedUnit.type !== 'ship') return;
    const clickedObject = game.objects.find(obj => {
        if (game.isCelestialObject && game.isCelestialObject(obj) && obj.radius > 50) return false;
        const distance = Math.hypot(obj.x - worldX, obj.y - worldY);
        const baseRadius = (obj.radius || 1);
        const hitRadius = obj.type === 'resource_node' ? Math.max(0.4, baseRadius * 0.5) : Math.max(0.5, baseRadius * 0.8);
        return distance <= hitRadius;
    });

    if (clickedObject && clickedObject.type === 'resource_node') {
        const target = clickedObject;
        const adj = game.getAdjacentTileNear(target.x, target.y, game.selectedUnit.x, game.selectedUnit.y);
        if (adj) {
            if (game.queueMode) {
                try { const mod = require('./queue-controller.js'); mod.addMove(game, game.selectedUnit.id, adj.x, adj.y, () => {}); mod.addHarvestStart(game, game.selectedUnit.id, target.id, () => {}); }
                catch { import('./queue-controller.js').then(mod => { mod.addMove(game, game.selectedUnit.id, adj.x, adj.y, () => {}); mod.addHarvestStart(game, game.selectedUnit.id, target.id, () => {}); }); }
                game.addLogEntry(`Queued: Move next to and mine ${target.meta?.resourceType || 'resource'}`, 'info');
            } else {
                game.handleMoveCommand(adj.x, adj.y);
            }
        } else {
            game.handleMoveCommand(worldX, worldY);
        }
        return;
    }

    if (!clickedObject) { game.handleMoveCommand(worldX, worldY); return; }
    if (clickedObject.owner_id === game.userId) { game.selectUnit(clickedObject.id); game.addLogEntry(`Selected ${clickedObject.meta?.name || clickedObject.type}`, 'info'); }
    else { game.addLogEntry('Use an ability to target enemies', 'info'); }
}


