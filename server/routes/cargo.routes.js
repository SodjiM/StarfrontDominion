const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { CargoManager } = require('../services/game/cargo-manager');
const router = express.Router();

// Get object cargo (ships, structures, etc.)
router.get('/cargo/:objectId', (req, res) => {
    const { objectId } = req.params;
    const { userId } = req.query;

    db.get('SELECT type, meta, owner_id FROM sector_objects WHERE id = ?', [objectId], (err, object) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!object) return res.status(404).json({ error: 'Object not found or not owned by player' });
        let allowed = Number(object.owner_id) === Number(userId);
        if (!allowed) { try { const m = JSON.parse(object.meta || '{}'); allowed = !!m.publicAccess; } catch {} }
        if (!allowed) return res.status(404).json({ error: 'Object not found or not owned by player' });
        const useLegacyTable = object.type === 'ship';
        CargoManager.getObjectCargo(objectId, useLegacyTable)
            .then(cargo => res.json({ cargo }))
            .catch(() => res.status(500).json({ error: 'Failed to get object cargo' }));
    });
});

// Transfer resources between objects
router.post('/transfer', async (req, res) => {
    const schema = z.object({
        fromObjectId: z.coerce.number().int().positive(),
        toObjectId: z.coerce.number().int().positive(),
        resourceName: z.string().min(1),
        quantity: z.coerce.number().int().positive(),
        userId: z.coerce.number().int().positive()
    });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid_payload', issues: parse.error.issues });
    const { fromObjectId, toObjectId, resourceName, quantity, userId } = parse.data;
    try {
        const result = await CargoManager.transferResources(fromObjectId, toObjectId, resourceName, quantity, userId);
        if (!result.success) return res.status(400).json({ error: result.error, details: result });
        res.json({ success: true, message: `Successfully transferred ${result.quantityTransferred} ${result.resourceName} from ${result.fromObject} to ${result.toObject}`, transfer: result });
    } catch (e) {
        res.status(500).json({ error: 'Failed to transfer resources' });
    }
});

module.exports = router;


