// Turn lock/unlock service

export function toggle(game) {
    if (!game?.gameState?.playerSetup?.setup_completed) {
        game.addLogEntry('Complete system setup before locking turn', 'warning');
        UI.showAlert && UI.showAlert('Please complete your system setup first!');
        return;
    }
    const currentTurn = game.gameState?.currentTurn?.turn_number || 1;
    if (!game.socket) return;
    if (game.turnLocked) {
        game.socket.emit('unlock-turn', game.gameId, game.userId, currentTurn);
        game.addLogEntry(`Turn ${currentTurn} unlocked`, 'info');
    } else {
        game.socket.emit('lock-turn', game.gameId, game.userId, currentTurn);
        game.addLogEntry(`Turn ${currentTurn} locked`, 'success');
    }
}


