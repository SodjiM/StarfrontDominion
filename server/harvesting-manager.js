// Harvesting Manager - Handles resource gathering operations
// Universal system for mining rocks, collecting gas, harvesting energy, and salvaging

const db = require('./db');
const { CargoManager } = require('./cargo-manager');

/**
 * HarvestingManager - Manages resource harvesting operations and adjacency checks
 */
class HarvestingManager {
    
    /**
     * Start a harvesting operation
     * @param {number} shipId - Ship performing the harvest
     * @param {number} resourceNodeId - Resource node to harvest
     * @param {number} currentTurn - Current game turn
     * @returns {Object} Result with success status
     */
    static async startHarvesting(shipId, resourceNodeId, currentTurn) {
        try {
            // Validate ship exists and get its properties
            const ship = await this.getShipInfo(shipId);
            if (!ship) {
                return { success: false, error: 'Ship not found' };
            }
            
            // Validate resource node exists and is harvestable
            const resourceNode = await this.getResourceNodeInfo(resourceNodeId);
            if (!resourceNode) {
                return { success: false, error: 'Resource node not found' };
            }
            
            if (resourceNode.is_depleted || resourceNode.resource_amount <= 0) {
                return { success: false, error: 'Resource node is depleted' };
            }
            
            // Check adjacency (ship must be within 1 tile of resource node)
            const isAdjacent = this.checkAdjacency(ship, resourceNode);
            if (!isAdjacent) {
                return { 
                    success: false, 
                    error: 'Ship must be adjacent to resource node to harvest',
                    distance: this.calculateDistance(ship, resourceNode)
                };
            }
            
            // Check if ship is already harvesting
            const existingTask = await this.getActiveHarvestingTask(shipId);
            if (existingTask) {
                return { 
                    success: false, 
                    error: 'Ship is already harvesting. Stop current operation first.',
                    currentTask: existingTask
                };
            }
            
            // Calculate harvest rate (base rate * ship modifier * node difficulty)
            const harvestRate = this.calculateHarvestRate(ship, resourceNode);
            
            // Create harvesting task
            const taskId = await this.createHarvestingTask(shipId, resourceNodeId, currentTurn, harvestRate);
            
            console.log(`⛏️ Started harvesting: Ship ${shipId} → Node ${resourceNodeId} at rate ${harvestRate}/turn`);
            
            return {
                success: true,
                taskId,
                harvestRate,
                resourceType: resourceNode.resource_name,
                estimatedYield: Math.min(harvestRate, resourceNode.resource_amount)
            };
            
        } catch (error) {
            console.error('Error starting harvesting:', error);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Stop a harvesting operation
     * @param {number} shipId - Ship to stop harvesting
     * @returns {Object} Result with success status
     */
    static async stopHarvesting(shipId) {
        try {
            const task = await this.getActiveHarvestingTask(shipId);
            if (!task) {
                return { success: false, error: 'Ship is not currently harvesting' };
            }
            
            // Update task status to cancelled
            await this.updateHarvestingTaskStatus(task.id, 'cancelled');
            
            console.log(`🛑 Stopped harvesting: Ship ${shipId}, total harvested: ${task.total_harvested}`);
            
            return {
                success: true,
                totalHarvested: task.total_harvested,
                resourceType: task.resource_name
            };
            
        } catch (error) {
            console.error('Error stopping harvesting:', error);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Process harvesting for a single turn (called during turn resolution)
     * @param {number} gameId - Game ID
     * @param {number} turnNumber - Current turn number
     */
    static async processHarvestingForTurn(gameId, turnNumber) {
        return new Promise((resolve, reject) => {
            // Get all active harvesting tasks for this game
            db.all(
                `SELECT ht.*, rn.resource_amount, rn.x as node_x, rn.y as node_y,
                        so.x as ship_x, so.y as ship_y, rt.resource_name
                 FROM harvesting_tasks ht
                 JOIN resource_nodes rn ON ht.resource_node_id = rn.id
                 JOIN sector_objects so ON ht.ship_id = so.id
                 JOIN sectors s ON so.sector_id = s.id
                 JOIN resource_types rt ON rn.resource_type_id = rt.id
                 WHERE s.game_id = ? AND ht.status = 'active'`,
                [gameId],
                async (err, tasks) => {
                    if (err) {
                        console.error('Error getting harvesting tasks:', err);
                        return reject(err);
                    }
                    
                    console.log(`⛏️ Processing ${tasks.length} harvesting tasks for turn ${turnNumber}`);
                    
                    const results = [];
                    
                    for (const task of tasks) {
                        try {
                            const result = await this.processSingleHarvestingTask(task, turnNumber);
                            results.push(result);
                        } catch (error) {
                            console.error(`Error processing harvesting task ${task.id}:`, error);
                            results.push({
                                taskId: task.id,
                                shipId: task.ship_id,
                                status: 'error',
                                error: error.message
                            });
                        }
                    }
                    
                    console.log(`✅ Harvesting processing complete: ${results.length} tasks processed`);
                    resolve(results);
                }
            );
        });
    }
    
    /**
     * Process a single harvesting task for one turn
     */
    static async processSingleHarvestingTask(task, turnNumber) {
        // Check if ship is still adjacent to resource node
        const ship = { x: task.ship_x, y: task.ship_y };
        const node = { x: task.node_x, y: task.node_y };
        
        if (!this.checkAdjacency(ship, node)) {
            // Ship moved away, cancel harvesting
            await this.updateHarvestingTaskStatus(task.id, 'cancelled');
            console.log(`🚶 Ship ${task.ship_id} moved away from resource node, cancelling harvest`);
            
            return {
                taskId: task.id,
                shipId: task.ship_id,
                status: 'cancelled',
                reason: 'ship_moved'
            };
        }
        
        // Check if resource node is depleted
        if (task.resource_amount <= 0) {
            await this.updateHarvestingTaskStatus(task.id, 'completed');
            console.log(`⚫ Resource node depleted, completing harvest task ${task.id}`);
            
            return {
                taskId: task.id,
                shipId: task.ship_id,
                status: 'completed',
                reason: 'node_depleted'
            };
        }
        
        // Calculate actual harvest amount (limited by available resources)
        const harvestAmount = Math.min(task.harvest_rate, task.resource_amount);
        
        // Try to add resources to ship cargo
        const cargoResult = await CargoManager.addResourceToCargo(task.ship_id, task.resource_name, harvestAmount);
        
        let actualHarvested = 0;
        
        if (cargoResult.success) {
            actualHarvested = harvestAmount;
        } else if (cargoResult.maxQuantity > 0) {
            // Cargo partially full - harvest what we can
            const partialResult = await CargoManager.addResourceToCargo(task.ship_id, task.resource_name, cargoResult.maxQuantity);
            if (partialResult.success) {
                actualHarvested = cargoResult.maxQuantity;
            }
        }
        
        if (actualHarvested > 0) {
            // Update resource node (reduce available resources)
            await this.updateResourceNodeAmount(task.resource_node_id, -actualHarvested);
            
            // Update harvesting task progress
            await this.updateHarvestingTaskProgress(task.id, actualHarvested);
            
            console.log(`⛏️ Ship ${task.ship_id} harvested ${actualHarvested} ${task.resource_name}`);
        }
        
        // Check if cargo is full and pause harvesting if needed
        if (!cargoResult.success && cargoResult.maxQuantity === 0) {
            await this.updateHarvestingTaskStatus(task.id, 'paused');
            console.log(`📦 Ship ${task.ship_id} cargo full, pausing harvest`);
            
            return {
                taskId: task.id,
                shipId: task.ship_id,
                status: 'paused',
                reason: 'cargo_full',
                harvested: actualHarvested
            };
        }
        
        return {
            taskId: task.id,
            shipId: task.ship_id,
            status: 'active',
            harvested: actualHarvested,
            resourceType: task.resource_name
        };
    }
    
    /**
     * Check if ship is adjacent to resource node (within 1 tile)
     */
    static checkAdjacency(ship, resourceNode) {
        const distance = this.calculateDistance(ship, resourceNode);
        return distance <= 1;
    }
    
    /**
     * Calculate distance between two objects
     */
    static calculateDistance(obj1, obj2) {
        return Math.sqrt(Math.pow(obj1.x - obj2.x, 2) + Math.pow(obj1.y - obj2.y, 2));
    }
    
    /**
     * Calculate harvest rate based on ship and node properties
     */
    static calculateHarvestRate(ship, resourceNode) {
        const shipMeta = JSON.parse(ship.meta || '{}');
        const nodeMeta = JSON.parse(resourceNode.meta || '{}');
        
        const baseRate = shipMeta.harvestRate || 1.0;
        const difficulty = nodeMeta.difficulty || resourceNode.harvest_difficulty || 1.0;
        
        return Math.max(0.1, baseRate * difficulty);
    }
    
    /**
     * Get ship information
     */
    static async getShipInfo(shipId) {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM sector_objects WHERE id = ? AND type = "ship"', [shipId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }
    
    /**
     * Get resource node information
     */
    static async getResourceNodeInfo(resourceNodeId) {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT rn.*, rt.resource_name, rt.category
                 FROM resource_nodes rn
                 JOIN resource_types rt ON rn.resource_type_id = rt.id
                 WHERE rn.id = ?`,
                [resourceNodeId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }
    
    /**
     * Get active harvesting task for a ship
     */
    static async getActiveHarvestingTask(shipId) {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT ht.*, rt.resource_name
                 FROM harvesting_tasks ht
                 JOIN resource_nodes rn ON ht.resource_node_id = rn.id
                 JOIN resource_types rt ON rn.resource_type_id = rt.id
                 WHERE ht.ship_id = ? AND ht.status IN ('active', 'paused')`,
                [shipId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }
    
    /**
     * Create a new harvesting task
     */
    static async createHarvestingTask(shipId, resourceNodeId, startTurn, harvestRate) {
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO harvesting_tasks (ship_id, resource_node_id, started_turn, harvest_rate, status)
                 VALUES (?, ?, ?, ?, 'active')`,
                [shipId, resourceNodeId, startTurn, harvestRate],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }
    
    /**
     * Update harvesting task status
     */
    static async updateHarvestingTaskStatus(taskId, status) {
        return new Promise((resolve, reject) => {
            db.run(
                'UPDATE harvesting_tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [status, taskId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
    
    /**
     * Update harvesting task progress
     */
    static async updateHarvestingTaskProgress(taskId, harvestedAmount) {
        return new Promise((resolve, reject) => {
            db.run(
                'UPDATE harvesting_tasks SET total_harvested = total_harvested + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [harvestedAmount, taskId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
    
    /**
     * Update resource node amount
     */
    static async updateResourceNodeAmount(nodeId, amountDelta) {
        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE resource_nodes 
                 SET resource_amount = MAX(0, resource_amount + ?),
                     is_depleted = CASE WHEN (resource_amount + ?) <= 0 THEN 1 ELSE 0 END
                 WHERE id = ?`,
                [amountDelta, amountDelta, nodeId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
    
    /**
     * Get harvestable resource nodes near a ship
     */
    static async getNearbyResourceNodes(shipId, range = 1) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT rn.*, rt.resource_name, rt.icon_emoji, rt.color_hex,
                        ABS(rn.x - so.x) + ABS(rn.y - so.y) as distance
                 FROM resource_nodes rn
                 JOIN resource_types rt ON rn.resource_type_id = rt.id
                 JOIN sector_objects so ON rn.sector_id = so.sector_id
                 WHERE so.id = ? AND so.type = 'ship'
                 AND ABS(rn.x - so.x) <= ? AND ABS(rn.y - so.y) <= ?
                 AND rn.resource_amount > 0 AND rn.is_depleted = 0
                 ORDER BY distance`,
                [shipId, range, range],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }
}

module.exports = { HarvestingManager };