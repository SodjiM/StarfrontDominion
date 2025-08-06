// Resource Node Generator - Creates harvestable resource deposits within celestial objects
// Universal system for generating rocks in asteroid belts, gas in nebulae, energy near stars, etc.

const db = require('./db');

/**
 * ResourceNodeGenerator - Generates harvestable resource nodes within celestial objects
 */
class ResourceNodeGenerator {
    
    /**
     * Generate resource nodes for a specific celestial object
     * @param {number} sectorId - Sector containing the celestial object
     * @param {Object} celestialObject - The parent celestial object (belt, nebula, etc.)
     * @param {number} seed - Random seed for consistent generation
     */
    static async generateNodesForCelestialObject(sectorId, celestialObject, seed = null) {
        if (!seed) seed = Date.now() + celestialObject.id;
        
        const rng = new SeededRandom(seed);
        const nodeConfigs = this.getNodeConfigForCelestialType(celestialObject.celestial_type, celestialObject);
        
        console.log(`🪨 Generating resource nodes for ${celestialObject.celestial_type} at (${celestialObject.x}, ${celestialObject.y})`);
        
        for (const config of nodeConfigs) {
            const nodeCount = rng.randInt(config.minNodes, config.maxNodes);
            console.log(`  • Creating ${nodeCount} ${config.resourceType} nodes`);
            
            for (let i = 0; i < nodeCount; i++) {
                await this.generateSingleNode(sectorId, celestialObject, config, rng);
            }
        }
    }
    
    /**
     * Get resource node configuration based on celestial object type
     */
    static getNodeConfigForCelestialType(celestialType, celestialObject) {
        const configs = {
            'belt': [
                {
                    resourceType: 'rock',
                    minNodes: 25,
                    maxNodes: 45,
                    minAmount: 50,
                    maxAmount: 200,
                    sizeDistribution: [70, 25, 5], // % for size 1, 2, 3
                    placementPattern: 'dense_belt_ring'
                }
            ],
            'nebula': [
                {
                    resourceType: 'gas',
                    minNodes: 12,
                    maxNodes: 25,
                    minAmount: 30,
                    maxAmount: 100,
                    sizeDistribution: [40, 40, 20],
                    placementPattern: 'dense_clusters'
                }
            ],
            'star': [
                {
                    resourceType: 'energy',
                    minNodes: 3,
                    maxNodes: 8,
                    minAmount: 100,
                    maxAmount: 300,
                    sizeDistribution: [60, 30, 10],
                    placementPattern: 'orbital_safe_zone'
                }
            ],
            'derelict': [
                {
                    resourceType: 'salvage',
                    minNodes: 2,
                    maxNodes: 6,
                    minAmount: 20,
                    maxAmount: 80,
                    sizeDistribution: [50, 35, 15],
                    placementPattern: 'internal'
                }
            ]
        };
        
        return configs[celestialType] || [];
    }
    
    /**
     * Generate a single resource node
     */
    static async generateSingleNode(sectorId, parentObject, config, rng) {
        // Get resource type ID
        const resourceTypeId = await this.getResourceTypeId(config.resourceType);
        if (!resourceTypeId) {
            console.error(`Unknown resource type: ${config.resourceType}`);
            return;
        }
        
        // Determine node size based on distribution
        const sizeRoll = rng.random() * 100;
        let nodeSize = 1;
        if (sizeRoll > config.sizeDistribution[0]) nodeSize = 2;
        if (sizeRoll > config.sizeDistribution[0] + config.sizeDistribution[1]) nodeSize = 3;
        
        // Calculate position based on placement pattern
        const position = this.calculateNodePosition(parentObject, config.placementPattern, nodeSize, rng);
        
        // Validate position doesn't overlap with existing nodes
        const validPosition = await this.validateNodePosition(sectorId, position.x, position.y, nodeSize);
        if (!validPosition) {
            console.log(`    ⚠️ Position (${position.x}, ${position.y}) blocked, skipping node`);
            return;
        }
        
        // Calculate resource amount
        const resourceAmount = rng.randInt(config.minAmount, config.maxAmount);
        
        // Create the node
        await this.insertResourceNode(
            sectorId,
            parentObject.id,
            resourceTypeId,
            position.x,
            position.y,
            nodeSize,
            resourceAmount
        );
        
        console.log(`    ✅ Created ${config.resourceType} node (size ${nodeSize}) at (${position.x}, ${position.y}) with ${resourceAmount} resources`);
    }
    
