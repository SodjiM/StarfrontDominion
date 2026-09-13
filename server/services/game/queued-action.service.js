const { makeActionRegistry } = require('./action-registry');

class QueuedActionService {
    constructor(db) {
        this.db = db;
        this.registry = makeActionRegistry({ db });
    }

    get(sql, args = []) { return new Promise((resolve, reject) => this.db.get(sql, args, (e, r) => e ? reject(e) : resolve(r || null))); }
    all(sql, args = []) { return new Promise((resolve, reject) => this.db.all(sql, args, (e, r) => e ? reject(e) : resolve(r || []))); }
    run(sql, args = []) { return new Promise((resolve, reject) => this.db.run(sql, args, function (e) { e ? reject(e) : resolve(this); })); }

    async enqueue({ gameId, shipId, actionType, payload, notBeforeTurn = null, clientOrderId = null }) {
        const action = this.registry.get(actionType);
        if (!action) throw new Error('unknown_action_type');
        const normalizedPayload = (actionType === 'move' || actionType === 'movement.move') && payload && !payload.destination && Number.isInteger(payload.x) && Number.isInteger(payload.y)
            ? { destination: { x: payload.x, y: payload.y } }
            : (payload || {});
        const parsed = this.registry.validate(action, normalizedPayload);
        if (!parsed.success) throw new Error('invalid_action_payload');
        const ship = await this.get(`SELECT so.*, s.game_id FROM sector_objects so JOIN sectors s ON s.id = so.sector_id WHERE so.id = ? AND so.type = 'ship'`, [shipId]);
        if (!ship || Number(ship.game_id) !== Number(gameId)) throw new Error('wrong_game');
        const capabilities = await this.registry.getShipCapabilities(ship);
        if (!(action.requiredCapabilities || []).every(cap => capabilities.has(cap))) throw new Error('unsupported_action');
        if (clientOrderId) {
            const existing = await this.get('SELECT * FROM queued_orders WHERE ship_id = ? AND client_order_id = ?', [shipId, clientOrderId]);
            if (existing) return { order: existing, duplicate: true };
        }
        const planningShip = { ...ship, ...(await this.planningOrigin(gameId, shipId, ship)) };
        const preview = typeof action.preview === 'function' ? await action.preview({ db: this.db, gameId, ship: planningShip }, parsed.data) : null;
        if (preview && preview.valid === false) throw new Error(preview.reason || 'action_preview_rejected');

        const count = await this.get(`SELECT COUNT(*) AS count FROM queued_orders WHERE game_id = ? AND ship_id = ? AND status IN ('queued','waiting','running')`, [gameId, shipId]);
        if (Number(count?.count || 0) >= 50) throw new Error('queue_limit_reached');
        const seq = await this.get('SELECT COALESCE(MAX(sequence_index), 0) AS maxSeq FROM queued_orders WHERE game_id = ? AND ship_id = ?', [gameId, shipId]);
        const result = await this.run(
            `INSERT INTO queued_orders (game_id, ship_id, sequence_index, order_type, action_version, payload, preview, not_before_turn, status, client_order_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
            [gameId, shipId, Number(seq?.maxSeq || 0) + 1, actionType, action.version || 1, JSON.stringify(parsed.data), preview ? JSON.stringify(preview) : null, notBeforeTurn, clientOrderId, new Date().toISOString()]
        );
        return { order: await this.get('SELECT * FROM queued_orders WHERE id = ?', [result.lastID]), preview, duplicate: false };
    }

    async list(gameId, shipId, { history = false } = {}) {
        const statuses = history ? `status IN ('queued','waiting','running','completed','failed','cancelled')` : `status IN ('queued','waiting','running')`;
        return this.all(`SELECT id, sequence_index, order_type, action_version, payload, preview, not_before_turn, status, status_reason, attempt_count, created_at, started_turn, resolved_turn
                         FROM queued_orders WHERE game_id = ? AND ship_id = ? AND ${statuses}
                         ORDER BY CASE WHEN status IN ('queued','waiting','running') THEN 0 ELSE 1 END,
                                  CASE WHEN status IN ('queued','waiting','running') THEN sequence_index ELSE -sequence_index END,
                                  id ASC LIMIT ?`, [gameId, shipId, history ? 100 : 50]);
    }

    async cancel({ gameId, shipId, id = null, cascade = false }) {
        const where = id == null ? 'game_id = ? AND ship_id = ?' : 'game_id = ? AND ship_id = ? AND id = ?';
        const args = id == null ? [gameId, shipId] : [gameId, shipId, id];
        const row = id == null ? null : await this.get(`SELECT sequence_index FROM queued_orders WHERE ${where} AND status IN ('queued','waiting')`, args);
        const result = await this.run(`UPDATE queued_orders SET status = 'cancelled', status_reason = 'cancelled_by_user', resolved_at = CURRENT_TIMESTAMP WHERE ${where} AND status IN ('queued','waiting')`, args);
        if (cascade && row) await this.run(`UPDATE queued_orders SET status = 'cancelled', status_reason = 'cancelled_by_predecessor', resolved_at = CURRENT_TIMESTAMP WHERE game_id = ? AND ship_id = ? AND sequence_index > ? AND status IN ('queued','waiting')`, [gameId, shipId, row.sequence_index]);
        return { changed: result.changes || 0 };
    }

    async replace({ gameId, shipId, actionType, payload, clientOrderId = null }) {
        await this.cancel({ gameId, shipId });
        return this.enqueue({ gameId, shipId, actionType, payload, clientOrderId });
    }

    async planningOrigin(gameId, shipId, ship) {
        let origin = { x: Number(ship.x), y: Number(ship.y) };
        const active = await this.get(`SELECT movement_path, destination_x, destination_y FROM movement_orders WHERE object_id = ? AND status IN ('active','blocked','warp_preparing') ORDER BY id DESC LIMIT 1`, [shipId]);
        if (active) {
            try {
                const path = JSON.parse(active.movement_path || '[]');
                if (path.length > 1) origin = path[path.length - 1];
                else origin = { x: Number(active.destination_x), y: Number(active.destination_y) };
            } catch {}
        }
        const queued = await this.all(`SELECT order_type, payload, preview FROM queued_orders WHERE game_id = ? AND ship_id = ? AND status IN ('queued','waiting') ORDER BY sequence_index ASC, id ASC`, [gameId, shipId]);
        for (const row of queued) {
            if (!['movement.move', 'move'].includes(row.order_type)) continue;
            try {
                const preview = row.preview ? JSON.parse(row.preview) : null;
                if (Array.isArray(preview?.path) && preview.path.length > 1) origin = preview.path[preview.path.length - 1];
                else {
                    const payload = JSON.parse(row.payload || '{}');
                    const destination = payload.destination || payload;
                    if (Number.isInteger(destination?.x) && Number.isInteger(destination?.y)) origin = destination;
                }
            } catch {}
        }
        return { x: Number(origin.x), y: Number(origin.y) };
    }

    async materializeForTurn(gameId, turnNumber) {
        const ships = await this.all(`SELECT so.id AS ship_id, so.sector_id, so.x, so.y, so.meta, so.owner_id
                                      FROM sector_objects so JOIN sectors s ON s.id = so.sector_id
                                      WHERE s.game_id = ? AND so.type = 'ship'`, [gameId]);
        const changedShipIds = [];
        for (const rawShip of ships) {
            const order = await this.get(`SELECT * FROM queued_orders WHERE game_id = ? AND ship_id = ? AND status IN ('queued','waiting')
                                          AND (next_attempt_turn IS NULL OR next_attempt_turn <= ?)
                                          ORDER BY sequence_index ASC, id ASC LIMIT 1`, [gameId, rawShip.ship_id, turnNumber]);
            if (!order) continue;
            if (order.not_before_turn != null && Number(order.not_before_turn) > Number(turnNumber)) continue;
            const action = this.registry.get(order.order_type);
            if (!action) {
                await this.fail(order, 'unknown_action_type'); changedShipIds.push(rawShip.ship_id); continue;
            }
            const parsed = this.registry.validate(action, JSON.parse(order.payload || '{}'));
            if (!parsed.success) {
                await this.fail(order, 'invalid_action_payload', true); changedShipIds.push(rawShip.ship_id); continue;
            }
            const ship = { id: rawShip.ship_id, sector_id: rawShip.sector_id, x: rawShip.x, y: rawShip.y, meta: rawShip.meta, owner_id: rawShip.owner_id };
            const capabilities = await this.registry.getShipCapabilities(ship);
            if (!(action.requiredCapabilities || []).every(cap => capabilities.has(cap))) {
                await this.fail(order, 'ship_capability_unavailable', true);
                changedShipIds.push(rawShip.ship_id);
                continue;
            }
            const blocked = await this.blockingReason(ship, action);
            if (blocked) {
                await this.wait(order, blocked, turnNumber + 1); changedShipIds.push(rawShip.ship_id); continue;
            }
            await this.run(`UPDATE queued_orders SET status = 'running', started_turn = COALESCE(started_turn, ?), attempt_count = attempt_count + 1 WHERE id = ? AND status IN ('queued','waiting')`, [turnNumber, order.id]);
            let result;
            try { result = await action.execute({ db: this.db, gameId, turnNumber, ship, order }, parsed.data); }
            catch (e) { result = { outcome: 'failed', reason: e?.message || 'action_execution_failed' }; }
            if (result?.outcome === 'waiting') await this.wait(order, result.reason, result.retryTurn || turnNumber + 1);
            else if (result?.outcome === 'failed') await this.fail(order, result.reason || 'action_failed', result.cancelFollowing);
            else await this.complete(order, turnNumber);
            changedShipIds.push(rawShip.ship_id);
        }
        return { changedShipIds };
    }

    async blockingReason(ship, action) {
        const activeMove = await this.get(`SELECT id FROM movement_orders WHERE object_id = ? AND status IN ('active','blocked','warp_preparing') LIMIT 1`, [ship.id]);
        const harvesting = await this.get(`SELECT id FROM harvesting_tasks WHERE ship_id = ? AND status IN ('active','paused') LIMIT 1`, [ship.id]);
        const lane = await this.get(`SELECT id FROM lane_itineraries WHERE ship_id = ? AND status = 'active' LIMIT 1`, [ship.id]);
        if (lane) return 'ship_in_lane_travel';
        if (activeMove && !(action.interrupts || []).includes('locomotion')) return 'ship_already_moving';
        if (harvesting && !(action.interrupts || []).includes('harvesting')) return 'ship_already_harvesting';
        return null;
    }

    async complete(order, turn) { await this.run(`UPDATE queued_orders SET status = 'completed', status_reason = NULL, resolved_turn = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`, [turn, order.id]); }
    async wait(order, reason, retryTurn) { await this.run(`UPDATE queued_orders SET status = 'waiting', status_reason = ?, next_attempt_turn = ? WHERE id = ?`, [reason, retryTurn, order.id]); }
    async fail(order, reason, cancelFollowing = false) {
        await this.run(`UPDATE queued_orders SET status = 'failed', status_reason = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`, [reason, order.id]);
        if (cancelFollowing) await this.run(`UPDATE queued_orders SET status = 'cancelled', status_reason = 'cancelled_by_predecessor', resolved_at = CURRENT_TIMESTAMP WHERE game_id = ? AND ship_id = ? AND sequence_index > ? AND status IN ('queued','waiting')`, [order.game_id, order.ship_id, order.sequence_index]);
    }
}

module.exports = { QueuedActionService };
