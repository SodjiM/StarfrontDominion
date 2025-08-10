const express = require('express');
const db = require('../db');
const router = express.Router();

// Get all games + highlight games user is in
router.get('/games/:userId', (req, res) => {
    const userId = req.params.userId;
    db.all('SELECT * FROM games ORDER BY created_at DESC', [], (err, allGames) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch games' });
        db.all('SELECT game_id FROM game_players WHERE user_id = ?', [userId], (err2, userGames) => {
            if (err2) return res.status(500).json({ error: 'Failed to fetch user games' });
            const gameIds = (userGames || []).map(g => g.game_id);
            res.json({ allGames, userGameIds: gameIds });
        });
    });
});

// Get game details including players
router.get('/game/:gameId', (req, res) => {
    const gameId = req.params.gameId;
    db.get('SELECT * FROM games WHERE id = ?', [gameId], (err, game) => {
        if (err || !game) return res.status(404).json({ error: 'Game not found' });
        db.all(
            `SELECT u.username, gp.joined_at FROM game_players gp JOIN users u ON gp.user_id = u.id WHERE gp.game_id = ?`,
            [gameId],
            (err2, players) => {
                if (err2) return res.status(500).json({ error: 'Failed to fetch players' });
                res.json({ ...game, players });
            }
        );
    });
});

// Join a game
router.post('/join', (req, res) => {
    const { userId, gameId } = req.body;
    db.get('SELECT status FROM games WHERE id = ?', [gameId], (err, game) => {
        if (err || !game) return res.status(404).json({ error: 'Game not found' });
        if (game.status !== 'recruiting') return res.status(400).json({ error: 'Game is not accepting new players' });
        db.run('INSERT OR IGNORE INTO game_players (user_id, game_id) VALUES (?, ?)', [userId, gameId], function (e) {
            if (e) return res.status(500).json({ error: 'Failed to join game' });
            res.json({ success: true });
        });
    });
});

// Leave a game
router.post('/leave', (req, res) => {
    const { userId, gameId } = req.body;
    db.run('DELETE FROM game_players WHERE user_id = ? AND game_id = ?', [userId, gameId], function (err) {
        if (err) return res.status(500).json({ error: 'Failed to leave game' });
        res.json({ success: true });
    });
});

// Create a new game
router.post('/create', (req, res) => {
    const { name, mode, creatorId } = req.body;
    if (!name || !mode) return res.status(400).json({ error: 'Game name and mode required' });
    db.run('INSERT INTO games (name, mode, status) VALUES (?, ?, ?)', [name, mode, 'recruiting'], function (err) {
        if (err) return res.status(500).json({ error: 'Failed to create game' });
        const gameId = this.lastID;
        if (creatorId) db.run('INSERT INTO game_players (user_id, game_id) VALUES (?, ?)', [creatorId, gameId]);
        res.json({ gameId, success: true });
    });
});

// Delete a game (only creator can delete)
router.delete('/game/:gameId', async (req, res) => {
    const { gameId } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    const get = (sql, params=[]) => new Promise((resolve, reject) => db.get(sql, params, (e, row) => e ? reject(e) : resolve(row)));
    const run = (sql, params=[]) => new Promise((resolve, reject) => db.run(sql, params, function(e){ e ? reject(e) : resolve(this); }));

    try {
        await run('PRAGMA foreign_keys = OFF');
        await run('BEGIN IMMEDIATE TRANSACTION');
        const game = await get('SELECT g.*, (SELECT user_id FROM game_players WHERE game_id = ? ORDER BY joined_at ASC LIMIT 1) as creator_id FROM games g WHERE g.id = ?', [gameId, gameId]);
        if (!game) return res.status(404).json({ error: 'Game not found' });
        if (String(game.creator_id) !== String(userId)) return res.status(403).json({ error: 'Only the game creator can delete this game' });

        await run(`DELETE FROM movement_orders WHERE object_id IN (
            SELECT so.id FROM sector_objects so JOIN sectors s ON so.sector_id = s.id WHERE s.game_id = ?
        )`, [gameId]);
        await run('DELETE FROM object_visibility WHERE game_id = ?', [gameId]);
        await run(`DELETE FROM harvesting_tasks WHERE ship_id IN (
            SELECT so.id FROM sector_objects so JOIN sectors s ON so.sector_id = s.id WHERE s.game_id = ?
        )`, [gameId]);
        await run(`DELETE FROM movement_history WHERE game_id = ?`, [gameId]);
        await run(`DELETE FROM object_cargo WHERE object_id IN (
            SELECT so.id FROM sector_objects so JOIN sectors s ON so.sector_id = s.id WHERE s.game_id = ?
        )`, [gameId]);
        await run(`DELETE FROM ship_cargo WHERE ship_id IN (
            SELECT so.id FROM sector_objects so JOIN sectors s ON so.sector_id = s.id WHERE s.game_id = ?
        )`, [gameId]);
        await run(`DELETE FROM resource_nodes WHERE sector_id IN (
            SELECT id FROM sectors WHERE game_id = ?
        ) OR parent_object_id IN (
            SELECT so.id FROM sector_objects so JOIN sectors s ON so.sector_id = s.id WHERE s.game_id = ?
        )`, [gameId, gameId]);
        await run(`DELETE FROM sector_objects WHERE sector_id IN (
            SELECT id FROM sectors WHERE game_id = ?
        )`, [gameId]);
        await run(`DELETE FROM generation_history WHERE sector_id IN (
            SELECT id FROM sectors WHERE game_id = ?
        )`, [gameId]);
        await run('DELETE FROM turn_locks WHERE game_id = ?', [gameId]);
        await run('DELETE FROM turns WHERE game_id = ?', [gameId]);
        await run('DELETE FROM sectors WHERE game_id = ?', [gameId]);
        await run('DELETE FROM game_players WHERE game_id = ?', [gameId]);
        const result = await run('DELETE FROM games WHERE id = ?', [gameId]);
        if (result.changes === 0) return res.status(404).json({ error: 'Game not found' });
        await run('COMMIT');
        res.json({ success: true, message: `Game "${game.name}" deleted successfully` });
    } catch (e) {
        console.error('Error deleting game:', e);
        try { await run('ROLLBACK'); } catch {}
        res.status(500).json({ error: 'Failed to delete game' });
    } finally {
        try { await run('PRAGMA foreign_keys = ON'); } catch {}
    }
});

