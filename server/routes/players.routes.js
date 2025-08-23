const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { GameWorldManager } = require('../services/game/game-world.service');
const router = express.Router();

// Switch player's view to a different sector
router.post('/switch-sector', (req, res) => {
    const schema = z.object({
        gameId: z.coerce.number().int().positive(),
        userId: z.coerce.number().int().positive(),
        sectorId: z.coerce.number().int().positive()
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
    const { gameId, userId, sectorId } = parsed.data;
    db.get('SELECT * FROM sectors WHERE id = ? AND game_id = ?', [sectorId, gameId], (err, sector) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!sector) return res.status(404).json({ error: 'Sector not found' });
        GameWorldManager.getPlayerGameState(gameId, userId, sectorId)
            .then(gameState => res.json({ success: true, gameState, message: `Switched to ${sector.name}` }))
            .catch(() => res.status(500).json({ error: 'Failed to switch sectors' }));
    });
});

// Players list is via sockets; keep placeholder for future HTTP exposure

module.exports = router;


