const dbDefault = require('../../db');
const capital = require('./political-capital.service');
const { withSavepoint } = require('./savepoint');

const query = (db, method, sql, params = []) => new Promise((resolve, reject) => {
    if (method === 'run') db.run(sql, params, function (error) { error ? reject(error) : resolve(this); });
    else db[method](sql, params, (error, value) => error ? reject(error) : resolve(value));
});

const TARGET_TYPES = new Set(['sun', 'planet', 'moon', 'asteroid_belt', 'solar_system']);
const TARGET_ALIASES = { 'asteroid belt': 'asteroid_belt', 'asteroid-belt': 'asteroid_belt', 'solar system': 'solar_system', 'solar-system': 'solar_system' };
const CAPITAL_COST = 2;

function normalizeTargetType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return TARGET_ALIASES[normalized] || normalized;
}

function publicError(code) { return { success: false, code, error: code === 'target_unavailable' ? 'Target unavailable' : code }; }

async function findVisibleTarget(gameId, userId, targetType, targetId, db) {
    if (targetType === 'solar_system') {
        return query(db, 'get', `SELECT s.id, s.name, s.owner_id
            FROM sectors s WHERE s.id=? AND s.game_id=?
              AND (s.owner_id=? OR EXISTS (SELECT 1 FROM object_visibility ov
                    JOIN sector_objects vo ON vo.id=ov.object_id
                    WHERE ov.game_id=? AND ov.user_id=? AND vo.sector_id=s.id))`, [targetId, gameId, userId, gameId, userId]);
    }
    const celestial = targetType === 'sun' ? ['star', 'sun'] : targetType === 'asteroid_belt' ? ['belt', 'asteroid-belt', 'asteroid_belt'] : [targetType];
    const marks = celestial.map(() => '?').join(',');
    return query(db, 'get', `SELECT so.id, so.type, so.celestial_type, so.meta, so.owner_id, so.sector_id
        FROM sector_objects so JOIN sectors s ON s.id=so.sector_id
        WHERE so.id=? AND s.game_id=? AND (so.celestial_type IN (${marks}) OR so.type IN (${marks}))
          AND (so.owner_id=? OR EXISTS (SELECT 1 FROM object_visibility ov
            WHERE ov.game_id=? AND ov.user_id=? AND ov.object_id=so.id))`,
        [targetId, gameId, ...celestial, ...celestial, userId, gameId, userId]);
}

function parseMeta(meta) { try { return JSON.parse(meta || '{}'); } catch { return {}; } }

function normalizeProposal(row) {
    if (!row) return null;
    let snapshot = {};
    try { snapshot = JSON.parse(row.target_snapshot_json || '{}'); } catch {}
    return {
        id: Number(row.id), proposerUserId: Number(row.user_id), clientRequestKey: row.client_request_key, targetType: row.target_type,
        targetId: Number(row.target_id), target: snapshot, proposedName: row.proposed_name,
        previousName: row.previous_name ?? null, currentName: row.current_name ?? null,
        capitalCost: Number(row.capital_cost), status: row.status,
        submittedTurn: Number(row.submitted_turn || 0),
        decidedTurn: row.decided_turn == null ? null : Number(row.decided_turn),
        enactedTurn: row.enacted_turn == null ? null : Number(row.enacted_turn), createdAt: row.created_at
    };

}

function targetName(row, targetType) {
    if (targetType === 'solar_system') return row.name || `System ${row.id}`;
    return parseMeta(row.meta).name || `${targetType.replace('_', ' ')} ${row.id}`;
}

async function proposeCivicName(gameId, userId, input, db = dbDefault) {
    const requestKey = String(input?.clientRequestId || input?.clientRequestKey || input?.requestKey || '').trim();
    const targetType = normalizeTargetType(input?.targetType);
    const targetId = Number(input?.targetId);
    const proposedName = String(input?.name || input?.proposedName || '').trim();
    const submittedTurn = Math.max(0, Number(input?.submittedTurn) || 0);
    if (!requestKey || requestKey.length > 100 || !TARGET_TYPES.has(targetType) || !Number.isInteger(targetId) || targetId <= 0 || !proposedName || proposedName.length > 80) return publicError('invalid_request');
    const prior = await query(db, 'get', 'SELECT * FROM civic_naming_proposals WHERE game_id=? AND user_id=? AND client_request_key=?', [gameId, userId, requestKey]);
    if (prior) return { success: true, idempotent: true, proposal: normalizeProposal(prior) };
    const target = await findVisibleTarget(gameId, userId, targetType, targetId, db);
    if (!target) return publicError('target_unavailable');
    const balance = await capital.getPoliticalCapital(gameId, userId, db);
    if (balance < CAPITAL_COST) return publicError('insufficient_political_capital');
    const meta = parseMeta(target.meta);
    const previousName = targetType === 'solar_system' ? (target.name || null) : (meta.name || null);
    const snapshot = { targetType, targetId, sectorId: target.sector_id ?? target.id, previousName, type: target.celestial_type || target.type || 'solar_system' };
    return withSavepoint(db, async () => {
        const entry = await capital.insertCapitalEntry(gameId, userId, -CAPITAL_COST, {
            entryType: 'spend', sourceKey: `civic-naming:${requestKey}`, sourceType: 'civic_naming', sourceId: requestKey,
            metadata: { targetType, targetId, requestKey }
        }, db);
        if (!entry.changes) {
            const existing = await query(db, 'get', 'SELECT * FROM civic_naming_proposals WHERE game_id=? AND user_id=? AND client_request_key=?', [gameId, userId, requestKey]);
            return { success: true, idempotent: true, proposal: normalizeProposal(existing) };
        }
        const created = await query(db, 'run', `INSERT INTO civic_naming_proposals
            (game_id,user_id,client_request_key,target_type,target_id,target_snapshot_json,proposed_name,previous_name,current_name,capital_cost,status,submitted_turn)
            VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?)`, [gameId, userId, requestKey, targetType, targetId, JSON.stringify(snapshot), proposedName, previousName, previousName, CAPITAL_COST, submittedTurn]);
        const proposal = await query(db, 'get', 'SELECT * FROM civic_naming_proposals WHERE id=?', [created.lastID]);
        return { success: true, proposal: normalizeProposal(proposal), balance: await capital.getPoliticalCapital(gameId, userId, db) };
    });
}

