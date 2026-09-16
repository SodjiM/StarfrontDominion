const express = require('express');
const db = require('../db');
const router = express.Router();
require('../middleware/auth').protectRouter(router);
const CONFIG = require('../config').loadConfig ? require('../config').loadConfig() : null;

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
        const facts = await SystemFactsService.getSectorSummary(sectorId, req.userId);
        if (!facts) return res.status(404).json({ error: 'sector_not_found' });
        res.json(facts);
    } catch (e) {
        if (e?.status) return res.status(e.status).json({ error: e.message });
        console.error('facts_error:', e);
        res.status(500).json({ error: 'facts_error' });
    }
});

// Declare or withdraw intent to address a shared regional incident. These
// routes do not resolve incidents; future utility missions provide that proof.
router.post('/system/:sectorId/incidents/:incidentId/response', async (req, res) => {
    const sectorId = Number(req.params.sectorId);
    const incidentId = Number(req.params.incidentId);
    try {
        const turn = await currentTurnForSector(sectorId);
        if (turn == null) return res.status(404).json({ error: 'sector_not_found' });
        const { RegionIncidentService } = require('../services/world/region-incident.service');
        const result = await new RegionIncidentService(db).beginResponse({
            incidentId,
            sectorId,
            userId: req.userId,
            turnNumber: turn
        });
        if (!result.success) return res.status(incidentResponseStatus(result.error)).json({ error: result.error });
        res.json(result);
    } catch (error) {
        console.error('incident_response_error:', error);
        res.status(500).json({ error: 'incident_response_error' });
    }
});

router.delete('/system/:sectorId/incidents/:incidentId/response', async (req, res) => {
    const sectorId = Number(req.params.sectorId);
    const incidentId = Number(req.params.incidentId);
    try {
        const turn = await currentTurnForSector(sectorId);
        if (turn == null) return res.status(404).json({ error: 'sector_not_found' });
        const { RegionIncidentService } = require('../services/world/region-incident.service');
        const result = await new RegionIncidentService(db).cancelResponse({
            incidentId,
            sectorId,
            userId: req.userId,
            turnNumber: turn
        });
        if (!result.success) return res.status(incidentResponseStatus(result.error)).json({ error: result.error });
        res.json(result);
    } catch (error) {
        console.error('incident_response_cancel_error:', error);
        res.status(500).json({ error: 'incident_response_error' });
    }
});

// Admin: re-run resource node spawning for a sector (on-demand)
router.post('/system/:sectorId/respawn-resources', async (req, res) => {
    const { sectorId } = req.params;
    try {
        const secret = req.header('x-admin-secret') || req.query.adminSecret || req.body?.adminSecret;
        const adminOk = CONFIG?.adminSecret ? (secret === CONFIG.adminSecret) : false;
        if (!adminOk) return res.status(403).json({ error: 'forbidden' });
        const { spawnNodesForSector } = require('../services/world/resource-node-generator');
        const out = await spawnNodesForSector(Number(sectorId));
        res.json({ success: true, result: out });
    } catch (e) {
        console.error('respawn-resources error:', e);
        res.status(500).json({ error: 'server_error' });
    }
});

module.exports = router;

function currentTurnForSector(sectorId) {
    return new Promise((resolve, reject) => db.get(
        `SELECT t.turn_number
         FROM sectors s
         JOIN turns t ON t.game_id=s.game_id
         WHERE s.id=? ORDER BY t.turn_number DESC LIMIT 1`,
        [sectorId],
        (error, row) => error ? reject(error) : resolve(row ? Number(row.turn_number) : null)
    ));
}

function incidentResponseStatus(error) {
    if (error === 'not_a_game_member') return 403;
    if (error === 'incident_not_found' || error === 'response_not_found') return 404;
    if (error === 'incident_not_active' || error === 'response_already_completed') return 409;
    return 400;
}