// Clear all games (admin)
router.delete('/games/clear-all', async (req, res) => {
    const { confirm } = req.body || {};
    if (confirm !== 'DELETE') return res.status(400).json({ error: "Confirmation string 'DELETE' required" });

    const all = (sql, params=[]) => new Promise((resolve, reject) => db.all(sql, params, (e, rows) => e ? reject(e) : resolve(rows)));
    const run = (sql, params=[]) => new Promise((resolve, reject) => db.run(sql, params, function(e){ e ? reject(e) : resolve(this); }));

    try {
        await run('PRAGMA foreign_keys = OFF');
        const rows = await all('SELECT id FROM games');
        let deleted = 0, failed = 0;
        for (const r of rows) {
            const gameId = r.id;
            try {
                await run('BEGIN IMMEDIATE TRANSACTION');
                await run(`DELETE FROM movement_orders WHERE object_id IN (
                    SELECT so.id FROM sector_objects so JOIN sectors s ON so.sector_id = s.id WHERE s.game_id = ?
                )`, [gameId]);
                await run('DELETE FROM object_visibility WHERE game_id = ?', [gameId]);
                await run(`DELETE FROM harvesting_tasks WHERE ship_id IN (
                    SELECT so.id FROM sector_objects so JOIN sectors s ON so.sector_id = s.id WHERE s.game_id = ?
                )`, [gameId]);
                await run(`DELETE FROM movement_history WHERE game_id = ?`, [gameId]);
                await run(`DELETE FROM object_cargo WHERE object_id IN (
                    SELECT so.id FROM sector_objects so JOIN sectors s ON so.sector_id = s.id WHERE s.game_id = ?
                )`, [gameId]);
                await run(`DELETE FROM ship_cargo WHERE ship_id IN (
                    SELECT so.id FROM sector_objects so JOIN sectors s ON so.sector_id = s.id WHERE s.game_id = ?
                )`, [gameId]);
                await run(`DELETE FROM resource_nodes WHERE sector_id IN (
                    SELECT id FROM sectors WHERE game_id = ?
                ) OR parent_object_id IN (
                    SELECT so.id FROM sector_objects so JOIN sectors s ON so.sector_id = s.id WHERE s.game_id = ?
                )`, [gameId, gameId]);
                await run(`DELETE FROM sector_objects WHERE sector_id IN (
                    SELECT id FROM sectors WHERE game_id = ?
                )`, [gameId]);
                await run(`DELETE FROM generation_history WHERE sector_id IN (
                    SELECT id FROM sectors WHERE game_id = ?
                )`, [gameId]);
                await run('DELETE FROM turn_locks WHERE game_id = ?', [gameId]);
                await run('DELETE FROM turns WHERE game_id = ?', [gameId]);
                await run('DELETE FROM sectors WHERE game_id = ?', [gameId]);
                await run('DELETE FROM game_players WHERE game_id = ?', [gameId]);
                await run('DELETE FROM games WHERE id = ?', [gameId]);
                await run('COMMIT');
                deleted += 1;
            } catch (inner) {
                try { await run('ROLLBACK'); } catch {}
                failed += 1;
            }
        }
        res.json({ success: true, deleted, failed });
    } catch (e) {
        console.error('Error clearing games:', e);
        res.status(500).json({ error: 'Failed to clear games' });
    } finally {
        try { await run('PRAGMA foreign_keys = ON'); } catch {}
    }
});

module.exports = router;

