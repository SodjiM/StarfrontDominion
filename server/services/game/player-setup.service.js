const db = require('../../db');

class PlayerSetupService {
    async completeSetup({ gameId, userId, avatar, colorPrimary, colorSecondary, systemName }) {
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
        return { success: true };
    }
}

module.exports = { PlayerSetupService };