    /**
     * Calculate node position based on placement pattern
     */
    static calculateNodePosition(parentObject, pattern, nodeSize, rng) {
        const { x: centerX, y: centerY, radius } = parentObject;
        
        switch (pattern) {
            case 'scattered_ring':
                // Scatter nodes in a ring around the celestial object
                const angle = rng.random() * 2 * Math.PI;
                const distance = radius * 0.3 + rng.random() * radius * 0.4; // 30%-70% of radius
                return {
                    x: Math.round(centerX + Math.cos(angle) * distance),
                    y: Math.round(centerY + Math.sin(angle) * distance)
                };
                
            case 'dense_belt_ring':
                // Dense placement closer to the belt boundary with gradient density
                const beltAngle = rng.random() * 2 * Math.PI;
                
                // Create density gradient: 70% of nodes near edges (70-95% radius), 30% in middle (40-70% radius)
                const densityRoll = rng.random();
                let beltDistance;
                if (densityRoll < 0.7) {
                    // Dense outer ring - where most asteroids are
                    beltDistance = radius * (0.70 + rng.random() * 0.25); // 70%-95% of radius
                } else {
                    // Sparse inner area
                    beltDistance = radius * (0.40 + rng.random() * 0.30); // 40%-70% of radius
                }
                
                // Add some random variation to make it feel natural
                const variation = (rng.random() - 0.5) * radius * 0.1; // ±10% variation
                beltDistance += variation;
                
                // Ensure we don't place too close to center (avoid ship warp collision)
                beltDistance = Math.max(beltDistance, radius * 0.3);
                
                return {
                    x: Math.round(centerX + Math.cos(beltAngle) * beltDistance),
                    y: Math.round(centerY + Math.sin(beltAngle) * beltDistance)
                };
                
            case 'clustered':
                // Create clusters of nodes
                const clusterAngle = rng.random() * 2 * Math.PI;
                const clusterDistance = rng.random() * radius * 0.6;
                return {
                    x: Math.round(centerX + Math.cos(clusterAngle) * clusterDistance),
                    y: Math.round(centerY + Math.sin(clusterAngle) * clusterDistance)
                };
                
            case 'dense_clusters':
                // Create tight clusters with 3-4 cluster centers
                const numClusters = 3 + Math.floor(rng.random() * 2); // 3-4 clusters
                const clusterIndex = Math.floor(rng.random() * numClusters);
                
                // Define cluster centers around the nebula
                const clusterCenterAngle = (clusterIndex / numClusters) * 2 * Math.PI + (rng.random() - 0.5) * 0.8;
                const clusterCenterDistance = radius * (0.3 + rng.random() * 0.4); // 30%-70% from center
                
                const clusterCenterX = centerX + Math.cos(clusterCenterAngle) * clusterCenterDistance;
                const clusterCenterY = centerY + Math.sin(clusterCenterAngle) * clusterCenterDistance;
                
                // Place node near cluster center with tight spread
                const nodeAngle = rng.random() * 2 * Math.PI;
                const nodeDistance = rng.random() * radius * 0.15; // Tight cluster radius (15% of nebula)
                
                return {
                    x: Math.round(clusterCenterX + Math.cos(nodeAngle) * nodeDistance),
                    y: Math.round(clusterCenterY + Math.sin(nodeAngle) * nodeDistance)
                };
                
            case 'orbital_safe_zone':
                // Place nodes in safe orbital zones around stars
                const orbitalAngle = rng.random() * 2 * Math.PI;
                const safeDistance = radius + 50 + rng.random() * 100; // Outside the star
                return {
                    x: Math.round(centerX + Math.cos(orbitalAngle) * safeDistance),
                    y: Math.round(centerY + Math.sin(orbitalAngle) * safeDistance)
                };
                
            case 'internal':
                // Place nodes within the object (for derelicts)
                const internalAngle = rng.random() * 2 * Math.PI;
                const internalDistance = rng.random() * radius * 0.8;
                return {
                    x: Math.round(centerX + Math.cos(internalAngle) * internalDistance),
                    y: Math.round(centerY + Math.sin(internalAngle) * internalDistance)
                };
                
            default:
                return { x: centerX, y: centerY };
        }
    }
    
