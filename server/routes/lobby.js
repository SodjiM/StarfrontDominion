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

// Delete a game (only creator can delete)
router.delete('/game/:gameId', (req, res) => {
    const { gameId } = req.params;
    const { userId } = req.body;
    
    if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
    }
    
    // First check if game exists and if user is the creator (first player to join)
    db.get(
        `SELECT g.*, MIN(gp.joined_at) as first_join, 
                (SELECT user_id FROM game_players WHERE game_id = ? ORDER BY joined_at ASC LIMIT 1) as creator_id
         FROM games g 
         LEFT JOIN game_players gp ON g.id = gp.game_id 
         WHERE g.id = ?`,
        [gameId, gameId],
        (err, game) => {
            if (err) {
                console.error('Error checking game:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!game) {
                return res.status(404).json({ error: 'Game not found' });
            }
            
            // Only the creator (first player to join) can delete the game
            if (game.creator_id != userId) {
                return res.status(403).json({ error: 'Only the game creator can delete this game' });
            }
            
            console.log(`🗑️ User ${userId} requesting to delete game ${gameId} (${game.name})`);
            
            // Delete in order to maintain referential integrity
            // 1. Delete movement orders first
            db.run(
                `DELETE FROM movement_orders WHERE object_id IN (
                    SELECT so.id FROM sector_objects so 
                    JOIN sectors s ON so.sector_id = s.id 
                    WHERE s.game_id = ?
                )`,
                [gameId],
                (err) => {
                    if (err) console.error('Error deleting movement orders:', err);
                    
                    // 2. Delete visibility memory
                    db.run(
                        'DELETE FROM object_visibility WHERE game_id = ?',
                        [gameId],
                        (err) => {
                            if (err) console.error('Error deleting visibility memory:', err);
                            
                             // 2b. Delete legacy tile visibility if present
                             db.run(
                                 'DELETE FROM player_visibility WHERE game_id = ?',
                                 [gameId],
                                 (err) => {
                                     if (err) console.error('Error deleting legacy player_visibility:', err);
                                     
                            // 3. Delete harvesting tasks
                            db.run(
                                `DELETE FROM harvesting_tasks WHERE ship_id IN (
                                    SELECT so.id FROM sector_objects so 
                                    JOIN sectors s ON so.sector_id = s.id 
                                    WHERE s.game_id = ?
                                )`,
                                [gameId],
                                (err) => {
                                    if (err) console.error('Error deleting harvesting tasks:', err);
                                    
                                    // 4. Delete movement history
                                    db.run(
                                        `DELETE FROM movement_history WHERE object_id IN (
                                            SELECT so.id FROM sector_objects so 
                                            JOIN sectors s ON so.sector_id = s.id 
                                            WHERE s.game_id = ?
                                        )`,
                                        [gameId],
                                        (err) => {
                                            if (err) console.error('Error deleting movement history:', err);
                                            
                                            // 5. Delete cargo (object and ship)
                                            db.run(
                                                `DELETE FROM object_cargo WHERE object_id IN (
                                                    SELECT so.id FROM sector_objects so 
                                                    JOIN sectors s ON so.sector_id = s.id 
                                                    WHERE s.game_id = ?
                                                )`,
                                                [gameId],
                                                (err) => {
                                                    if (err) console.error('Error deleting object cargo:', err);
                                                    db.run(
                                                        `DELETE FROM ship_cargo WHERE ship_id IN (
                                                            SELECT so.id FROM sector_objects so 
                                                            JOIN sectors s ON so.sector_id = s.id 
                                                            WHERE s.game_id = ?
                                                        )`,
                                                        [gameId],
                                                        (err) => {
                                                            if (err) console.error('Error deleting ship cargo:', err);
                                                            
                                                            // 6. Delete resource nodes
                                                            db.run(
                                                                `DELETE FROM resource_nodes WHERE sector_id IN (
                                                                    SELECT id FROM sectors WHERE game_id = ?
                                                                ) OR parent_object_id IN (
                                                                    SELECT so.id FROM sector_objects so 
                                                                    JOIN sectors s ON so.sector_id = s.id 
                                                                    WHERE s.game_id = ?
                                                                )`,
                                                                [gameId, gameId],
                                                                (err) => {
                                                                    if (err) console.error('Error deleting resource nodes:', err);
                                                                    
                                                                    // 7. Delete sector objects
                                                                    db.run(
                                                                        `DELETE FROM sector_objects WHERE sector_id IN (
                                                                            SELECT id FROM sectors WHERE game_id = ?
                                                                        )`,
                                                                        [gameId],
                                                                        (err) => {
                                                                            if (err) console.error('Error deleting sector objects:', err);
                                                                            
                                                                            // 7b. Delete generation history rows for these sectors
                                                                            db.run(
                                                                                `DELETE FROM generation_history WHERE sector_id IN (
                                                                                    SELECT id FROM sectors WHERE game_id = ?
                                                                                )`,
                                                                                [gameId],
                                                                                (err) => {
                                                                                    if (err) console.error('Error deleting generation history:', err);
                                                                                    
                                                                                    // 8. Delete turn locks (before sectors if FKs reference game)
                                                                                    db.run(
                                                                                        'DELETE FROM turn_locks WHERE game_id = ?',
                                                                                        [gameId],
                                                                                        (err) => {
                                                                                            if (err) console.error('Error deleting turn locks:', err);
                                                                                            
                                                                                            // 9. Delete turns
                                                                                            db.run(
                                                                                                'DELETE FROM turns WHERE game_id = ?',
                                                                                                [gameId],
                                                                                                (err) => {
                                                                                                    if (err) console.error('Error deleting turns:', err);
                                                                                                    
                                                                                                    // 10. Delete sectors
                                                                                                    db.run(
                                                                                                        'DELETE FROM sectors WHERE game_id = ?',
                                                                                                        [gameId],
                                                                                                        (err) => {
                                                                                                            if (err) console.error('Error deleting sectors:', err);
                                                                                                            
                                                                                                            // 11. Delete game players
                                                                                                            db.run(
                                                                                                                'DELETE FROM game_players WHERE game_id = ?',
                                                                                                                [gameId],
                                                                                                                (err) => {
                                                                                                                    if (err) console.error('Error deleting game players:', err);
                                                                                                                    
                                                                                                                    // 12. Finally delete the game itself
                                                                                                                    db.run(
                                                                                                                        'DELETE FROM games WHERE id = ?',
                                                                        [gameId],
                                                                        function(err) {
                                                                            if (err) {
                                                                                console.error('Error deleting game:', err);
                                                                                return res.status(500).json({ error: 'Failed to delete game' });
                                                                            }
                                                                            
                                                                            if (this.changes === 0) {
                                                                                return res.status(404).json({ error: 'Game not found' });
                                                                            }
                                                                            
                                                                            console.log(`✅ Game ${gameId} (${game.name}) deleted successfully by user ${userId}`);
                                                                            res.json({ 
                                                                                success: true, 
                                                                                message: `Game "${game.name}" deleted successfully` 
                                                                            });
                                                                        }
                                                                    );
                                                                }
                                                            );
                                                        }
                                                    );
                                                }
                                            );
                                        }
                                    );
                                }
                            );
                        }
                    );
                }
            );
        }
    );
                                                }
                                            );
                                        }
                                    );
                                }
                            );
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});

// Admin-style route to clear all games and related data (dangerous!)
router.delete('/games/clear-all', (req, res) => {
    const { confirm } = req.body || {};
    if (confirm !== 'DELETE') {
        return res.status(400).json({ error: "Confirmation string 'DELETE' required" });
    }
    db.all('SELECT id FROM games', [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to list games' });
        const ids = rows.map(r => r.id);
        let processed = 0;
        let failures = 0;
        const results = [];
        const next = () => {
            if (processed >= ids.length) {
                return res.json({ success: true, deleted: ids.length - failures, failed: failures, details: results });
            }
            const gameId = ids[processed++];
            // Reuse the cascade steps inline (simpler than refactor here)
            db.run(
                `DELETE FROM movement_orders WHERE object_id IN (
                    SELECT so.id FROM sector_objects so 
                    JOIN sectors s ON so.sector_id = s.id 
                    WHERE s.game_id = ?
                )`,
                [gameId],
                () => {
                    db.run('DELETE FROM object_visibility WHERE game_id = ?', [gameId], () => {
                        db.run('DELETE FROM player_visibility WHERE game_id = ?', [gameId], () => {
                            db.run(
                                `DELETE FROM harvesting_tasks WHERE ship_id IN (
                                    SELECT so.id FROM sector_objects so 
                                    JOIN sectors s ON so.sector_id = s.id 
                                    WHERE s.game_id = ?
                                )`,
                                [gameId],
                                () => {
                                    db.run(
                                        `DELETE FROM movement_history WHERE object_id IN (
                                            SELECT so.id FROM sector_objects so 
                                            JOIN sectors s ON so.sector_id = s.id 
                                            WHERE s.game_id = ?
                                        )`,
                                        [gameId],
                                        () => {
                                            db.run(
                                                `DELETE FROM object_cargo WHERE object_id IN (
                                                    SELECT so.id FROM sector_objects so 
                                                    JOIN sectors s ON so.sector_id = s.id 
                                                    WHERE s.game_id = ?
                                                )`,
                                                [gameId],
                                                () => {
                                                    db.run(
                                                        `DELETE FROM ship_cargo WHERE ship_id IN (
                                                            SELECT so.id FROM sector_objects so 
                                                            JOIN sectors s ON so.sector_id = s.id 
                                                            WHERE s.game_id = ?
                                                        )`,
                                                        [gameId],
                                                        () => {
                                                            db.run(
                                                                `DELETE FROM resource_nodes WHERE sector_id IN (
                                                                    SELECT id FROM sectors WHERE game_id = ?
                                                                ) OR parent_object_id IN (
                                                                    SELECT so.id FROM sector_objects so 
                                                                    JOIN sectors s ON so.sector_id = s.id 
                                                                    WHERE s.game_id = ?
                                                                )`,
                                                                [gameId, gameId],
                                                                () => {
                                                                    db.run(
                                                                        `DELETE FROM sector_objects WHERE sector_id IN (
                                                                            SELECT id FROM sectors WHERE game_id = ?
                                                                        )`,
                                                                        [gameId],
                                                                        () => {
                                                                            db.run('DELETE FROM turn_locks WHERE game_id = ?', [gameId], () => {
                                                                                db.run('DELETE FROM turns WHERE game_id = ?', [gameId], () => {
                                                                                    db.run('DELETE FROM sectors WHERE game_id = ?', [gameId], (errSectors) => {
                                                                                        if (errSectors) failures++;
                                                                                        db.run('DELETE FROM game_players WHERE game_id = ?', [gameId], () => {
                                                                                            db.run('DELETE FROM games WHERE id = ?', [gameId], function(errGame) {
                                                                                                results.push({ gameId, ok: !errGame });
                                                                                                next();
                                                                                            });
                                                                                        });
                                                                                    });
                                                                                });
                                                                            });
                                                                        }
                                                                    );
                                                                }
                                                            );
                                                        }
                                                    );
                                                }
                                            );
                                        }
                                    );
                                }
                            );
                        });
                    });
                }
            );
        };
        next();
    });
});

module.exports = router; 