// State service: fetching and normalizing game state, plus post-load orchestration
import { normalizeGameState } from '../core/GameState.js';

export async function loadGameState(game) {
    try {
        const sectorId = game.selectedUnit?.sectorInfo?.id;
        const data = await SFApi.State.gameState(game.gameId, game.userId, sectorId);
        if (!data) return null;
        const preserveCamera = { x: game.camera.x, y: game.camera.y };
        game.gameState = normalizeGameState(data);
        await game.updateUI();
        game.camera.x = preserveCamera.x; game.camera.y = preserveCamera.y;
        game.render();
        return game.gameState;
    } catch (error) {
        console.error('Failed to load game state:', error);
        game.addLogEntry('Failed to connect to game server', 'error');
        return null;
    }
}


