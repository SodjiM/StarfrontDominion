const express = require('express');
const db = require('../db');
const router = express.Router();
require('../middleware/auth').protectRouter(router);

// PHASE 1C: Get movement history for accurate trail rendering
router.get('/:gameId/movement-history/:userId', async (req, res) => {
    const { gameId, userId } = req.params;
    const { turns = 10, shipId } = req.query;
    try {
        const { MovementService } = require('../services/game/movement.service');
        const svc = new MovementService();
        const { success, httpStatus, error, currentTurn, rawHistory } = await svc.fetchMovementHistoryRaw({ gameId, userId: parseInt(userId), turns: Number(turns), shipId });
        if (!success) return res.status(httpStatus || 400).json({ error });
        const processedHistory = rawHistory.map(mv => {
            const meta = (() => { try { return JSON.parse(mv.meta || '{}'); } catch { return {}; } })();
            return { shipId: mv.object_id, shipName: meta.name || `${mv.type} ${mv.object_id}`, turnNumber: mv.turn_number, segment: { from: { x: mv.from_x, y: mv.from_y }, to: { x: mv.to_x, y: mv.to_y } }, movementSpeed: mv.movement_speed, isOwned: mv.owner_id === parseInt(userId), isVisible: true, timestamp: mv.created_at };
        });
        res.json({ success: true, currentTurn, turnsRequested: Number(turns), movementHistory: processedHistory });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get movement history', details: error.message });
    }
});

module.exports = router;

