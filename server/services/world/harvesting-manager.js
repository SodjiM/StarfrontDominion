const scale = require('../../../client/utils/physical-scale');
const { CargoManager } = require('../game/cargo-manager');
// Authoritative harvesting manager
const db = require('../../db');

const HarvestingManager = {
    async getNearbyResourceNodes(shipId, range = 3) {
        const r = Math.max(1, Math.floor(Number(range) || 3));
        const ship = await new Promise((resolve) => db.get(
            `SELECT so.*, s.game_id
             FROM sector_objects so JOIN sectors s ON s.id = so.sector_id
             WHERE so.id = ?`,
            [shipId], (e, row) => resolve(row)
        ));
        if (!ship) return [];
        const reach = r + scale.width(ship);
        const { GameWorldManager } = require('../game/game-world.service');
        const nodes = await GameWorldManager.getVisibleResourceNodes(ship.game_id, ship.owner_id, ship.sector_id, {
            bounds: {
                minX: ship.x - reach,
                maxX: ship.x + reach,
                minY: ship.y - reach,
                maxY: ship.y + reach
            }
        });
        return nodes.map(node=>({...node,distance:scale.gap(ship,node,'chebyshev')})).filter(node=>node.distance<=r).sort((a,b)=>a.distance-b.distance||a.id-b.id);
    },

    async startHarvesting(shipId, resourceNodeId, currentTurn, baseRate = 1.0) {
        const ship = await new Promise((resolve) => db.get('SELECT * FROM sector_objects WHERE id = ?', [shipId], (e, r) => resolve(r)));
        const node = await new Promise((resolve) => db.get('SELECT id, sector_id, x, y, is_depleted FROM resource_nodes WHERE id = ?', [resourceNodeId], (e, r) => resolve(r)));
        if (!ship || !node || ship.sector_id !== node.sector_id) return { success: false, error: 'Invalid ship/node' };
        if (node.is_depleted) return { success: false, error: 'Node depleted' };
        const distChebyshev = scale.gap(ship,node,'chebyshev');
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
        // An explicit stop is terminal. Keeping the task paused makes every
        // movement/queue guard treat the ship as still occupied forever.
        await new Promise((resolve) => db.run('UPDATE harvesting_tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE ship_id = ? AND status IN (\'active\', \'paused\')', ['cancelled', shipId], () => resolve()));
        return { success: true };
    },

    async processHarvestingForTurn(gameId, turnNumber) {
        const policyModifiersByUser = new Map();
        await new Promise((resolve) => db.run(`CREATE TABLE IF NOT EXISTS turn_harvest_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL, turn_number INTEGER NOT NULL,
            ship_id INTEGER NOT NULL, resource_type_id INTEGER NOT NULL, amount INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`, () => resolve()));
        const tasks = await new Promise((resolve) => db.all(
            `SELECT ht.ship_id, ht.resource_node_id, ht.harvest_rate, so.owner_id, rn.resource_amount, rn.resource_type_id,
                    rt.resource_name, rt.base_size
             FROM harvesting_tasks ht
             JOIN sector_objects so ON so.id = ht.ship_id
             JOIN sectors s ON s.id = so.sector_id
             JOIN resource_nodes rn ON rn.id = ht.resource_node_id
             JOIN resource_types rt ON rt.id = rn.resource_type_id
             WHERE ht.status = 'active' AND s.game_id = ?`,
            [gameId],
            (e, r) => resolve(r || [])
        ));
        for (const t of tasks) {
            const ship=await new Promise((r,j)=>db.get('SELECT * FROM sector_objects WHERE id=?',[t.ship_id],(e,v)=>e?j(e):r(v)));
            const node=await new Promise((r,j)=>db.get('SELECT * FROM resource_nodes WHERE id=?',[t.resource_node_id],(e,v)=>e?j(e):r(v)));
            if(!ship||!node||ship.sector_id!==node.sector_id||scale.gap(ship,node,'chebyshev')>3) {
                await this.stopHarvesting(t.ship_id); continue;
            }
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
            let amount = Math.max(0, Math.min(t.resource_amount || 0, perTurn));
            try {
                const { getOperationalBonuses } = require('../game/station-effects.service');
                const bonuses = await getOperationalBonuses(db, ship, { resourceName: t.resource_name });
                amount = Math.max(0, Math.min(t.resource_amount || 0, Math.ceil(amount * (1 + Math.min(0.5, bonuses.resourceYield || 0)))));
            } catch {}
            if (!policyModifiersByUser.has(Number(t.owner_id))) {
                const { getActivePolicyModifiers } = require('../game/policy.service');
                policyModifiersByUser.set(Number(t.owner_id), await getActivePolicyModifiers(gameId, Number(t.owner_id), db));
            }
            const policyYield = Math.max(0, Math.min(1, Number(policyModifiersByUser.get(Number(t.owner_id))?.harvestYieldMultiplier || 0)));
            amount = Math.max(0, Math.min(t.resource_amount || 0, amount + Math.floor(amount * policyYield)));
            if (amount <= 0) continue;
            const cargo = await CargoManager.getObjectCargo(t.ship_id);
            const baseSize = Number(t.base_size || 1);
            if (cargo.spaceUsed + amount * baseSize > cargo.capacity) continue;
            await new Promise((resolve) => db.run('UPDATE resource_nodes SET resource_amount = resource_amount - ?, is_depleted = CASE WHEN resource_amount - ? <= 0 THEN 1 ELSE 0 END WHERE id = ?', [amount, amount, t.resource_node_id], () => resolve()));
            const added = await CargoManager.addResourceToCargo(t.ship_id, t.resource_name, amount);
            if (!added?.success) {
                await new Promise((resolve) => db.run('UPDATE resource_nodes SET resource_amount = resource_amount + ?, is_depleted = 0 WHERE id = ?', [amount, t.resource_node_id], () => resolve()));
                continue;
            }
            await new Promise((resolve) => db.run('UPDATE harvesting_tasks SET total_harvested = total_harvested + ? WHERE ship_id = ?', [amount, t.ship_id], () => resolve()));
            await new Promise((resolve) => db.run('INSERT INTO turn_harvest_events(game_id,turn_number,ship_id,resource_type_id,amount) VALUES(?,?,?,?,?)', [gameId,turnNumber,t.ship_id,t.resource_type_id,amount], () => resolve()));
        }
        return { success: true };
    }
};

module.exports = { HarvestingManager };
