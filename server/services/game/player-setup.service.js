const db = require('../../db');

class PlayerSetupService {
    async completeSetup({ gameId, userId, avatar, colorPrimary, colorSecondary, systemName, archetypeKey }) {
        await new Promise((resolve, reject) => {
            db.run(
                'UPDATE game_players SET avatar = ?, color_primary = ?, color_secondary = ?, setup_completed = 1 WHERE game_id = ? AND user_id = ?',
                [avatar, colorPrimary, colorSecondary, gameId, userId],
                function(err) {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
        await new Promise((resolve, reject) => {
            db.run('UPDATE sectors SET name = ? WHERE game_id = ? AND owner_id = ?', [systemName, gameId, userId], function(sectorErr) {
                if (sectorErr) return reject(sectorErr);
                resolve();
            });
        });
        // If archetype is selected at setup, persist and seed now
        if (archetypeKey) {
            const ak = String(archetypeKey).toLowerCase();
            await new Promise((resolve) => db.run(
                `UPDATE sectors SET archetype = ? WHERE game_id = ? AND owner_id = ?`,
                [ak, gameId, userId],
                () => resolve()
            ));
            const sectorRow = await new Promise((resolve) => db.get('SELECT id FROM sectors WHERE game_id = ? AND owner_id = ?', [gameId, userId], (e, r) => resolve(r)));
            if (sectorRow && sectorRow.id) {
                try {
                    const { seedSector } = require('../world/seed-orchestrator');
                    await seedSector({ sectorId: sectorRow.id, archetypeKey: ak, seedBase: gameId });
                    // Create starting objects now that the sector is seeded
                    const { GameWorldManager } = require('./game-world.service');
                    const userRow = await new Promise((resolve) => db.get('SELECT username FROM users WHERE id = ?', [userId], (e, r) => resolve(r)));
                    const player = { username: userRow?.username || `Player ${userId}`, user_id: userId };
                    await new Promise((resolve, reject) => {
                        GameWorldManager.generateSectorAndStartingObjects(gameId, player, sectorRow.id, () => resolve(), (err) => reject(err));
                    });
                } catch (e) {
                    console.warn('Seeding on setup failed:', e?.message || e);
                }
            }
        }
        return { success: true };
    }
}

module.exports = { PlayerSetupService };


