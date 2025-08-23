const express = require('express');
const db = require('../db');
const router = express.Router();

// Galaxy graph: systems and interstellar gates
router.get('/:gameId/galaxy-graph', (req, res) => {
    const { gameId } = req.params;
    db.all('SELECT id, name FROM sectors WHERE game_id = ? ORDER BY id', [gameId], (err, sectors) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch sectors' });
        db.all(
            `SELECT so.sector_id as sourceSectorId,
                    JSON_EXTRACT(so.meta, '$.destinationSectorId') as destSectorId
             FROM sector_objects so
             JOIN sectors s ON so.sector_id = s.id
             WHERE s.game_id = ? AND so.type = 'interstellar-gate'`,
            [gameId],
            (err2, gatesRows) => {
                if (err2) return res.status(500).json({ error: 'Failed to fetch gates' });
                const systems = sectors.map(s => ({ id: s.id, name: s.name }));
                const validSectorIds = new Set(sectors.map(s => s.id));
                const edgeSet = new Set();
                const gates = [];
                (gatesRows || []).forEach(r => {
                    const src = parseInt(r.sourceSectorId);
                    const dst = parseInt(r.destSectorId);
                    if (!Number.isFinite(src) || !Number.isFinite(dst)) return;
                    if (!validSectorIds.has(src) || !validSectorIds.has(dst)) return;
                    const a = Math.min(src, dst);
                    const b = Math.max(src, dst);
                    const key = `${a}-${b}`;
                    if (!edgeSet.has(key)) { edgeSet.add(key); gates.push({ source: a, target: b }); }
                });
                res.json({ systems, gates });
            }
        );
    });
});

// System facts
router.get('/system/:sectorId/facts', async (req, res) => {
    const { sectorId } = req.params;
    try {
        const { SystemFactsService } = require('../services/world/system-facts.service');
        const svc = new SystemFactsService();
        const facts = await svc.getFacts(sectorId);
        if (!facts) return res.status(404).json({ error: 'sector_not_found' });
        res.json(facts);
    } catch (e) {
        res.status(500).json({ error: 'facts_error' });
    }
});

module.exports = router;


