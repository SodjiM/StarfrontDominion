// Cargo Manager - Handles ship inventory and cargo operations
// Universal system for managing resources, capacity limits, and cargo operations

const db = require('./db');

/**
 * CargoManager - Manages cargo for ships and structures, capacity limits, and resource operations
 */
class CargoManager {
    
    /**
     * Initialize cargo system for a ship (add default cargo capacity to metadata)
     * @param {number} shipId - Ship ID
     * @param {number} cargoCapacity - Maximum cargo capacity (default: 10)
     */
    static async initializeShipCargo(shipId, cargoCapacity = 10) {
        return this.initializeObjectCargo(shipId, cargoCapacity);
    }
    
    /**
     * Initialize cargo system for any object (ships, structures, etc.)
     * @param {number} objectId - Object ID (ship, starbase, station, etc.)
     * @param {number} cargoCapacity - Maximum cargo capacity (default: 10)
     */
    static async initializeObjectCargo(objectId, cargoCapacity = 10) {
        return new Promise((resolve, reject) => {
            // Get current object metadata
            db.get('SELECT type, meta FROM sector_objects WHERE id = ?', [objectId], (err, object) => {
                if (err || !object) {
                    reject(err || new Error('Object not found'));
                    return;
                }
                
                const meta = JSON.parse(object.meta || '{}');
                
                // Add cargo capacity if not already present
                if (!meta.cargoCapacity) {
                    meta.cargoCapacity = cargoCapacity;
                    
                    // Update object metadata
                    db.run(
                        'UPDATE sector_objects SET meta = ? WHERE id = ?',
                        [JSON.stringify(meta), objectId],
                        (err) => {
                            if (err) {
                                reject(err);
                            } else {
                                console.log(`📦 Initialized cargo system for ${object.type} ${objectId} with capacity ${cargoCapacity}`);
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
        return this.getObjectCargo(shipId, true); // Use legacy ship_cargo table for backward compatibility
    }
    
    /**
     * Get object's current cargo status (ships, structures, etc.)
     * @param {number} objectId - Object ID
     * @param {boolean} useLegacyTable - Whether to use ship_cargo table (default: false, uses object_cargo)
     * @returns {Object} Cargo status with items, capacity, and space used
     */
    static async getObjectCargo(objectId, useLegacyTable = false) {
        return new Promise((resolve, reject) => {
            // Get object cargo capacity from metadata
            db.get('SELECT meta FROM sector_objects WHERE id = ?', [objectId], (err, object) => {
                if (err || !object) {
                    reject(err || new Error('Object not found'));
                    return;
                }
                
                const meta = JSON.parse(object.meta || '{}');
                const cargoCapacity = meta.cargoCapacity || 10;
                
                // Choose table and column names based on legacy flag
                const tableName = useLegacyTable ? 'ship_cargo' : 'object_cargo';
                const idColumn = useLegacyTable ? 'ship_id' : 'object_id';
                
                // Get all cargo items for this object
                db.all(
                    `SELECT sc.*, rt.resource_name, rt.category, rt.base_size, rt.icon_emoji, rt.color_hex
                     FROM ${tableName} sc
                     JOIN resource_types rt ON sc.resource_type_id = rt.id
                     WHERE sc.${idColumn} = ? AND sc.quantity > 0`,
                    [objectId],
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
                            objectId,
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
     * Add resources to ship cargo (legacy method - for backward compatibility)
     * @param {number} shipId - Ship ID
     * @param {string} resourceName - Resource type name
     * @param {number} quantity - Amount to add
     * @returns {Object} Result with success status and cargo info
     */
    static async addResourceToShipCargo(shipId, resourceName, quantity) {
        try {
            // Get resource type info
            const resourceType = await this.getResourceType(resourceName);
            if (!resourceType) {
                return { success: false, error: `Unknown resource type: ${resourceName}` };
            }
            
            // Get current cargo status (use legacy table for ships)
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
            
            // Add or update cargo using legacy table - call the universal method directly
            await this.addResourceToCargo(shipId, resourceName, quantity, true);
            
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
     * Atomically consume a map of resources from an object's cargo
     * @param {number} objectId
     * @param {Record<string, number>} resourceMap
     * @param {boolean} useLegacyTable
     */
    static async consumeResourcesAtomic(objectId, resourceMap, useLegacyTable = false) {
        const tableName = useLegacyTable ? 'ship_cargo' : 'object_cargo';
        const idColumn = useLegacyTable ? 'ship_id' : 'object_id';
        return new Promise((resolve) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                // Verify availability
                const shortages = [];
                const getTypeId = (name) => new Promise((res) => {
                    db.get('SELECT id FROM resource_types WHERE resource_name = ?', [name], (e, row) => res(row?.id || null));
                });
                const getQty = (rid) => new Promise((res) => {
                    db.get(`SELECT quantity FROM ${tableName} WHERE ${idColumn} = ? AND resource_type_id = ?`, [objectId, rid], (e, row) => res(row?.quantity || 0));
                });
                (async () => {
                    const plan = [];
                    for (const [name, qty] of Object.entries(resourceMap)) {
                        const rid = await getTypeId(name);
                        if (!rid) { shortages.push({ resource: name, needed: qty, have: 0 }); continue; }
                        const have = await getQty(rid);
                        if (have < qty) shortages.push({ resource: name, needed: qty, have });
                        plan.push({ rid, qty });
                    }
                    if (shortages.length > 0) {
                        db.run('ROLLBACK');
                        return resolve({ success: false, shortages });
                    }
                    // Deduct
                    for (const { rid, qty } of plan) {
                        await new Promise((res, rej) => {
                            db.run(
                                `UPDATE ${tableName} SET quantity = quantity - ?, last_updated = CURRENT_TIMESTAMP WHERE ${idColumn} = ? AND resource_type_id = ?`,
                                [qty, objectId, rid], (err) => err ? rej(err) : res()
                            );
                        });
                        // Cleanup zeros
                        await new Promise((res) => db.run(`DELETE FROM ${tableName} WHERE ${idColumn} = ? AND resource_type_id = ? AND quantity <= 0`, [objectId, rid], () => res()));
                    }
                    db.run('COMMIT', () => resolve({ success: true }));
                })().catch(err => { console.error('consumeResourcesAtomic error:', err); db.run('ROLLBACK', () => resolve({ success: false, error: 'transaction_failed' })); });
            });
        });
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
    
    /**
     * Check if two objects are adjacent (within 1 tile of each other)
     * @param {Object} object1 - First object with x, y coordinates
     * @param {Object} object2 - Second object with x, y coordinates
     * @returns {boolean} True if objects are adjacent
     */
    static areObjectsAdjacent(object1, object2) {
        const dx = Math.abs(object1.x - object2.x);
        const dy = Math.abs(object1.y - object2.y);
        return dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0); // Adjacent but not same position
    }
    
    /**
     * Transfer resources between two objects (ships, structures)
     * @param {number} fromObjectId - Source object ID
     * @param {number} toObjectId - Destination object ID
     * @param {string} resourceName - Resource type name
     * @param {number} quantity - Amount to transfer
     * @param {number} userId - Player ID for ownership verification
     * @returns {Object} Result with success status and details
     */
    static async transferResources(fromObjectId, toObjectId, resourceName, quantity, userId) {
        try {
            // Verify both objects exist. Either side may be public (e.g., cargo cans)
            const fromObject = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM sector_objects WHERE id = ?', [fromObjectId], (err, obj) => {
                    if (err) reject(err);
                    else resolve(obj);
                });
            });
            
            const toObject = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM sector_objects WHERE id = ?', [toObjectId], (err, obj) => {
                    if (err) reject(err);
                    else resolve(obj);
                });
            });
            
            if (!fromObject || !toObject) {
                return { success: false, error: 'One or both objects not found' };
            }
            // If destination isn't owned by the player, require publicAccess flag
            if (Number(toObject.owner_id) !== Number(userId)) {
                try {
                    const meta = JSON.parse(toObject.meta || '{}');
                    if (!meta.publicAccess) {
                        return { success: false, error: 'Destination does not allow public access' };
                    }
                } catch {}
            }
            // If source isn't owned by the player (e.g., public can), also require publicAccess on source
            if (Number(fromObject.owner_id) !== Number(userId)) {
                try {
                    const meta = JSON.parse(fromObject.meta || '{}');
                    if (!meta.publicAccess) {
                        return { success: false, error: 'Source does not allow public access' };
                    }
                } catch {}
            }
            
            // Check if objects are adjacent
            if (!this.areObjectsAdjacent(fromObject, toObject)) {
                return { success: false, error: 'Objects must be adjacent to transfer resources' };
            }
            
            // Get resource type info
            const resourceType = await this.getResourceType(resourceName);
            if (!resourceType) {
                return { success: false, error: `Unknown resource type: ${resourceName}` };
            }
            
            // Get current cargo status for both objects
            const fromUseLegacy = fromObject.type === 'ship';
            const toUseLegacy = toObject.type === 'ship';
            
            const fromCargo = await this.getObjectCargo(fromObjectId, fromUseLegacy);
            const toCargo = await this.getObjectCargo(toObjectId, toUseLegacy);
            
            // Check if source has enough resources
            const sourceItem = fromCargo.items.find(item => item.resource_name === resourceName);
            if (!sourceItem || sourceItem.quantity < quantity) {
                return { 
                    success: false, 
                    error: `Insufficient ${resourceName} in source object. Available: ${sourceItem?.quantity || 0}, requested: ${quantity}` 
                };
            }
            
            // Check if destination has enough space
            const spaceNeeded = quantity * resourceType.base_size;
            if (spaceNeeded > toCargo.spaceAvailable) {
                const maxQuantity = Math.floor(toCargo.spaceAvailable / resourceType.base_size);
                return {
                    success: false,
                    error: `Insufficient cargo space in destination. Can only fit ${maxQuantity} more ${resourceName}`,
                    maxQuantity,
                    spaceAvailable: toCargo.spaceAvailable
                };
            }
            
            // Perform the transfer
            // 1. Remove from source
            await this.removeResourceFromCargo(fromObjectId, resourceName, quantity, fromUseLegacy);
            
            // 2. Add to destination
            await this.addResourceToCargo(toObjectId, resourceName, quantity, toUseLegacy);
            
            console.log(`📦 Transferred ${quantity} ${resourceName} from ${fromObject.type} ${fromObjectId} to ${toObject.type} ${toObjectId}`);
            
            return {
                success: true,
                resourceName,
                quantityTransferred: quantity,
                fromObject: fromObject.type,
                toObject: toObject.type,
                newFromCargo: await this.getObjectCargo(fromObjectId, fromUseLegacy),
                newToCargo: await this.getObjectCargo(toObjectId, toUseLegacy)
            };
            
        } catch (error) {
            console.error('Transfer error:', error);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Add resources to object cargo (universal method)
     * @param {number} objectId - Object ID
     * @param {string} resourceName - Resource type name
     * @param {number} quantity - Amount to add
     * @param {boolean} useLegacyTable - Whether to use ship_cargo table
     * @returns {Object} Result with success status
     */
    static async addResourceToCargo(objectId, resourceName, quantity, useLegacyTable = false) {
        const resourceType = await this.getResourceType(resourceName);
        if (!resourceType) {
            throw new Error(`Unknown resource type: ${resourceName}`);
        }
        
        const tableName = useLegacyTable ? 'ship_cargo' : 'object_cargo';
        const idColumn = useLegacyTable ? 'ship_id' : 'object_id';
        
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT OR REPLACE INTO ${tableName} (${idColumn}, resource_type_id, quantity, last_updated) 
                 VALUES (?, ?, COALESCE((SELECT quantity FROM ${tableName} WHERE ${idColumn} = ? AND resource_type_id = ?), 0) + ?, CURRENT_TIMESTAMP)`,
                [objectId, resourceType.id, objectId, resourceType.id, quantity],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ success: true });
                    }
                }
            );
        });
    }
    
    /**
     * Remove resources from object cargo (universal method)
     * @param {number} objectId - Object ID
     * @param {string} resourceName - Resource type name
     * @param {number} quantity - Amount to remove
     * @param {boolean} useLegacyTable - Whether to use ship_cargo table
     * @returns {Object} Result with success status
     */
    static async removeResourceFromCargo(objectId, resourceName, quantity, useLegacyTable = false) {
        const resourceType = await this.getResourceType(resourceName);
        if (!resourceType) {
            throw new Error(`Unknown resource type: ${resourceName}`);
        }
        
        const tableName = useLegacyTable ? 'ship_cargo' : 'object_cargo';
        const idColumn = useLegacyTable ? 'ship_id' : 'object_id';
        
        return new Promise((resolve, reject) => {
            // First check current quantity
            db.get(
                `SELECT quantity FROM ${tableName} WHERE ${idColumn} = ? AND resource_type_id = ?`,
                [objectId, resourceType.id],
                (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    if (!row || row.quantity < quantity) {
                        reject(new Error(`Insufficient ${resourceName} to remove`));
                        return;
                    }
                    
                    const newQuantity = row.quantity - quantity;
                    
                    if (newQuantity <= 0) {
                        // Remove the row if quantity becomes 0 or negative
                        db.run(
                            `DELETE FROM ${tableName} WHERE ${idColumn} = ? AND resource_type_id = ?`,
                            [objectId, resourceType.id],
                            function(err) {
                                if (err) reject(err);
                                else resolve({ success: true });
                            }
                        );
                    } else {
                        // Update with new quantity
                        db.run(
                            `UPDATE ${tableName} SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE ${idColumn} = ? AND resource_type_id = ?`,
                            [newQuantity, objectId, resourceType.id],
                            function(err) {
                                if (err) reject(err);
                                else resolve({ success: true });
                            }
                        );
                    }
                }
            );
        });
    }
}

module.exports = { CargoManager };