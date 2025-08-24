// Authoritative harvesting manager
const db = require('../../db');

const HarvestingManager = {
    async getNearbyResourceNodes(shipId, range = 3) {
        const r = Math.max(1, Math.floor(Number(range) || 3));
        const ship = await new Promise((resolve) => db.get('SELECT sector_id, x, y FROM sector_objects WHERE id = ?', [shipId], (e, r) => resolve(r)));
        if (!ship) return [];
        const nodes = await new Promise((resolve) => db.all(
            `SELECT rn.id, rn.sector_id, rn.x, rn.y, rn.resource_amount, rn.is_depleted,
                    rt.resource_name AS resource_name, rt.icon_emoji AS icon_emoji,
                    MAX(ABS(rn.x - ?), ABS(rn.y - ?)) AS distance
             FROM resource_nodes rn 
             JOIN resource_types rt ON rn.resource_type_id = rt.id
             WHERE rn.sector_id = ? AND ABS(rn.x - ?) <= ? AND ABS(rn.y - ?) <= ?
             ORDER BY distance ASC, rn.id ASC`,
            [ship.x, ship.y, ship.sector_id, ship.x, r, ship.y, r],
            (e, rows) => resolve(rows || [])
        ));
        return nodes;
    },

    async startHarvesting(shipId, resourceNodeId, currentTurn, baseRate = 1.0) {
        const ship = await new Promise((resolve) => db.get('SELECT id, sector_id, x, y FROM sector_objects WHERE id = ?', [shipId], (e, r) => resolve(r)));
        const node = await new Promise((resolve) => db.get('SELECT id, sector_id, x, y, is_depleted FROM resource_nodes WHERE id = ?', [resourceNodeId], (e, r) => resolve(r)));
        if (!ship || !node || ship.sector_id !== node.sector_id) return { success: false, error: 'Invalid ship/node' };
        if (node.is_depleted) return { success: false, error: 'Node depleted' };
        const distChebyshev = Math.max(Math.abs(ship.x - node.x), Math.abs(ship.y - node.y));
        if (distChebyshev > 3) {
            // Basic safety limit; ability executor should validate range precisely
            return { success: false, error: 'Node out of range' };
        }
        await new Promise((resolve) => db.run(
            `INSERT INTO harvesting_tasks (ship_id, resource_node_id, status, harvest_rate, total_harvested, started_turn)
             VALUES (?, ?, 'active', ?, 0, ?)
             ON CONFLICT(ship_id) DO UPDATE SET resource_node_id = excluded.resource_node_id, status = 'active'`,
            [shipId, resourceNodeId, Math.max(0, Number(baseRate) || 0), currentTurn],
            () => resolve()
        ));
        return { success: true };
    },

    async stopHarvesting(shipId) {
        await new Promise((resolve) => db.run('UPDATE harvesting_tasks SET status = ? WHERE ship_id = ?', ['paused', shipId], () => resolve()));
        return { success: true };
    },

    async processHarvestingForTurn(gameId, turnNumber) {
        const tasks = await new Promise((resolve) => db.all(
            `SELECT ht.ship_id, ht.resource_node_id, ht.harvest_rate, rn.resource_amount, rn.resource_type_id
             FROM harvesting_tasks ht
             JOIN sector_objects so ON so.id = ht.ship_id
             JOIN sectors s ON s.id = so.sector_id
             JOIN resource_nodes rn ON rn.id = ht.resource_node_id
             WHERE ht.status = 'active' AND s.game_id = ?`,
            [gameId],
            (e, r) => resolve(r || [])
        ));
        for (const t of tasks) {
            try {
                // Check for active mining effect for ramp and energy drain
                const effect = await new Promise((resolve) => db.get(
                    `SELECT effect_data FROM ship_status_effects WHERE ship_id = ? AND effect_key = 'mining_active' AND (expires_turn IS NULL OR expires_turn >= ?) ORDER BY id DESC LIMIT 1`,
                    [t.ship_id, turnNumber],
                    (e, r) => resolve(r)
                ));
                let baseRate = Number(t.harvest_rate || 1);
                let energyPerTurn = 0;
                let incrementPerTurn = 0;
                let maxBonus = 0;
                if (effect) {
                    const data = (() => { try { return JSON.parse(effect.effect_data || '{}'); } catch { return {}; } })();
                    baseRate = Number(baseRate || data.baseRate || 1);
                    energyPerTurn = Number(data.energyPerTurn || 0);
                    incrementPerTurn = Number(data.incrementPerTurn || 0);
                    maxBonus = Number(data.maxBonus || 0);
                }
                // Drain energy first; if insufficient, pause harvesting
                if (energyPerTurn > 0) {
                    const shipRow = await new Promise((resolve) => db.get('SELECT id, meta FROM sector_objects WHERE id = ?', [t.ship_id], (e, r) => resolve(r)));
                    if (shipRow) {
                        const meta = (() => { try { return JSON.parse(shipRow.meta || '{}'); } catch { return {}; } })();
                        const current = Number(meta.energy || 0);
                        if (current < energyPerTurn) {
                            await new Promise((resolve) => db.run('UPDATE harvesting_tasks SET status = ? WHERE ship_id = ?', ['paused', t.ship_id], () => resolve()));
                            continue;
                        }
                        if (typeof meta.maxEnergy === 'number') {
                            meta.energy = Math.max(0, Math.min(meta.maxEnergy, current - energyPerTurn));
                        } else {
                            meta.energy = Math.max(0, current - energyPerTurn);
                        }
                        await new Promise((resolve) => db.run('UPDATE sector_objects SET meta = ?, updated_at = ? WHERE id = ?', [JSON.stringify(meta), new Date().toISOString(), t.ship_id], () => resolve()));
                    }
                }
                // Apply ramp toward cap using harvesting_tasks.harvest_rate as the current rate
                const cap = Math.max(baseRate, baseRate + maxBonus);
                const nextRate = Math.min(cap, Math.max(0, Number(t.harvest_rate || baseRate)) + incrementPerTurn);
                if (nextRate !== t.harvest_rate) {
                    await new Promise((resolve) => db.run('UPDATE harvesting_tasks SET harvest_rate = ? WHERE ship_id = ?', [nextRate, t.ship_id], () => resolve()));
                    t.harvest_rate = nextRate;
                }
            } catch {}

            const perTurn = Math.ceil(t.harvest_rate || 1);
            const amount = Math.max(0, Math.min(t.resource_amount || 0, perTurn));
            if (amount <= 0) continue;
            await new Promise((resolve) => db.run('UPDATE resource_nodes SET resource_amount = resource_amount - ?, is_depleted = CASE WHEN resource_amount - ? <= 0 THEN 1 ELSE 0 END WHERE id = ?', [amount, amount, t.resource_node_id], () => resolve()));
            await new Promise((resolve) => db.run('UPDATE harvesting_tasks SET total_harvested = total_harvested + ? WHERE ship_id = ?', [amount, t.ship_id], () => resolve()));
            // Deposit into object_cargo for the ship
            await new Promise((resolve) => db.run(
                `INSERT INTO object_cargo (object_id, resource_type_id, quantity)
                 VALUES (?, ?, ?)
                 ON CONFLICT(object_id, resource_type_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
                [t.ship_id, t.resource_type_id, amount],
                () => resolve()
            ));
        }
        return { success: true };
    }
};

module.exports = { HarvestingManager };

