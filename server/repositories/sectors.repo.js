const db = require('../db');

class SectorsRepository {
    async listForGame(gameId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT s.*, u.username as owner_name 
                 FROM sectors s 
                 LEFT JOIN users u ON s.owner_id = u.id 
                 WHERE s.game_id = ?
                 ORDER BY s.name`,
                [gameId],
                (err, rows) => err ? reject(err) : resolve(rows || [])
            );
        });
    }
}

module.exports = { SectorsRepository };


