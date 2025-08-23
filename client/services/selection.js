// Selection persistence and movement status bookkeeping

export function applySelectionPersistence(game, playerObjects) {
    if (game.selectedObjectId) {
        const previouslySelected = playerObjects.find(obj => obj.id === game.selectedObjectId);
        if (previouslySelected) {
            const oldPosition = game.selectedUnit ? { x: game.selectedUnit.x, y: game.selectedUnit.y } : null;
            game.selectedUnit = previouslySelected;
            if (oldPosition && (oldPosition.x !== previouslySelected.x || oldPosition.y !== previouslySelected.y)) {
                // keep camera position; logging kept in game
            }
            document.querySelectorAll('.unit-item').forEach(item => item.classList.remove('selected'));
            const unitElement = document.getElementById(`unit-${game.selectedObjectId}`);
            if (unitElement) unitElement.classList.add('selected');
            game.updateUnitDetails && game.updateUnitDetails();
        } else {
            game.selectedUnit = null; game.selectedObjectId = null;
        }
    } else if (!game.selectedUnit && game.units.length > 0 && game.isFirstLoad) {
        game.selectUnit(game.units[0].id);
        game.isFirstLoad = false;
    }
}

export function updatePreviousMovementStatuses(game) {
    game.previousMovementStatuses.clear();
    (game.objects||[]).forEach(ship => { if (ship.type === 'ship' && ship.movementStatus) game.previousMovementStatuses.set(ship.id, ship.movementStatus); });
}


