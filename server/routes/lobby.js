const express = require('express');
const db = require('../db');
const router = express.Router();

// Get all games + highlight games user is in
router.get('/games/:userId', (req, res) => {
    const userId = req.params.userId;

    db.all('SELECT * FROM games ORDER BY created_at DESC', [], (err, allGames) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch games' });
        }
        
        db.all(
            'SELECT game_id FROM game_players WHERE user_id = ?',
            [userId],
            (err2, userGames) => {
                if (err2) {
                    return res.status(500).json({ error: 'Failed to fetch user games' });
                }
                
                const gameIds = userGames.map(g => g.game_id);
                res.json({
                    allGames,
                    userGameIds: gameIds
                });
            }
        );
    });
});

// Get game details including players
router.get('/game/:gameId', (req, res) => {
    const gameId = req.params.gameId;
    
    db.get('SELECT * FROM games WHERE id = ?', [gameId], (err, game) => {
        if (err || !game) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        db.all(
            `SELECT u.username, gp.joined_at 
             FROM game_players gp 
             JOIN users u ON gp.user_id = u.id 
             WHERE gp.game_id = ?`,
            [gameId],
            (err2, players) => {
                if (err2) {
                    return res.status(500).json({ error: 'Failed to fetch players' });
                }
                
                res.json({
                    ...game,
                    players
                });
            }
        );
    });
});

// Join a game
router.post('/join', (req, res) => {
    const { userId, gameId } = req.body;

    // First check if game exists and is joinable
    db.get('SELECT status FROM games WHERE id = ?', [gameId], (err, game) => {
        if (err || !game) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        if (game.status !== 'recruiting') {
            return res.status(400).json({ error: 'Game is not accepting new players' });
        }

        db.run(
            'INSERT OR IGNORE INTO game_players (user_id, game_id) VALUES (?, ?)',
            [userId, gameId],
            function (err) {
                if (err) return res.status(500).json({ error: 'Failed to join game' });
                res.json({ success: true });
            }
        );
    });
});

// Leave a game
router.post('/leave', (req, res) => {
    const { userId, gameId } = req.body;

    db.run(
        'DELETE FROM game_players WHERE user_id = ? AND game_id = ?',
        [userId, gameId],
        function (err) {
            if (err) return res.status(500).json({ error: 'Failed to leave game' });
            res.json({ success: true });
        }
    );
});

// Create a new game
router.post('/create', (req, res) => {
    const { name, mode, creatorId } = req.body;
    
    if (!name || !mode) {
        return res.status(400).json({ error: 'Game name and mode required' });
    }
    
    db.run(
        'INSERT INTO games (name, mode, status) VALUES (?, ?, ?)',
        [name, mode, 'recruiting'],
        function (err) {
            if (err) return res.status(500).json({ error: 'Failed to create game' });
            
            const gameId = this.lastID;
            
            // Auto-join creator to the game
            if (creatorId) {
                db.run(
                    'INSERT INTO game_players (user_id, game_id) VALUES (?, ?)',
                    [creatorId, gameId]
                );
            }
            
            res.json({ gameId, success: true });
        }
    );
});

module.exports = router; 