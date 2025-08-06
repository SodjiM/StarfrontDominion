// Cargo Manager - Handles ship inventory and cargo operations
// Universal system for managing resources, capacity limits, and cargo operations

const db = require('./db');

/**
 * CargoManager - Manages ship cargo, capacity limits, and resource operations
 */
class CargoManager {
    
    /**
     * Initialize cargo system for a ship (add default cargo capacity to metadata)
     * @param {number} shipId - Ship ID
     * @param {number} cargoCapacity - Maximum cargo capacity (default: 10)
     */
    static async initializeShipCargo(shipId, cargoCapacity = 10) {
        return new Promise((resolve, reject) => {
            // Get current ship metadata
            db.get('SELECT meta FROM sector_objects WHERE id = ?', [shipId], (err, ship) => {
                if (err || !ship) {
                    reject(err || new Error('Ship not found'));
                    return;
                }
                
                const meta = JSON.parse(ship.meta || '{}');
                
                // Add cargo capacity if not already present
                if (!meta.cargoCapacity) {
                    meta.cargoCapacity = cargoCapacity;
                    
                    // Update ship metadata
                    db.run(
                        'UPDATE sector_objects SET meta = ? WHERE id = ?',
                        [JSON.stringify(meta), shipId],
                        (err) => {
                            if (err) {
                                reject(err);
                            } else {
                                console.log(`📦 Initialized cargo system for ship ${shipId} with capacity ${cargoCapacity}`);
                                resolve();
                            }
                        }
                    );
                } else {
                    resolve(); // Already initialized
                }
            });
        });
    }
    
