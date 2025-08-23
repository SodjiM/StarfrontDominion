// Authoritative harvesting manager
const db = require('../../db');

const HarvestingManager = {
    async getNearbyResourceNodes(shipId) {
        const ship = await new Promise((resolve) => db.get('SELECT sector_id, x, y FROM sector_objects WHERE id = ?', [shipId], (e, r) => resolve(r)));
        if (!ship) return [];
        const nodes = await new Promise((resolve) => db.all(
            `SELECT rn.id, rn.sector_id, rn.x, rn.y, rt.resource_name AS resourceName
             FROM resource_nodes rn JOIN resource_types rt ON rn.resource_type_id = rt.id
             WHERE rn.sector_id = ? AND ABS(rn.x - ?) <= 3 AND ABS(rn.y - ?) <= 3`,
            [ship.sector_id, ship.x, ship.y],
            (e, r) => resolve(r || [])
        ));
        return nodes;
    },

    async startHarvesting(shipId, resourceNodeId, currentTurn) {
        const ship = await new Promise((resolve) => db.get('SELECT id, sector_id, x, y FROM sector_objects WHERE id = ?', [shipId], (e, r) => resolve(r)));
        const node = await new Promise((resolve) => db.get('SELECT id, sector_id, x, y, is_depleted FROM resource_nodes WHERE id = ?', [resourceNodeId], (e, r) => resolve(r)));
        if (!ship || !node || ship.sector_id !== node.sector_id) return { success: false, error: 'Invalid ship/node' };
        if (node.is_depleted) return { success: false, error: 'Node depleted' };
        const dist = Math.abs(ship.x - node.x) + Math.abs(ship.y - node.y);
        if (dist > 1) return { success: false, error: 'Not adjacent to node' };
        await new Promise((resolve) => db.run(
            `INSERT INTO harvesting_tasks (ship_id, resource_node_id, status, harvest_rate, total_harvested, started_turn)
             VALUES (?, ?, 'active', 1.0, 0, ?)
             ON CONFLICT(ship_id) DO UPDATE SET resource_node_id = excluded.resource_node_id, status = 'active'`,
            [shipId, resourceNodeId, currentTurn],
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
            const amount = Math.max(0, Math.min(t.resource_amount || 0, Math.ceil(t.harvest_rate || 1)));
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

