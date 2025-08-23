const express = require('express');
const db = require('../db');
const router = express.Router();
const { GamesRepository } = require('../repositories/games.repo');
const gamesRepo = new GamesRepository();

// Get all games + highlight games user is in (include current turn for active games)
router.get('/games/:userId', async (req, res) => {
    const userId = req.params.userId;
    try {
        const allGames = await gamesRepo.listAllGames();
        const gameIds = await gamesRepo.listUserGameIds(userId);
        const enriched = await Promise.all((allGames || []).map(async (g) => {
            if (g.status !== 'active') return g;
            const latest = await gamesRepo.getLatestTurn(g.id);
            if (latest) {
                return { ...g, current_turn_number: latest.turn_number, current_turn_created_at: latest.created_at };
            }
            return { ...g, current_turn_number: 1, current_turn_created_at: null };
        }));
        res.json({ allGames: enriched, userGameIds: gameIds });
    } catch (e) {
        return res.status(500).json({ error: 'Failed to fetch games' });
    }
});

// Get game details including players
router.get('/game/:gameId', async (req, res) => {
    const gameId = req.params.gameId;
    try {
        const game = await gamesRepo.getGameById(gameId);
        if (!game) return res.status(404).json({ error: 'Game not found' });
        const players = await gamesRepo.listPlayersForGame(gameId);
        const latest = await gamesRepo.getLatestTurn(gameId);
        res.json({ ...game, players, current_turn_number: latest?.turn_number || null, current_turn_created_at: latest?.created_at || null });
    } catch (e) {
        return res.status(500).json({ error: 'Failed to fetch game details' });
    }
});

// Join a game
router.post('/join', async (req, res) => {
    const { userId, gameId } = req.body;
    try {
        const game = await gamesRepo.getGameById(gameId);
        if (!game) return res.status(404).json({ error: 'Game not found' });
        if (game.status !== 'recruiting') return res.status(400).json({ error: 'Game is not accepting new players' });
        await gamesRepo.addPlayerToGame(userId, gameId);
        res.json({ success: true });
    } catch (e) {
        return res.status(500).json({ error: 'Failed to join game' });
    }
});

// Leave a game
router.post('/leave', async (req, res) => {
    const { userId, gameId } = req.body;
    try {
        await gamesRepo.removePlayerFromGame(userId, gameId);
        res.json({ success: true });
    } catch (e) {
        return res.status(500).json({ error: 'Failed to leave game' });
    }
});

// Create a new game (supports auto turn interval)
router.post('/create', async (req, res) => {
    const { name, mode, creatorId, turnLockMinutes } = req.body;
    if (!name || !mode) return res.status(400).json({ error: 'Game name and mode required' });
    const autoTurn = (turnLockMinutes === null || turnLockMinutes === undefined || turnLockMinutes === 'none') ? null : parseInt(turnLockMinutes, 10);
    try {
        const { id: gameId } = await gamesRepo.createGame({ name, mode, status: 'recruiting', autoTurnMinutes: autoTurn });
        if (creatorId) await gamesRepo.addPlayerToGame(creatorId, gameId);
        res.json({ gameId, success: true });
    } catch (e) {
        return res.status(500).json({ error: 'Failed to create game' });
    }
});

// Delete a game (only creator can delete)
router.delete('/game/:gameId', async (req, res) => {
    const { gameId } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    try {
        const result = await gamesRepo.deleteGameCascadeChecked(gameId, userId);
        if (result?.notFound) return res.status(404).json({ error: 'Game not found' });
        if (result?.forbidden) return res.status(403).json({ error: 'Only the game creator can delete this game' });
        res.json({ success: true, message: `Game "${result.gameName}" deleted successfully` });
    } catch (e) {
        console.error('Error deleting game:', e);
        res.status(500).json({ error: 'Failed to delete game' });
    }
});

// Clear all games (admin)
router.delete('/games/clear-all', async (req, res) => {
    const { confirm } = req.body || {};
    if (confirm !== 'DELETE') return res.status(400).json({ error: "Confirmation string 'DELETE' required" });

    try {
        const out = await gamesRepo.clearAllGamesCascade();
        res.json(out);
    } catch (e) {
        console.error('Error clearing games:', e);
        res.status(500).json({ error: 'Failed to clear games' });
    }
});

module.exports = router;

