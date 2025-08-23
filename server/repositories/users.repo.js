const db = require('../db');

class UsersRepository {
    async createUser(username, hashedPassword) {
        return new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO users (username, password) VALUES (?, ?)',
                [username, hashedPassword],
                function (err) {
                    if (err) return reject(err);
                    resolve({ id: this.lastID, username });
                }
            );
        });
    }

    async findByUsername(username) {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            });
        });
    }

    async updatePresence(userId, fields) {
        const updates = [];
        const params = [];
        if (fields.lastSeenAt) { updates.push('last_seen_at = ?'); params.push(fields.lastSeenAt); }
        if (fields.lastActivityAt) { updates.push('last_activity_at = ?'); params.push(fields.lastActivityAt); }
        if (updates.length === 0) return;
        params.push(userId);
        return new Promise((resolve) => {
            db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params, () => resolve());
        });
    }
}

module.exports = { UsersRepository };