async function getCivicNamingReadModel(gameId, userId, db = dbDefault, recentLimit = 20) {
    const ledger = await query(db, 'all', `SELECT id,amount,entry_type,source_key,source_type,source_id,session_id,turn_number,happiness,created_at
        FROM political_capital_ledger WHERE game_id=? AND user_id=? ORDER BY id DESC LIMIT ?`, [gameId, userId, Math.max(1, Math.min(100, Number(recentLimit) || 20))]);
    const targets = [];
    const targetQueries = [
        ['sun', "so.celestial_type IN ('star','sun')"],
        ['planet', "so.celestial_type='planet'"],
        ['moon', "so.celestial_type='moon'"],
        ['asteroid_belt', "so.celestial_type IN ('belt','asteroid-belt','asteroid_belt') OR so.type IN ('belt','asteroid-belt','asteroid_belt')"]
    ];
    for (const [targetType, predicate] of targetQueries) {
        const rows = await query(db, 'all', `SELECT so.id,so.type,so.celestial_type,so.meta,so.owner_id,so.sector_id
            FROM sector_objects so JOIN sectors s ON s.id=so.sector_id WHERE s.game_id=? AND (${predicate})
              AND (so.owner_id=? OR EXISTS (SELECT 1 FROM object_visibility ov
                WHERE ov.game_id=? AND ov.user_id=? AND ov.object_id=so.id)) ORDER BY so.id`, [gameId, userId, gameId, userId]);
        for (const row of rows) targets.push({ targetType, targetId: Number(row.id), name: targetName(row, targetType), sectorId: Number(row.sector_id) });
    }
    const systems = await query(db, 'all', `SELECT s.id,s.name FROM sectors s WHERE s.game_id=?
        AND (s.owner_id=? OR EXISTS (SELECT 1 FROM object_visibility ov JOIN sector_objects so ON so.id=ov.object_id
             WHERE ov.game_id=? AND ov.user_id=? AND so.sector_id=s.id)) ORDER BY s.id`, [gameId, userId, gameId, userId]);
    for (const row of systems) targets.push({ targetType: 'solar_system', targetId: Number(row.id), name: row.name || `System ${row.id}` });
    const visibleTargetKeys = new Set(targets.map(target => `${target.targetType}:${target.targetId}`));
    const proposalRows = await query(db, 'all', `SELECT * FROM civic_naming_proposals
        WHERE game_id=? AND status='pending' ORDER BY id DESC`, [gameId]);
    const relevantProposals = proposalRows.filter(row => Number(row.user_id) === Number(userId)
        || visibleTargetKeys.has(`${row.target_type}:${Number(row.target_id)}`));
    return {
        politicalCapital: await capital.getPoliticalCapital(gameId, userId, db),
        recentLedgerEntries: ledger.map(entry => ({
            id: Number(entry.id), amount: Number(entry.amount), entryType: entry.entry_type,
            sourceType: entry.source_type, sourceId: entry.source_id,
            sessionId: entry.session_id == null ? null : Number(entry.session_id),
            turnNumber: entry.turn_number == null ? null : Number(entry.turn_number),
            happiness: entry.happiness == null ? null : Number(entry.happiness), createdAt: entry.created_at
        })),
        pendingProposals: relevantProposals.map(normalizeProposal), eligibleNamingTargets: targets
    };
}

async function getCivicNamingProposal(gameId, userId, proposalId, db = dbDefault) {
    return query(db, 'get', 'SELECT * FROM civic_naming_proposals WHERE game_id=? AND user_id=? AND id=?', [gameId, userId, proposalId]);
}

module.exports = { CAPITAL_COST, TARGET_TYPES, normalizeTargetType, normalizeProposal, proposeCivicName, createNamingProposal: proposeCivicName, getCivicNamingProposal, getCivicNamingReadModel, getPoliticalCivicState: getCivicNamingReadModel };
