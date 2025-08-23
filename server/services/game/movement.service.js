const db = require('../../db');

class MovementService {
    // Skeleton: movement order creation, validation, and history recording
    async getLatestMovementOrder(objectId) {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM movement_orders WHERE object_id = ? ORDER BY created_at DESC LIMIT 1`,
                [objectId],
                (err, row) => err ? reject(err) : resolve(row || null)
            );
        });
    }

    async teleportThroughGate({ shipId, gateId, userId }) {
        const ship = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM sector_objects WHERE id = ? AND owner_id = ? AND type = ?', [shipId, userId, 'ship'], (err, row) => err ? reject(err) : resolve(row || null));
        });
        if (!ship) return { success: false, httpStatus: 404, error: 'Ship not found or not owned by player' };
        const gate = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM sector_objects WHERE id = ? AND type = ?', [gateId, 'interstellar-gate'], (err, row) => err ? reject(err) : resolve(row || null));
        });
        if (!gate) return { success: false, httpStatus: 404, error: 'Interstellar gate not found' };
        const gateMeta = JSON.parse(gate.meta || '{}');
        const destinationSectorId = gateMeta.destinationSectorId;
        if (!destinationSectorId) return { success: false, httpStatus: 400, error: 'Gate has no valid destination' };
        const dx = Math.abs(ship.x - gate.x); const dy = Math.abs(ship.y - gate.y);
        if (dx > 1 || dy > 1) return { success: false, httpStatus: 400, error: 'Ship must be adjacent to the gate to travel' };

        const pairedGate = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM sector_objects WHERE sector_id = ? AND type = 'interstellar-gate' AND JSON_EXTRACT(meta, '$.gatePairId') = ?`,
                [destinationSectorId, gateMeta.gatePairId],
                (err, row) => err ? reject(err) : resolve(row || null)
            );
        });
        if (!pairedGate) return { success: false, httpStatus: 404, error: 'Destination gate not found' };
        const newX = pairedGate.x + (Math.random() < 0.5 ? -1 : 1);
        const newY = pairedGate.y + (Math.random() < 0.5 ? -1 : 1);
        await new Promise((resolve, reject) => {
            db.run('UPDATE sector_objects SET sector_id = ?, x = ?, y = ? WHERE id = ?', [destinationSectorId, newX, newY, shipId], function(err){ return err ? reject(err) : resolve(); });
        });
        return { success: true, destinationSectorId, newX, newY, fromSectorId: ship.sector_id, shipName: (JSON.parse(ship.meta || '{}').name) };
    }

    async createMoveOrder({ gameId, shipId, currentX, currentY, destinationX, destinationY, movementPath }) {
        const ship = await new Promise((resolve, reject) => db.get('SELECT x, y, meta FROM sector_objects WHERE id = ?', [shipId], (e, r) => e ? reject(e) : resolve(r || null)));
        if (!ship) return { success: false, httpStatus: 404, error: 'Ship not found' };
        const meta = (() => { try { return JSON.parse(ship.meta || '{}'); } catch { return {}; } })();
        const movementSpeed = meta.movementSpeed || 1;
        const pathLength = movementPath ? Math.max(0, movementPath.length - 1) : 0;
        const actualETA = Math.ceil(pathLength / Math.max(1, movementSpeed));
        await new Promise((resolve, reject) => db.run('DELETE FROM movement_orders WHERE object_id = ? AND status IN ("active","blocked")', [shipId], function(err){ return err ? reject(err) : resolve(); }));
        const orderTimestamp = new Date().toISOString();
        await new Promise((resolve, reject) => db.run(
            `INSERT INTO movement_orders 
             (object_id, destination_x, destination_y, movement_speed, eta_turns, movement_path, current_step, status, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, 0, 'active', ?)`,
            [shipId, destinationX, destinationY, movementSpeed, actualETA, JSON.stringify(movementPath || []), orderTimestamp],
            (err) => err ? reject(err) : resolve()
        ));
        return { success: true, pathLength, eta: actualETA };
    }

    async createWarpOrder({ gameId, shipId, targetId, targetX, targetY, shipName, targetName }) {
        const ship = await new Promise((resolve, reject) => db.get('SELECT x, y, meta FROM sector_objects WHERE id = ?', [shipId], (e, r) => e ? reject(e) : resolve(r || null)));
        if (!ship) return { success: false, httpStatus: 404, error: 'Ship not found' };
        await new Promise((resolve, reject) => db.run('DELETE FROM movement_orders WHERE object_id = ? AND status IN ("active","blocked")', [shipId], function(err){ return err ? reject(err) : resolve(); }));
        let requiredPrep = 2;
        try {
            const metaObj = (() => { try { return JSON.parse(ship.meta || '{}'); } catch { return {}; } })();
            if (typeof metaObj.warpPreparationTurns === 'number' && metaObj.warpPreparationTurns >= 0) {
                requiredPrep = Math.max(0, Math.floor(metaObj.warpPreparationTurns));
            }
        } catch {}
        const orderTimestamp = new Date().toISOString();
        await new Promise((resolve, reject) => db.run(
            `INSERT INTO movement_orders 
             (object_id, warp_target_id, warp_destination_x, warp_destination_y, 
              warp_phase, warp_preparation_turns, status, created_at) 
             VALUES (?, ?, ?, ?, 'preparing', 0, 'warp_preparing', ?)`,
            [shipId, targetId || null, targetX, targetY, orderTimestamp],
            (err) => err ? reject(err) : resolve()
        ));
        return { success: true, requiredPrep };
    }

    async fetchMovementHistoryRaw({ gameId, userId, turns = 10, shipId }) {
        // Verify membership
        const membership = await new Promise((resolve, reject) => db.get('SELECT 1 FROM game_players WHERE game_id = ? AND user_id = ?', [gameId, userId], (e, r) => e ? reject(e) : resolve(r)));
        if (!membership) return { success: false, httpStatus: 403, error: 'Not authorized to view this game' };
        // Current turn
        const currentTurn = await new Promise((resolve, reject) => db.get('SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [gameId], (e, r) => e ? reject(e) : resolve(r?.turn_number || 1)));
        // Build query
        let historyQuery = `
            SELECT mh.*, so.owner_id, so.meta, so.type
            FROM movement_history mh
            JOIN sector_objects so ON mh.object_id = so.id
            JOIN sectors s ON so.sector_id = s.id
            WHERE mh.game_id = ? AND mh.turn_number > ?
        `;
        const params = [gameId, currentTurn - turns];
        if (shipId) { historyQuery += ' AND mh.object_id = ?'; params.push(shipId); }
        historyQuery += ' ORDER BY mh.turn_number DESC, mh.created_at DESC';
        const rawHistory = await new Promise((resolve, reject) => db.all(historyQuery, params, (e, rows) => e ? reject(e) : resolve(rows || [])));
        const objectIds = [...new Set(rawHistory.map(r => r.object_id))];
        const objectIdToSector = new Map();
        if (objectIds.length > 0) {
            const placeholders = objectIds.map(() => '?').join(',');
            const rows = await new Promise((resolve, reject) => db.all(`SELECT id, sector_id FROM sector_objects WHERE id IN (${placeholders})`, objectIds, (e, r) => e ? reject(e) : resolve(r || [])));
            rows.forEach(r => objectIdToSector.set(r.id, r.sector_id));
        }
        return { success: true, currentTurn, rawHistory, objectIdToSector };
    }

    async getSectorTrails({ sectorId, sinceTurn, maxAge = 10 }) {
        // Determine game_id
        const sector = await new Promise((resolve, reject) => db.get('SELECT game_id FROM sectors WHERE id = ?', [sectorId], (e, r) => e ? reject(e) : resolve(r || null)));
        if (!sector) return { success: false, httpStatus: 404, error: 'sector_not_found' };
        const currentTurn = await new Promise((resolve, reject) => db.get('SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [sector.game_id], (e, r) => e ? reject(e) : resolve(r?.turn_number || 1)));
        const since = Number(sinceTurn || currentTurn);
        const minTurn = Math.max(1, since - (Number(maxAge) - 1));
        const rows = await new Promise((resolve, reject) => db.all(
            `SELECT mh.object_id as shipId, so.owner_id as ownerId, mh.turn_number as turn,
                    mh.from_x as fromX, mh.from_y as fromY, mh.to_x as toX, mh.to_y as toY
             FROM movement_history mh
             JOIN sector_objects so ON so.id = mh.object_id
             WHERE so.sector_id = ? AND mh.game_id = ? AND mh.turn_number BETWEEN ? AND ?
             ORDER BY mh.turn_number ASC, mh.id ASC`,
            [sectorId, sector.game_id, minTurn, since],
            (e, r) => e ? reject(e) : resolve(r || [])
        ));
        const segments = rows.map(r => ({ shipId: r.shipId, ownerId: r.ownerId, turn: r.turn, type: 'move', from: { x: r.fromX, y: r.fromY }, to: { x: r.toX, y: r.toY } }));
        return { success: true, turn: since, maxAge: Number(maxAge), segments };
    }
}

module.exports = { MovementService };


