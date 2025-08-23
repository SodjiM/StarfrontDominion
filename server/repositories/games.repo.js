const db = require('../db');

class GamesRepository {
    async listAllGames() {
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM games ORDER BY created_at DESC', [], (err, rows) => err ? reject(err) : resolve(rows || []));
        });
    }

    async listUserGameIds(userId) {
        return new Promise((resolve, reject) => {
            db.all('SELECT game_id FROM game_players WHERE user_id = ?', [userId], (err, rows) => err ? reject(err) : resolve((rows || []).map(r => r.game_id)));
        });
    }

    async getLatestTurn(gameId) {
        return new Promise((resolve) => {
            db.get('SELECT turn_number, created_at FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [gameId], (e, row) => resolve(row || null));
        });
    }

    async getGameById(gameId) {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM games WHERE id = ?', [gameId], (err, row) => err ? reject(err) : resolve(row || null));
        });
    }

    async listPlayersForGame(gameId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT u.username, gp.joined_at FROM game_players gp JOIN users u ON gp.user_id = u.id WHERE gp.game_id = ?`,
                [gameId],
                (err, rows) => err ? reject(err) : resolve(rows || [])
            );
        });
    }

    async createGame({ name, mode, status = 'recruiting', autoTurnMinutes = null }) {
        return new Promise((resolve, reject) => {
            db.run('INSERT INTO games (name, mode, status, auto_turn_minutes) VALUES (?, ?, ?, ?)', [name, mode, status, autoTurnMinutes], function (err) {
                if (err) return reject(err);
                resolve({ id: this.lastID });
            });
        });
    }

    async addPlayerToGame(userId, gameId) {
        return new Promise((resolve, reject) => {
            db.run('INSERT OR IGNORE INTO game_players (user_id, game_id) VALUES (?, ?)', [userId, gameId], function (err) {
                if (err) return reject(err);
                resolve(true);
            });
        });
    }

    async removePlayerFromGame(userId, gameId) {
        return new Promise((resolve, reject) => {
            db.run('DELETE FROM game_players WHERE user_id = ? AND game_id = ?', [userId, gameId], function (err) {
                if (err) return reject(err);
                resolve(true);
            });
        });
    }

    async getGameCreatorId(gameId) {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT user_id FROM game_players WHERE game_id = ? ORDER BY joined_at ASC LIMIT 1',
                [gameId],
                (err, row) => err ? reject(err) : resolve(row ? row.user_id : null)
            );
        });
    }

    async deleteGameCascadeChecked(gameId, actingUserId) {
        const get = (sql, params=[]) => new Promise((resolve, reject) => db.get(sql, params, (e, row) => e ? reject(e) : resolve(row)));
        const run = (sql, params=[]) => new Promise((resolve, reject) => db.run(sql, params, function(e){ e ? reject(e) : resolve(this); }));
        try {
            await run('PRAGMA foreign_keys = OFF');
            await run('BEGIN IMMEDIATE TRANSACTION');
            const game = await get('SELECT g.* FROM games g WHERE g.id = ?', [gameId]);
            if (!game) return { notFound: true };
            const creatorId = await this.getGameCreatorId(gameId);
            if (String(creatorId) !== String(actingUserId)) {
                return { forbidden: true };
            }

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
            if (result.changes === 0) {
                await run('COMMIT');
                return { notFound: true };
            }
            await run('COMMIT');
            return { success: true, gameName: game.name };
        } catch (e) {
            try { await new Promise((resolve) => db.run('ROLLBACK', () => resolve())); } catch {}
            throw e;
        } finally {
            try { await new Promise((resolve) => db.run('PRAGMA foreign_keys = ON', () => resolve())); } catch {}
        }
    }

    async clearAllGamesCascade() {
        const all = (sql, params=[]) => new Promise((resolve, reject) => db.all(sql, params, (e, rows) => e ? reject(e) : resolve(rows)));
        const run = (sql, params=[]) => new Promise((resolve, reject) => db.run(sql, params, function(e){ e ? reject(e) : resolve(this); }));
        let deleted = 0, failed = 0;
        try {
            await run('PRAGMA foreign_keys = OFF');
            const rows = await all('SELECT id FROM games');
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
            return { success: true, deleted, failed };
        } finally {
            try { await run('PRAGMA foreign_keys = ON'); } catch {}
        }
    }
}

module.exports = { GamesRepository };


