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

        // Derive a deterministic per-object seed from the sector seed and object identity
        const objectSeed = deriveObjectSeed(seed, celestialObject);
        const rng = new SeededRandom(objectSeed);
        const nodeConfigs = this.getNodeConfigForCelestialType(celestialObject.celestial_type, celestialObject);
        
        console.log(`🪨 Generating resource nodes for ${celestialObject.celestial_type} at (${celestialObject.x}, ${celestialObject.y})`);
        
        for (const config of nodeConfigs) {
            // Select a concrete placement pattern and persistent state for this object/config
            const { patternName, patternState } = this.selectPlacementPattern(celestialObject, config, rng);

            const nodeCount = rng.randInt(config.minNodes, config.maxNodes);
            console.log(`  • Creating ${nodeCount} ${config.resourceType} nodes`);
            
            // Robust placement: retry until we place intended count or reach safety limit
            let placed = 0;
            let safety = 0;
            while (placed < nodeCount && safety < nodeCount * 12) {
                const success = await this.generateSingleNode(
                    sectorId,
                    celestialObject,
                    { ...config, placementPattern: patternName },
                    rng,
                    patternState,
                    safety
                );
                if (success) placed++;
                safety++;
            }
            if (placed < nodeCount) {
                console.warn(`    ⚠️ Only placed ${placed}/${nodeCount} ${config.resourceType} nodes after retries`);
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
    static async generateSingleNode(sectorId, parentObject, config, rng, patternState, attemptIndex = 0) {
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
        const position = this.calculateNodePosition(parentObject, config.placementPattern, nodeSize, rng, patternState, attemptIndex);
        
        // Validate position doesn't overlap with existing nodes
        const validPosition = await this.validateNodePosition(sectorId, position.x, position.y, nodeSize);
        if (!validPosition) {
            return false;
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
        return true;
    }
    
    /**
     * Calculate node position based on placement pattern
     */
    static calculateNodePosition(parentObject, pattern, nodeSize, rng, patternState = null, attemptIndex = 0) {
        const { x: centerX, y: centerY, radius } = parentObject;
        
        switch (pattern) {
            case 'belt_hotspots': {
                const state = patternState || createBeltHotspotsState(rng, radius);
                const hotspot = state.hotspots[Math.floor(rng.random() * state.hotspots.length)];
                const angle = hotspot.angle + (rng.random() - 0.5) * (hotspot.angularSpread + attemptIndex * 0.01);
                const distance = Math.max(8, state.targetDistance + (rng.random() - 0.5) * (state.radialJitter + attemptIndex * 1.2));
                return {
                    x: Math.round(centerX + Math.cos(angle) * distance),
                    y: Math.round(centerY + Math.sin(angle) * distance)
                };
            }
            case 'belt_subrings': {
                const state = patternState || createBeltSubringsState(rng);
                const ring = weightedPick(state.subrings, rng);
                const angle = rng.random() * 2 * Math.PI + attemptIndex * 0.005;
                const distance = Math.max(8, ring.distance + (rng.random() - 0.5) * (state.subringJitter + attemptIndex * 1.2));
                return {
                    x: Math.round(centerX + Math.cos(angle) * distance),
                    y: Math.round(centerY + Math.sin(angle) * distance)
                };
            }
            case 'belt_spokes': {
                const state = patternState || createBeltSpokesState(rng);
                const spokeAngle = state.spokes[Math.floor(rng.random() * state.spokes.length)];
                const angle = spokeAngle + (rng.random() - 0.5) * (0.06 + attemptIndex * 0.01); // widen with attempts
                const distance = Math.max(8, state.targetDistance + (rng.random() - 0.5) * (state.radialJitter + attemptIndex * 1.2));
                return {
                    x: Math.round(centerX + Math.cos(angle) * distance),
                    y: Math.round(centerY + Math.sin(angle) * distance)
                };
            }
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
                
            case 'nebula_dense_clusters': {
                const state = patternState || createNebulaClustersState(rng, centerX, centerY);
                const cluster = state.clusters[Math.floor(rng.random() * state.clusters.length)];
                const nodeAngle = rng.random() * 2 * Math.PI;
                const nodeDistance = rng.random() * (cluster.spread + attemptIndex * 0.8); // expand slightly on retries
                return {
                    x: Math.round(cluster.cx + Math.cos(nodeAngle) * nodeDistance),
                    y: Math.round(cluster.cy + Math.sin(nodeAngle) * nodeDistance)
                };
            }
            case 'nebula_filaments': {
                const state = patternState || createNebulaFilamentsState(rng, centerX, centerY);
                const filament = state.filaments[Math.floor(rng.random() * state.filaments.length)];
                // Sample along the filament line near its center
                const t = rng.random() * 2 - 1; // -1..1 along the line segment across the filament
                const baseX = filament.cx + Math.cos(filament.angle) * t * filament.halfLength;
                const baseY = filament.cy + Math.sin(filament.angle) * t * filament.halfLength;
                // Small perpendicular noise to keep density tight
                const perpAngle = filament.angle + Math.PI / 2;
                const offset = (rng.random() - 0.5) * (filament.thickness + attemptIndex * 0.6);
                return {
                    x: Math.round(baseX + Math.cos(perpAngle) * offset),
                    y: Math.round(baseY + Math.sin(perpAngle) * offset)
                };
            }
                
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
     * Choose a concrete placement pattern and construct persistent state for an object
     */
    static selectPlacementPattern(parentObject, config, rng) {
        const type = parentObject.celestial_type;
        if (type === 'belt') {
            // Weighted selection among varied belt patterns
            const roll = rng.random();
            if (roll < 0.5) return { patternName: 'belt_hotspots', patternState: createBeltHotspotsState(rng, parentObject.radius) };
            if (roll < 0.8) return { patternName: 'belt_subrings', patternState: createBeltSubringsState(rng) };
            return { patternName: 'belt_spokes', patternState: createBeltSpokesState(rng) };
        }
        if (type === 'nebula') {
            const roll = rng.random();
            if (roll < 0.65) return { patternName: 'nebula_dense_clusters', patternState: createNebulaClustersState(rng, parentObject.radius, parentObject.x, parentObject.y) };
            return { patternName: 'nebula_filaments', patternState: createNebulaFilamentsState(rng, parentObject.x, parentObject.y, parentObject.radius) };
        }
        // Fallback to provided pattern
        return { patternName: config.placementPattern, patternState: null };
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

/**
 * Deterministically derive a per-object seed from the sector seed and object identity
 */
function deriveObjectSeed(sectorSeed, celestialObject) {
    // Mix sector seed with object id, type, and coarse position to avoid collisions
    const base = `${sectorSeed}|${celestialObject.id}|${celestialObject.celestial_type}|${Math.round(celestialObject.x)}|${Math.round(celestialObject.y)}|${Math.round(celestialObject.radius)}`;
    let hash = 2166136261;
    for (let i = 0; i < base.length; i++) {
        hash ^= base.charCodeAt(i);
        hash = (hash * 16777619) >>> 0; // FNV-1a like mixing
    }
    // Ensure non-zero positive integer seed
    return (hash % 2147483647) + 1;
}

function createBeltHotspotsState(rng, radius) {
    // Target warp-visible ring: about 28 tiles from center
    const target = 28;
    // Jitter of ±5-15% of target distance
    const jitter = target * (0.05 + rng.random() * 0.10) * 2; // full width
    const hotspotCount = 2 + Math.floor(rng.random() * 3); // 2-4
    const hotspots = [];
    for (let i = 0; i < hotspotCount; i++) {
        hotspots.push({
            angle: rng.random() * 2 * Math.PI,
            angularSpread: 0.14 + rng.random() * 0.10
        });
    }
    return { hotspots, targetDistance: target, radialJitter: jitter };
}

function createBeltSubringsState(rng) {
    const target = 28;
    const subringCount = 2 + Math.floor(rng.random() * 2); // 2-3
    const subrings = [];
    for (let i = 0; i < subringCount; i++) {
        const offset = (rng.random() - 0.5) * (target * 0.2); // ±10% of target
        subrings.push({
            distance: Math.max(8, target + offset),
            weight: 0.6 + rng.random() * 0.8
        });
    }
    return { subrings, subringJitter: target * (0.10 + rng.random() * 0.10) }; // ±10-20% total jitter
}

function createBeltSpokesState(rng) {
    const target = 28;
    const spokeCount = 3 + Math.floor(rng.random() * 3); // 3-5
    const spokes = [];
    const baseAngle = rng.random() * 2 * Math.PI;
    for (let i = 0; i < spokeCount; i++) {
        spokes.push(baseAngle + (i * (2 * Math.PI / spokeCount)) + (rng.random() - 0.5) * 0.2);
    }
    return { spokes, targetDistance: target, radialJitter: target * (0.10 + rng.random() * 0.10) };
}

function createNebulaClustersState(rng, centerX, centerY) {
    // Place clusters around the warp-in ring (~28 tiles) with jitter
    const target = 28;
    const clusterCount = 2 + Math.floor(rng.random() * 4); // 2-5 clusters
    const clusters = [];
    for (let i = 0; i < clusterCount; i++) {
        const angle = rng.random() * 2 * Math.PI;
        const dist = target + (rng.random() - 0.5) * target * 0.3; // ±15%
        clusters.push({
            cx: centerX + Math.cos(angle) * dist,
            cy: centerY + Math.sin(angle) * dist,
            spread: 6 + rng.randInt(4, 12) // cluster spread radius in tiles (absolute)
        });
    }
    return { clusters };
}

function createNebulaFilamentsState(rng, centerX, centerY) {
    // Center filaments around the warp-in ring as well
    const target = 28;
    const filamentCount = 2 + Math.floor(rng.random() * 3); // 2-4
    const filaments = [];
    for (let i = 0; i < filamentCount; i++) {
        const baseAngle = rng.random() * 2 * Math.PI;
        const dist = target + (rng.random() - 0.5) * target * 0.25; // ±12.5%
        filaments.push({
            cx: centerX + Math.cos(baseAngle) * dist,
            cy: centerY + Math.sin(baseAngle) * dist,
            angle: baseAngle + (rng.random() - 0.5) * 0.6, // vary orientation
            halfLength: 20 + rng.randInt(10, 30), // absolute length in tiles
            thickness: 6 + rng.randInt(2, 8)
        });
    }
    return { filaments };
}

function weightedPick(items, rng) {
    const total = items.reduce((s, it) => s + (it.weight || 1), 0);
    let r = rng.random() * total;
    for (const it of items) {
        r -= (it.weight || 1);
        if (r <= 0) return it;
    }
    return items[items.length - 1];
}

module.exports = { ResourceNodeGenerator };