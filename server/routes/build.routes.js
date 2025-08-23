const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { CargoManager } = require('../services/game/cargo-manager');
const { BuildService } = require('../services/game/build.service');
const router = express.Router();

router.post('/build-ship', async (req, res) => {
    const schema = z.object({ stationId: z.coerce.number().int().positive(), blueprintId: z.string().min(1), userId: z.coerce.number().int().positive(), freeBuild: z.boolean().optional() });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
    const { stationId, blueprintId, userId, freeBuild } = parsed.data;
    try {
        const svc = new BuildService();
        const result = await svc.buildShip({ stationId, blueprintId, userId, freeBuild });
        if (!result.success) return res.status(result.httpStatus || 400).json({ error: result.error, ...(result.details ? { details: result.details } : {}) });
        const { shipName, shipId, consumed, warning } = result;
        const response = { success: true, shipName, shipId };
        if (consumed) response.consumed = consumed;
        if (warning) response.warning = warning;
        res.json(response);
    } catch (e) {
        console.error('Error building ship:', e);
        res.status(500).json({ error: 'Failed to create ship' });
    }
});

router.post('/build-structure', async (req, res) => {
    const schema = z.object({ stationId: z.coerce.number().int().positive(), structureType: z.string().min(1), cost: z.coerce.number().int().nonnegative(), userId: z.coerce.number().int().positive() });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
    const { stationId, structureType, cost, userId } = parsed.data;
    try {
        const svc = new BuildService();
        const result = await svc.buildStructure({ stationId, structureType, cost, userId });
        if (!result.success) return res.status(result.httpStatus || 400).json({ error: result.error });
        res.json({ success: true, structureName: result.structureName });
    } catch (e) {
        console.error('Error building structure:', e);
        res.status(500).json({ error: 'Failed to build structure' });
    }
});

router.post('/deploy-structure', async (req, res) => {
    const schema = z.object({ shipId: z.coerce.number().int().positive(), structureType: z.string().min(1), userId: z.coerce.number().int().positive() });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
    const { shipId, structureType, userId } = parsed.data;
    try {
        const svc = new BuildService();
        const result = await svc.deployStructure({ shipId, structureType, userId });
        if (!result.success) return res.status(result.httpStatus || 400).json({ error: result.error });
        const { structureName, structureId, warning } = result;
        const out = { success: true, structureName, structureId };
        if (warning) out.warning = warning;
        res.json(out);
    } catch (e) {
        console.error('Error deploying structure:', e);
        res.status(500).json({ error: 'Failed to deploy structure' });
    }
});

router.post('/build-basic-explorer', (req, res) => {
    const schema = z.object({ stationId: z.coerce.number().int().positive(), userId: z.coerce.number().int().positive() });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
    const { stationId, userId } = parsed.data;
    db.get('SELECT * FROM sector_objects WHERE id = ? AND owner_id = ? AND type = ?', [stationId, userId, 'station'], async (err, station) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!station) return res.status(404).json({ error: 'Station not found or not owned by player' });
        try {
            const currentTurn = await new Promise(r=>db.get('SELECT turn_number FROM turns WHERE game_id = (SELECT game_id FROM sectors WHERE id = ?) ORDER BY turn_number DESC LIMIT 1', [station.sector_id], (e,row)=>r(row?.turn_number || 1)));
            const gameId = await new Promise(r=>db.get('SELECT game_id FROM sectors WHERE id = ?', [station.sector_id], (e,row)=>r(row?.game_id)));
            const { computePilotStats } = require('../services/game/game-world.service');
            const stats = await computePilotStats(gameId, userId, currentTurn);
            if ((stats.available || 0) < 1) return res.status(400).json({ error: 'No available pilots to command a new ship' });
        } catch {}
        CargoManager.removeResourceFromCargo(stationId, 'rock', 1, false)
            .then(result => {
                if (!result.success) return res.status(400).json({ error: 'Insufficient resources' });
                const shipMetaObj = { name: 'Explorer', hp: 50, maxHp: 50, scanRange: 50, movementSpeed: 4, cargoCapacity: 10, harvestRate: 1.0, canMine: true, canActiveScan: false, shipType: 'explorer', pilotCost: 1 };
                const shipMeta = JSON.stringify(shipMetaObj);
                const spawnX = station.x + (Math.random() < 0.5 ? -1 : 1);
                const spawnY = station.y + (Math.random() < 0.5 ? -1 : 1);
                db.run(
                    'INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta, scan_range, movement_speed, can_active_scan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [station.sector_id, 'ship', spawnX, spawnY, userId, shipMeta, shipMetaObj.scanRange, shipMetaObj.movementSpeed, 0],
                    function(shipErr) {
                        if (shipErr) return res.status(500).json({ error: 'Failed to create ship' });
                        const shipId = this.lastID;
                        CargoManager.initializeShipCargo(shipId, shipMetaObj.cargoCapacity)
                            .then(() => res.json({ success: true, shipName: shipMetaObj.name, shipId }))
                            .catch(() => res.json({ success: true, shipName: shipMetaObj.name, shipId, warning: 'Ship created but cargo initialization failed' }));
                    }
                );
            })
            .catch(() => res.status(500).json({ error: 'Failed to consume resources' }));
    });
});

module.exports = router;