    /**
     * Validate that a node position doesn't overlap with existing objects
     */
    static async validateNodePosition(sectorId, x, y, nodeSize) {
        return new Promise((resolve) => {
            // Check for collision with existing resource nodes
            db.get(
                `SELECT id FROM resource_nodes 
                 WHERE sector_id = ? 
                 AND ABS(x - ?) <= ? 
                 AND ABS(y - ?) <= ?`,
                [sectorId, x, nodeSize + 1, y, nodeSize + 1],
                (err, existingNode) => {
                    if (err) {
                        console.error('Error validating node position:', err);
                        resolve(false);
                        return;
                    }
                    
                    if (existingNode) {
                        resolve(false); // Position blocked
                        return;
                    }
                    
                    // Check for collision with ships/starbases (leave navigation paths)
                    db.get(
                        `SELECT id FROM sector_objects 
                         WHERE sector_id = ? 
                         AND type IN ('ship', 'starbase')
                         AND ABS(x - ?) <= 3 
                         AND ABS(y - ?) <= 3`,
                        [sectorId, x, y],
                        (err, existingObject) => {
                            if (err) {
                                console.error('Error validating against sector objects:', err);
                                resolve(false);
                                return;
                            }
                            
                            resolve(!existingObject); // Valid if no collision
                        }
                    );
                }
            );
        });
    }
    
    /**
     * Get resource type ID by name
     */
    static async getResourceTypeId(resourceName) {
        return new Promise((resolve) => {
            db.get(
                'SELECT id FROM resource_types WHERE resource_name = ?',
                [resourceName],
                (err, row) => {
                    if (err) {
                        console.error('Error getting resource type ID:', err);
                        resolve(null);
                    } else {
                        resolve(row ? row.id : null);
                    }
                }
            );
        });
    }
    
    /**
     * Insert a resource node into the database
     */
    static async insertResourceNode(sectorId, parentObjectId, resourceTypeId, x, y, size, resourceAmount) {
        return new Promise((resolve, reject) => {
            const meta = JSON.stringify({
                generated_at: new Date().toISOString(),
                difficulty: 1.0,
                quality: 'common'
            });
            
            db.run(
                `INSERT INTO resource_nodes 
                 (sector_id, parent_object_id, resource_type_id, x, y, size, resource_amount, max_resource, meta)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [sectorId, parentObjectId, resourceTypeId, x, y, size, resourceAmount, resourceAmount, meta],
                function(err) {
                    if (err) {
                        console.error('Error inserting resource node:', err);
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                }
            );
        });
    }
    
    /**
     * Generate resource nodes for all celestial objects in a sector
     */
    static async generateNodesForSector(sectorId, seed = null) {
        return new Promise((resolve, reject) => {
            // Get all celestial objects in the sector that can have resource nodes
            db.all(
                `SELECT * FROM sector_objects 
                 WHERE sector_id = ? 
                 AND celestial_type IN ('belt', 'nebula', 'star', 'derelict')`,
                [sectorId],
                async (err, celestialObjects) => {
                    if (err) {
                        console.error('Error getting celestial objects:', err);
                        reject(err);
                        return;
                    }
                    
                    console.log(`🌌 Generating resource nodes for ${celestialObjects.length} celestial objects in sector ${sectorId}`);
                    
                    try {
                        for (const celestialObject of celestialObjects) {
                            await this.generateNodesForCelestialObject(sectorId, celestialObject, seed);
                        }
                        
                        console.log(`✅ Resource node generation complete for sector ${sectorId}`);
                        resolve();
                    } catch (error) {
                        console.error('Error generating resource nodes:', error);
                        reject(error);
                    }
                }
            );
        });
    }
}

/**
 * Simple seeded random number generator for consistent results
 */
class SeededRandom {
    constructor(seed) {
        this.seed = seed;
    }
    
    random() {
        const x = Math.sin(this.seed++) * 10000;
        return x - Math.floor(x);
    }
    
    randInt(min, max) {
        return Math.floor(this.random() * (max - min + 1)) + min;
    }
}

module.exports = { ResourceNodeGenerator };