const express = require('express');
const { z } = require('zod');
const { BuildService, STRUCTURE_BUILD_COSTS } = require('../services/game/build.service');
const router = express.Router();
require('../middleware/auth').protectRouter(router);

router.get('/structure-costs', (req, res) => res.json({ costs: STRUCTURE_BUILD_COSTS }));

router.post('/build-ship-preview', async (req, res) => {
    const schema = z.object({ stationId: z.coerce.number().int().positive(), blueprintId: z.string().min(1), userId: z.coerce.number().int().positive() });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
    try {
        const result = await new BuildService().canBuildShip(parsed.data);
        res.json(result);
    } catch (e) {
        console.error('Error previewing ship build:', e);
        res.status(500).json({ error: 'Failed to preview ship build' });
    }
});

router.get('/ship-builds/:stationId', async (req, res) => {
    try {
        const result = await new BuildService().listShipBuilds({ stationId: Number(req.params.stationId), userId: req.userId, includeCompleted: req.query.history === '1' });
        if (!result.success) return res.status(result.httpStatus || 400).json({ error: result.error });
        res.json(result);
    } catch (e) { console.error('Error listing ship builds:', e); res.status(500).json({ error: 'Failed to list ship builds' }); }
});

router.post('/cancel-ship-build', async (req, res) => {
    const schema = z.object({ buildId: z.coerce.number().int().positive(), userId: z.coerce.number().int().positive() });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
    try {
        const result = await new BuildService().cancelShipBuild(parsed.data);
        if (!result.success) return res.status(result.httpStatus || 400).json({ error: result.error });
        res.json(result);
    } catch (e) { console.error('Error cancelling ship build:', e); res.status(500).json({ error: 'Failed to cancel ship build' }); }
});

router.post('/build-ship', async (req, res) => {
    const schema = z.object({ stationId: z.coerce.number().int().positive(), blueprintId: z.string().min(1), userId: z.coerce.number().int().positive(), freeBuild: z.boolean().optional(), clientOrderId: z.string().min(1).max(100).optional() });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
    const { stationId, blueprintId, userId, freeBuild, clientOrderId } = parsed.data;
    try {
        const svc = new BuildService();
        const result = await svc.buildShip({ stationId, blueprintId, userId, freeBuild, clientOrderId });
        if (!result.success) return res.status(result.httpStatus || 400).json({ error: result.error, ...(result.details ? { details: result.details } : {}) });
        const { shipName, shipId, buildId, completionTurn, consumed, warning } = result;
        const response = { success: true, shipName, ...(shipId ? { shipId } : {}), ...(buildId ? { buildId, completionTurn, status: 'queued' } : {}) };
        if (consumed) response.consumed = consumed;
        if (warning) response.warning = warning;
        res.json(response);
    } catch (e) {
        console.error('Error building ship:', e);
        res.status(500).json({ error: 'Failed to create ship' });
    }
});

router.post('/build-structure', async (req, res) => {
    const schema = z.object({ stationId: z.coerce.number().int().positive(), structureType: z.string().min(1), userId: z.coerce.number().int().positive() });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
    const { stationId, structureType, userId } = parsed.data;
    try {
        const svc = new BuildService();
        const result = await svc.buildStructure({ stationId, structureType, userId });
        if (!result.success) return res.status(result.httpStatus || 400).json({ error: result.error });
        res.json({ success: true, structureName: result.structureName });
    } catch (e) {
        console.error('Error building structure:', e);
        res.status(500).json({ error: 'Failed to build structure' });
    }
});

router.post('/deploy-structure', async (req, res) => {
    const schema = z.object({ shipId: z.coerce.number().int().positive(), structureType: z.string().min(1), anchorObjectId: z.coerce.number().int().positive().optional(), userId: z.coerce.number().int().positive() });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
    const { shipId, structureType, anchorObjectId, userId } = parsed.data;
    try {
        const svc = new BuildService();
        const result = await svc.deployStructure({ shipId, structureType, anchorObjectId, userId });
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

module.exports = router;
