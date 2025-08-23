// Movement controller: orchestrates move commands and path restoration
import { calculateMovementPath, calculateETA } from '../core/Movement.js';
import * as Queue from './queue-controller.js';

export function restoreMovementPath(game, unit) {
    if (unit.type !== 'ship') return;
    if (unit.movementStatus === 'completed') {
        if (unit.movementActive) unit.movementActive = false;
        return;
    }
    if (unit.plannedDestination && unit.movementETA && !unit.movementPath && unit.movementStatus === 'active') {
        const currentPath = calculateMovementPath(
            unit.x, unit.y, unit.plannedDestination.x, unit.plannedDestination.y
        );
        if (currentPath.length > 1) {
            unit.movementPath = currentPath;
            unit.movementActive = true;
            if (unit.movementETA === undefined) {
                unit.movementETA = calculateETA(currentPath, unit.meta.movementSpeed || 1, unit, game.gameState);
            }
            game.addLogEntry(`${unit.meta.name} movement path restored (${currentPath.length - 1} tiles, ETA: ${unit.movementETA}T)`, 'info');
        } else if (unit.plannedDestination) {
            unit.plannedDestination = null; unit.movementETA = null; unit.movementActive = false;
        }
    }
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

    const path = calculateMovementPath(unit.x, unit.y, worldX, worldY);
    if (path.length <= 1) { game.addLogEntry('Invalid movement destination', 'warning'); return; }

    if (game.queueMode) {
        return queueMove(game, unit.id, worldX, worldY);
    }

    const eta = calculateETA(path, unit.meta.movementSpeed || 1, unit, game.gameState);

    // Optional: trails integration can remain in Trails feature
    // Clear existing and set new movement data
    unit.movementPath = path;
    unit.plannedDestination = { x: worldX, y: worldY };
    unit.movementETA = eta;
    unit.movementActive = true;
    unit.movementStatus = 'active';
    game.render();
    game.addLogEntry(`${unit.meta.name} ordered to move: ${path.length - 1} tiles, ETA: ${eta} turns`, 'info');

    try {
        game.socket.emit('move-ship', {
            gameId: game.gameId,
            shipId: unit.id,
            currentX: unit.x,
            currentY: unit.y,
            destinationX: worldX,
            destinationY: worldY,
            movementPath: path,
            estimatedTurns: eta
        });
    } catch {}
}


