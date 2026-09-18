const dbDefault = require('../../db');

const query = (db, method, sql, params = []) => new Promise((resolve, reject) => {
    if (method === 'run') {
        db.run(sql, params, function (error) { error ? reject(error) : resolve(this); });
    } else {
        db[method](sql, params, (error, value) => error ? reject(error) : resolve(value));
    }
});

const CAPITAL_BANDS = [
    { minimum: 100, award: 5 },
    { minimum: 80, award: 4 },
    { minimum: 60, award: 3 },
    { minimum: 40, award: 2 },
    { minimum: 20, award: 1 },
    { minimum: 0, award: 0 }
];

function capitalAwardForHappiness(happiness) {
    const value = Math.max(0, Math.min(100, Number(happiness) || 0));
    return CAPITAL_BANDS.find(band => value >= band.minimum).award;
}

async function getPoliticalCapital(gameId, userId, db = dbDefault) {
    const row = await query(db, 'get', 'SELECT political_capital AS balance FROM player_political_state WHERE game_id=? AND user_id=?', [gameId, userId]);
    return Number(row?.balance || 0);
}

async function insertCapitalEntry(gameId, userId, amount, details, db = dbDefault) {
    const result = await query(db, 'run', `INSERT OR IGNORE INTO political_capital_ledger
        (game_id,user_id,amount,entry_type,source_key,source_type,source_id,session_id,turn_number,metadata_json)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, [gameId, userId, amount, details.entryType, details.sourceKey,
        details.sourceType, details.sourceId ?? null, details.sessionId ?? null, details.turnNumber ?? null,
        JSON.stringify(details.metadata || {})]);
    if (result.changes) await query(db, 'run', `UPDATE player_political_state
        SET political_capital=COALESCE(political_capital,0)+?,updated_turn=COALESCE(?,updated_turn)
        WHERE game_id=? AND user_id=?`, [amount, details.turnNumber ?? null, gameId, userId]);
    return result;
}

async function listPoliticalCapitalEntries(gameId, userId, db = dbDefault) {
    return query(db, 'all', `SELECT * FROM political_capital_ledger
        WHERE game_id=? AND user_id=? ORDER BY id`, [gameId, userId]);
}

// Awards once per senator active when the session closes, including a senator
// appointed during that session. The source key includes both IDs so
// retries cannot award the same senator twice while zero-award records remain
// an auditable record of the close.
async function awardPoliticalCapital(gameId, userId, sessionId, turnNumber, db = dbDefault, finalHappiness = null) {
    const senators = finalHappiness == null
        ? await query(db, 'all', `SELECT id,happiness FROM senate_senators
            WHERE game_id=? AND user_id=? AND status='active'`, [gameId, userId])
        : [{ id: `manual-${sessionId}`, happiness: finalHappiness }];
    const state = await query(db, 'get', 'SELECT political_capital FROM player_political_state WHERE game_id=? AND user_id=?', [gameId, userId]);
    if (!state) throw new Error('Political state not initialized');
    let awarded = 0;
    for (const senator of senators) {
        const normalizedHappiness = Math.max(0, Math.min(100, Number(senator.happiness) || 0));
        const amount = capitalAwardForHappiness(normalizedHappiness);
        const sourceKey = `senate-session:${sessionId}:senator:${senator.id}`;
        const inserted = await query(db, 'run', `INSERT OR IGNORE INTO political_capital_ledger
            (game_id,user_id,amount,entry_type,source_key,source_type,source_id,session_id,turn_number,happiness,metadata_json)
            VALUES(?,?,?,'award',?,'senate_senator',?,?,?,?,?)`,
            [gameId, userId, amount, sourceKey, String(senator.id), sessionId, turnNumber, Math.round(normalizedHappiness), JSON.stringify({ bandAward: amount })]);
        if (inserted.changes) {
            await query(db, 'run', `UPDATE player_political_state SET political_capital=COALESCE(political_capital,0)+?,updated_turn=? WHERE game_id=? AND user_id=?`, [amount, turnNumber, gameId, userId]);
            awarded += amount;
        }
    }
    return { success: true, award: awarded, senatorCount: senators.length, balance: await getPoliticalCapital(gameId, userId, db) };
}

module.exports = {
    CAPITAL_BANDS,
    capitalAwardForHappiness,
    getPoliticalCapital,
    insertCapitalEntry,
    listPoliticalCapitalEntries,
    awardPoliticalCapital,
    awardCapitalForSession: awardPoliticalCapital
};
