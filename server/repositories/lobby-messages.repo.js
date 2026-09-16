const db = require('../db');

const MAX_MESSAGE_LENGTH = 500;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

class LobbyMessageValidationError extends Error {
    constructor(message) {
        super(message);
        this.code = 'invalid_lobby_message';
        this.status = 400;
    }
}

function normalizeMessage(text) {
    if (typeof text !== 'string') throw new LobbyMessageValidationError('Message text is required');
    const value = text.trim();
    if (!value) throw new LobbyMessageValidationError('Message text is required');
    if (value.length > MAX_MESSAGE_LENGTH) throw new LobbyMessageValidationError(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
    return value;
}

function normalizePageSize(limit) {
    if (limit == null || limit === '') return DEFAULT_PAGE_SIZE;
    const value = Number(limit);
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
        throw new LobbyMessageValidationError(`Limit must be an integer from 1 to ${MAX_PAGE_SIZE}`);
    }
    return value;
}

function normalizeBefore(before) {
    if (before == null || before === '') return null;
    const value = Number(before);
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new LobbyMessageValidationError('Before must be a positive message id');
    }
    return value;
}

class LobbyMessagesRepository {
    async list({ limit, before } = {}) {
        const pageSize = normalizePageSize(limit);
        const cursor = normalizeBefore(before);
        const where = cursor == null ? '' : 'WHERE lm.id < ?';
        // Read one extra row so an exactly-full final page does not advertise
        // a cursor that can only produce an empty page.
        const params = cursor == null ? [pageSize + 1] : [cursor, pageSize + 1];
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT lm.id, lm.user_id AS userId, u.username,
                        lm.text, lm.created_at AS createdAt
                   FROM lobby_messages lm
                   JOIN users u ON u.id = lm.user_id
                   ${where}
                  ORDER BY lm.id DESC
                  LIMIT ?`,
                params,
                (err, rows) => {
                    if (err) return reject(err);
                    const rowsWithLookahead = rows || [];
                    const hasMore = rowsWithLookahead.length > pageSize;
                    const messages = rowsWithLookahead.slice(0, pageSize);
                    resolve({
                        messages,
                        nextBefore: hasMore ? messages[messages.length - 1].id : null
                    });
                }
            );
        });
    }

    async create({ userId, text }) {
        const value = normalizeMessage(text);
        return new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO lobby_messages (user_id, text) VALUES (?, ?)',
                [userId, value],
                function (err) {
                    if (err) return reject(err);
                    db.get(
                        `SELECT lm.id, lm.user_id AS userId, u.username,
                                lm.text, lm.created_at AS createdAt
                           FROM lobby_messages lm
                           JOIN users u ON u.id = lm.user_id
                          WHERE lm.id = ?`,
                        [this.lastID],
                        (readErr, row) => readErr ? reject(readErr) : resolve(row)
                    );
                }
            );
        });
    }
}

module.exports = {
    LobbyMessagesRepository,
    LobbyMessageValidationError,
    MAX_MESSAGE_LENGTH,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
};