    /**
     * Get ship's current cargo status
     * @param {number} shipId - Ship ID
     * @returns {Object} Cargo status with items, capacity, and space used
     */
    static async getShipCargo(shipId) {
        return new Promise((resolve, reject) => {
            // Get ship cargo capacity from metadata
            db.get('SELECT meta FROM sector_objects WHERE id = ?', [shipId], (err, ship) => {
                if (err || !ship) {
                    reject(err || new Error('Ship not found'));
                    return;
                }
                
                const meta = JSON.parse(ship.meta || '{}');
                const cargoCapacity = meta.cargoCapacity || 10;
                
                // Get all cargo items for this ship
                db.all(
                    `SELECT sc.*, rt.resource_name, rt.category, rt.base_size, rt.icon_emoji, rt.color_hex
                     FROM ship_cargo sc
                     JOIN resource_types rt ON sc.resource_type_id = rt.id
                     WHERE sc.ship_id = ? AND sc.quantity > 0`,
                    [shipId],
                    (err, cargoItems) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        
                        // Calculate space used
                        let spaceUsed = 0;
                        cargoItems.forEach(item => {
                            spaceUsed += item.quantity * item.base_size;
                        });
                        
                        resolve({
                            shipId,
                            capacity: cargoCapacity,
                            spaceUsed,
                            spaceAvailable: cargoCapacity - spaceUsed,
                            items: cargoItems,
                            isFull: spaceUsed >= cargoCapacity
                        });
                    }
                );
            });
        });
    }
    
    /**
     * Add resources to ship cargo
     * @param {number} shipId - Ship ID
     * @param {string} resourceName - Resource type name
     * @param {number} quantity - Amount to add
     * @returns {Object} Result with success status and cargo info
     */
    static async addResourceToCargo(shipId, resourceName, quantity) {
        try {
            // Get resource type info
            const resourceType = await this.getResourceType(resourceName);
            if (!resourceType) {
                return { success: false, error: `Unknown resource type: ${resourceName}` };
            }
            
            // Get current cargo status
            const cargoStatus = await this.getShipCargo(shipId);
            
            // Calculate space needed
            const spaceNeeded = quantity * resourceType.base_size;
            
            // Check if there's enough space
            if (spaceNeeded > cargoStatus.spaceAvailable) {
                const maxQuantity = Math.floor(cargoStatus.spaceAvailable / resourceType.base_size);
                return {
                    success: false,
                    error: `Insufficient cargo space. Can only fit ${maxQuantity} more ${resourceName}`,
                    maxQuantity,
                    spaceAvailable: cargoStatus.spaceAvailable
                };
            }
            
            // Add or update cargo
            await this.updateShipCargoQuantity(shipId, resourceType.id, quantity);
            
            console.log(`📦 Added ${quantity} ${resourceName} to ship ${shipId} cargo`);
            
            return {
                success: true,
                resourceName,
                quantityAdded: quantity,
                newCargo: await this.getShipCargo(shipId)
            };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Remove resources from ship cargo
     * @param {number} shipId - Ship ID
     * @param {string} resourceName - Resource type name
     * @param {number} quantity - Amount to remove
     * @returns {Object} Result with success status
     */
    static async removeResourceFromCargo(shipId, resourceName, quantity) {
        try {
            const resourceType = await this.getResourceType(resourceName);
            if (!resourceType) {
                return { success: false, error: `Unknown resource type: ${resourceName}` };
            }
            
            // Get current quantity
            const currentQuantity = await this.getCurrentCargoQuantity(shipId, resourceType.id);
            
            if (currentQuantity < quantity) {
                return {
                    success: false,
                    error: `Not enough ${resourceName} in cargo. Have: ${currentQuantity}, requested: ${quantity}`
                };
            }
            
            // Remove from cargo
            await this.updateShipCargoQuantity(shipId, resourceType.id, -quantity);
            
            console.log(`📦 Removed ${quantity} ${resourceName} from ship ${shipId} cargo`);
            
            return {
                success: true,
                resourceName,
                quantityRemoved: quantity,
                newCargo: await this.getShipCargo(shipId)
            };
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Get resource type information
     */
    static async getResourceType(resourceName) {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM resource_types WHERE resource_name = ?',
                [resourceName],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row);
                    }
                }
            );
        });
    }
    
    /**
     * Get current quantity of a resource in ship cargo
     */
    static async getCurrentCargoQuantity(shipId, resourceTypeId) {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT quantity FROM ship_cargo WHERE ship_id = ? AND resource_type_id = ?',
                [shipId, resourceTypeId],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row ? row.quantity : 0);
                    }
                }
            );
        });
    }
    
    /**
     * Update ship cargo quantity (add or subtract)
     */
    static async updateShipCargoQuantity(shipId, resourceTypeId, quantityDelta) {
        return new Promise((resolve, reject) => {
            // Use INSERT OR REPLACE with calculated quantity
            db.run(
                `INSERT INTO ship_cargo (ship_id, resource_type_id, quantity, last_updated)
                 VALUES (?, ?, 
                    COALESCE((SELECT quantity FROM ship_cargo WHERE ship_id = ? AND resource_type_id = ?), 0) + ?,
                    CURRENT_TIMESTAMP
                 )
                 ON CONFLICT(ship_id, resource_type_id) DO UPDATE SET
                    quantity = quantity + ?,
                    last_updated = CURRENT_TIMESTAMP`,
                [shipId, resourceTypeId, shipId, resourceTypeId, quantityDelta, quantityDelta],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        // Clean up zero quantities
                        db.run(
                            'DELETE FROM ship_cargo WHERE ship_id = ? AND resource_type_id = ? AND quantity <= 0',
                            [shipId, resourceTypeId],
                            (err) => {
                                if (err) {
                                    console.warn('Error cleaning up zero cargo quantities:', err);
                                }
                                resolve();
                            }
                        );
                    }
                }
            );
        });
    }
    
    /**
     * Initialize cargo system for all ships in a game
     */
    static async initializeAllShipCargo(gameId) {
        return new Promise((resolve, reject) => {
            // Get all ships in the game
            db.all(
                `SELECT so.id FROM sector_objects so
                 JOIN sectors s ON so.sector_id = s.id
                 WHERE s.game_id = ? AND so.type = 'ship'`,
                [gameId],
                async (err, ships) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    console.log(`📦 Initializing cargo system for ${ships.length} ships in game ${gameId}`);
                    
                    try {
                        for (const ship of ships) {
                            await this.initializeShipCargo(ship.id);
                        }
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                }
            );
        });
    }
    
    /**
     * Get cargo summary for UI display
     */
    static async getCargoSummary(shipId) {
        const cargo = await this.getShipCargo(shipId);
        
        return {
            capacity: `${cargo.spaceUsed}/${cargo.capacity}`,
            percentFull: Math.round((cargo.spaceUsed / cargo.capacity) * 100),
            isEmpty: cargo.spaceUsed === 0,
            isFull: cargo.isFull,
            itemCount: cargo.items.length,
            totalValue: cargo.items.reduce((sum, item) => sum + (item.quantity * item.base_value || 0), 0)
        };
    }
}

module.exports = { CargoManager };