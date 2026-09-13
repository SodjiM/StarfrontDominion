// Movement controller: orchestrates move commands and path restoration
import * as Queue from './queue-controller.js';

export function restoreMovementPath(game, unit) {
    if (unit.type !== 'ship') return;
    if (unit.movementStatus === 'completed') {
        if (unit.movementActive) unit.movementActive = false;
        return;
    }
    // Movement paths come from the server's authoritative state. Never rebuild
    // a path locally: the client lacks the authoritative obstacle set and
    // would show a route that may differ from the one actually executed.
    unit.movementActive = unit.movementStatus === 'active' && Array.isArray(unit.movementPath) && unit.movementPath.length > 1;
}

export function queueMove(game, shipId, x, y) {
    Queue.addMove(game, shipId, x, y, (resp) => {
        if (resp && resp.success) game.addLogEntry(`Queued: Move to (${x}, ${y})`, 'info');
        else game.addLogEntry(`Failed to queue move: ${resp?.error || 'error'}`, 'error');
    });
}

export function handleMoveCommand(game, worldX, worldY) {
    const unit = game.selectedUnit;
    if (!unit || unit.type !== 'ship') { game.addLogEntry('Only ships can be moved', 'warning'); return; }

    if (!Number.isInteger(worldX) || !Number.isInteger(worldY)) { game.addLogEntry('Invalid movement destination', 'warning'); return; }

    if (game.queueMode) {
        return queueMove(game, unit.id, worldX, worldY);
    }

    game.socket.emit('move-ship', {
        gameId: game.gameId, shipId: unit.id, destinationX: worldX, destinationY: worldY
    }, (result)=>{
        if(!result?.success){game.addLogEntry(result?.error || 'Movement request failed','error');return;}
        unit.movementPath=result.movementPath;
        unit.plannedDestination={x:result.destinationX,y:result.destinationY};
        unit.movementETA=result.estimatedTurns;unit.movementActive=true;unit.movementStatus='active';
        game.render();game.addLogEntry(`Movement confirmed, ETA: ${result.estimatedTurns} turns`,'success');
    });
}
