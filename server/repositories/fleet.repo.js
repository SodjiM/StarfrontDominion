const db = require('../db');

class FleetRepository {
    async listPlayerFleet(gameId, userId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT 
                    so.*, 
                    s.name as sector_name,
                    mo.movement_path, 
                    mo.eta_turns, 
                    mo.status as movement_status,
                    mo.warp_phase,
                    ht.status as harvesting_status,
                    rt.resource_name as harvesting_resource,
                    ht.harvest_rate
                FROM sector_objects so
                JOIN sectors s ON so.sector_id = s.id
                LEFT JOIN movement_orders mo 
                    ON mo.object_id = so.id 
                    AND mo.status IN ('active','blocked','completed','warp_preparing')
                    AND mo.created_at = (
                        SELECT MAX(mo2.created_at)
                        FROM movement_orders mo2
                        WHERE mo2.object_id = so.id 
                          AND mo2.status IN ('active','blocked','completed','warp_preparing')
                    )
                LEFT JOIN harvesting_tasks ht 
                    ON ht.ship_id = so.id AND ht.status IN ('active','paused')
                LEFT JOIN resource_nodes rn ON ht.resource_node_id = rn.id
                LEFT JOIN resource_types rt ON rn.resource_type_id = rt.id
                WHERE s.game_id = ? AND so.owner_id = ?
                ORDER BY s.name, so.type, so.id`,
                [gameId, userId],
                (err, rows) => err ? reject(err) : resolve(rows || [])
            );
        });
    }
}

module.exports = { FleetRepository };


