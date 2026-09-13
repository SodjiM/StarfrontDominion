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

    // Movement is always planned through the action system. A second click
    // naturally appends another movement action behind the current plan.
    if (game.queueReplaceMode) {
        game.queueReplaceMode = false;
        Queue.replaceMove(game, unit.id, worldX, worldY, (resp) => {
            if (resp?.success) game.addLogEntry(`Replaced future plan with Move to (${worldX}, ${worldY})`, 'info');
            else game.addLogEntry(`Failed to replace plan: ${resp?.error || 'error'}`, 'error');
        });
        return;
    }
    return queueMove(game, unit.id, worldX, worldY);
}
