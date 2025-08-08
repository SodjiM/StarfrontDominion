// Celestial Objects System - Phase 1
// Object type definitions, scaling, and metadata management

/**
 * Celestial Object Type Definitions
 * Based on the design document specifications
 */
const CELESTIAL_OBJECT_TYPES = {
    // === STELLAR OBJECTS ===
    star: {
        name: 'Star',
        category: 'stellar',
        minRadius: 40,
        maxRadius: 80,
        defaultRadius: 60,
        minCount: 1,
        maxCount: 1,
        placementZone: 'center', // 2000-3000 tile range
        placementPriority: 100,
        bufferDistance: 1000,
        defaultMeta: {
            name: 'Primary Star',
            temperature: 5778,
            luminosity: 1.0,
            type: 'G-class',
            alwaysKnown: true,
            scannable: true,
            navigable: false,
            destructible: false
        }
    },
    
    'binary-star': {
        name: 'Binary Star System',
        category: 'stellar',
        minRadius: 30,
        maxRadius: 60,
        defaultRadius: 50,
        minCount: 2,
        maxCount: 2,
        placementZone: 'center',
        placementPriority: 100,
        bufferDistance: 300, // Between the two stars
        defaultMeta: {
            name: 'Binary Star',
            temperature: 5500,
            luminosity: 0.8,
            type: 'Binary G-class',
            alwaysKnown: true,
            scannable: true,
            navigable: false,
            destructible: false
        }
    },

    // === PLANETARY OBJECTS ===
    planet: {
        name: 'Planet',
        category: 'planetary',
        minRadius: 20,
        maxRadius: 50,
        defaultRadius: 30,
        minCount: 4,
        maxCount: 8,
        placementZone: 'orbital', // Concentric rings around star
        placementPriority: 90,
        bufferDistance: 300,
        defaultMeta: {
            name: 'Planet',
            type: 'terrestrial',
            atmosphere: 'standard',
            habitability: 0.5,
            resources: 1.0,
            population: 0,
            alwaysKnown: true,
            scannable: true,
            landable: true,
            destructible: false
        }
    },

    'gas-giant': {
        name: 'Gas Giant',
        category: 'planetary',
        minRadius: 40,
        maxRadius: 50,
        defaultRadius: 46,
        minCount: 0,
        maxCount: 2,
        placementZone: 'outer-orbital',
        placementPriority: 85,
        bufferDistance: 400,
        defaultMeta: {
            name: 'Gas Giant',
            type: 'gas-giant',
            atmosphere: 'toxic',
            habitability: 0.0,
            resources: 0.5,
            moons: 0,
            alwaysKnown: true,
            scannable: true,
            landable: false,
            destructible: false
        }
    },

    moon: {
        name: 'Moon',
        category: 'planetary',
        minRadius: 6,
        maxRadius: 16,
        defaultRadius: 10,
        minCount: 0,
        maxCount: 3, // Per planet
        placementZone: 'orbital', // Around parent planet
        placementPriority: 70,
        bufferDistance: 100,
        defaultMeta: {
            name: 'Moon',
            type: 'rocky',
            atmosphere: 'none',
            habitability: 0.1,
            resources: 0.8,
            alwaysKnown: true,
            scannable: true,
            landable: true,
            destructible: false
        }
    },

    // === FIELD OBJECTS ===
    belt: {
        name: 'Asteroid Belt',
        category: 'field',
        minRadius: 300,
        maxRadius: 800,
        defaultRadius: 500,
        minCount: 1,
        maxCount: 3,
        placementZone: 'inter-orbital', // Between planetary orbits
        placementPriority: 60,
        bufferDistance: 200,
        defaultMeta: {
            name: 'Asteroid Belt',
            type: 'rocky',
            density: 'medium',
            mineral_content: 1.2,
            navigable: true,
            mineable: true,
            alwaysKnown: true,
            scannable: true,
            destructible: false
        }
    },

    nebula: {
        name: 'Nebula Cloud',
        category: 'field',
        minRadius: 500,
        maxRadius: 1200,
        defaultRadius: 800,
        minCount: 1,
        maxCount: 2,
        placementZone: 'outer',
        placementPriority: 50,
        bufferDistance: 300,
        defaultMeta: {
            name: 'Nebula Cloud',
            type: 'emission',
            density: 'medium',
            scan_interference: 0.3,
            stealth_bonus: 0.2,
            visibility_reduction: 0.4,
            alwaysKnown: true,
            scannable: true,
            navigable: true,
            destructible: false
        }
    },

    // === ARTIFICIAL OBJECTS ===
    wormhole: {
        name: 'Wormhole',
        category: 'artificial',
        minRadius: 5,
        maxRadius: 10,
        defaultRadius: 7,
        minCount: 1,
        maxCount: 2,
        placementZone: 'outer',
        placementPriority: 30,
        bufferDistance: 100,
        defaultMeta: {
            name: 'Wormhole',
            type: 'stable',
            destination: null, // Will be set during generation
            energy_cost: 10,
            max_ship_size: 25, // Capital ships can use
            alwaysKnown: false, // Must be discovered
            scannable: true,
            usable: true,
            destructible: false
        }
    },

    'jump-gate': {
        name: 'Jump Gate',
        category: 'artificial',
        minRadius: 8,
        maxRadius: 12,
        defaultRadius: 10,
        minCount: 0,
        maxCount: 2,
        placementZone: 'mid',
        placementPriority: 35,
        bufferDistance: 150,
        defaultMeta: {
            name: 'Jump Gate',
            type: 'ancient',
            destination: null,
            energy_cost: 5,
            max_ship_size: 25,
            alwaysKnown: true,
            scannable: true,
            usable: true,
            destructible: false
        }
    },

    derelict: {
        name: 'Derelict Structure',
        category: 'artificial',
        minRadius: 5,
        maxRadius: 15,
        defaultRadius: 8,
        minCount: 2,
        maxCount: 8,
        placementZone: 'any',
        placementPriority: 10,
        bufferDistance: 50,
        defaultMeta: {
            name: 'Derelict Structure',
            type: 'unknown',
            condition: 'damaged',
            age: 'ancient',
            loot_potential: 0.3,
            exploration_difficulty: 0.5,
            alwaysKnown: false,
            scannable: true,
            explorable: true,
            destructible: true
        }
    },

    'graviton-sink': {
        name: 'Graviton Sink',
        category: 'anomaly',
        minRadius: 30,
        maxRadius: 50,
        defaultRadius: 40,
        minCount: 0,
        maxCount: 1,
        placementZone: 'outer-edge', // x or y >= 4000
        placementPriority: 20,
        bufferDistance: 500,
        defaultMeta: {
            name: 'Graviton Sink',
            type: 'black-hole',
            gravity_well: 2.0,
            scan_interference: 0.8,
            movement_penalty: 0.5,
            danger_level: 'extreme',
            alwaysKnown: false,
            scannable: true,
            navigable: true, // But dangerous
            destructible: false
        }
    }
};

/**
 * Placement Zone Definitions
 * Maps placement zones to coordinate ranges
 */
const PLACEMENT_ZONES = {
    'center': { minX: 2000, maxX: 3000, minY: 2000, maxY: 3000 },
    'inner': { minX: 1000, maxX: 4000, minY: 1000, maxY: 4000 },
    'mid': { minX: 500, maxX: 4500, minY: 500, maxY: 4500 },
    'outer': { minX: 200, maxX: 4800, minY: 200, maxY: 4800 },
    'outer-edge': { minX: 0, maxX: 5000, minY: 0, maxY: 5000, edgeConstraint: true }, // At least one coordinate >= 4000
    'orbital': { type: 'orbital', centerX: 2500, centerY: 2500 }, // Special orbital placement
    'inter-orbital': { type: 'inter-orbital', centerX: 2500, centerY: 2500 }, // Between orbital rings
    'any': { minX: 100, maxX: 4900, minY: 100, maxY: 4900 }
};

/**
 * Archetype-specific modifiers
 * Adjusts object counts and properties based on system archetype
 */
const ARCHETYPE_MODIFIERS = {
    'resource-rich': {
        planet: { countMultiplier: 1.2, resourceBonus: 1.5 },
        belt: { countMultiplier: 1.3, mineralBonus: 1.8 },
        derelict: { countMultiplier: 0.8 }
    },
    'asteroid-heavy': {
        belt: { countMultiplier: 1.5, densityBonus: 1.5 },
        derelict: { countMultiplier: 1.4 },
        planet: { countMultiplier: 0.8 }
    },
    'nebula': {
        nebula: { countMultiplier: 2.0, interferenceBonus: 1.5 },
        wormhole: { countMultiplier: 1.3 },
        planet: { countMultiplier: 0.9 }
    },
    'binary-star': {
        star: { type: 'binary-star', count: 2 },
        planet: { countMultiplier: 1.1, orbitalComplexity: 1.5 }
    }
};

/**
 * CelestialObjectManager - Main class for celestial object operations
 */
class CelestialObjectManager {
    /**
     * Get object type definition
     * @param {string} type - Celestial object type
     * @returns {Object} Type definition
     */
    static getObjectType(type) {
        return CELESTIAL_OBJECT_TYPES[type] || null;
    }

    /**
     * Get all object types in a category
     * @param {string} category - Category name ('stellar', 'planetary', 'field', 'artificial', 'anomaly')
     * @returns {Object} Object types in category
     */
    static getObjectsByCategory(category) {
        const result = {};
        for (const [type, definition] of Object.entries(CELESTIAL_OBJECT_TYPES)) {
            if (definition.category === category) {
                result[type] = definition;
            }
        }
        return result;
    }

    /**
     * Calculate object radius based on type and variation
     * @param {string} type - Celestial object type
     * @param {number} variation - Random variation (0-1)
     * @returns {number} Calculated radius
     */
    static calculateRadius(type, variation = 0.5) {
        const objectType = this.getObjectType(type);
        if (!objectType) return 1;

        const range = objectType.maxRadius - objectType.minRadius;
        return Math.round(objectType.minRadius + (range * variation));
    }

    /**
     * Generate metadata for an object
     * @param {string} type - Celestial object type
     * @param {Object} overrides - Property overrides
     * @returns {Object} Generated metadata
     */
    static generateMetadata(type, overrides = {}) {
        const objectType = this.getObjectType(type);
        if (!objectType) return {};

        return {
            ...objectType.defaultMeta,
            ...overrides,
            objectType: type,
            category: objectType.category,
            generatedAt: new Date().toISOString()
        };
    }

    /**
     * Check if two objects would collide based on position and radius
     * @param {Object} obj1 - First object {x, y, radius}
     * @param {Object} obj2 - Second object {x, y, radius}
     * @param {number} bufferDistance - Additional buffer distance
     * @returns {boolean} True if collision detected
     */
    static checkCollision(obj1, obj2, bufferDistance = 0) {
        const dx = obj1.x - obj2.x;
        const dy = obj1.y - obj2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = obj1.radius + obj2.radius + bufferDistance;
        
        return distance < minDistance;
    }

    /**
     * Get placement zone boundaries
     * @param {string} zoneName - Zone name
     * @returns {Object} Zone boundaries
     */
    static getPlacementZone(zoneName) {
        return PLACEMENT_ZONES[zoneName] || PLACEMENT_ZONES['any'];
    }

    /**
     * Apply archetype modifiers to object counts and properties
     * @param {string} archetype - System archetype
     * @param {string} objectType - Object type to modify
     * @param {Object} baseProperties - Base properties to modify
     * @returns {Object} Modified properties
     */
    static applyArchetypeModifiers(archetype, objectType, baseProperties) {
        const modifiers = ARCHETYPE_MODIFIERS[archetype];
        if (!modifiers || !modifiers[objectType]) {
            return baseProperties;
        }

        const modifier = modifiers[objectType];
        const result = { ...baseProperties };

        // Apply count multiplier
        if (modifier.countMultiplier && result.count !== undefined) {
            result.count = Math.round(result.count * modifier.countMultiplier);
        }

        // Apply specific bonuses to metadata
        if (modifier.resourceBonus && result.meta) {
            result.meta.resources = (result.meta.resources || 1.0) * modifier.resourceBonus;
        }
        if (modifier.mineralBonus && result.meta) {
            result.meta.mineral_content = (result.meta.mineral_content || 1.0) * modifier.mineralBonus;
        }
        if (modifier.interferenceBonus && result.meta) {
            result.meta.scan_interference = (result.meta.scan_interference || 0.3) * modifier.interferenceBonus;
        }

        return result;
    }

    /**
     * Validate object placement within sector boundaries
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} radius - Object radius
     * @param {number} sectorWidth - Sector width (default 5000)
     * @param {number} sectorHeight - Sector height (default 5000)
     * @returns {boolean} True if placement is valid
     */
    static validatePlacement(x, y, radius, sectorWidth = 5000, sectorHeight = 5000) {
        return (x - radius >= 0 && 
                x + radius <= sectorWidth && 
                y - radius >= 0 && 
                y + radius <= sectorHeight);
    }

    /**
     * Get all celestial object types sorted by placement priority
     * @returns {Array} Array of [type, definition] sorted by priority (highest first)
     */
    static getTypesByPriority() {
        return Object.entries(CELESTIAL_OBJECT_TYPES)
            .sort(([, a], [, b]) => b.placementPriority - a.placementPriority);
    }

    /**
     * Calculate orbital distance for planetary objects
     * @param {number} orbitIndex - Orbit number (0-based)
     * @param {number} baseDistance - Base orbital distance
     * @returns {number} Orbital distance from center
     */
    static calculateOrbitalDistance(orbitIndex, baseDistance = 400, rng = null) {
        // Orbital distances follow rough planetary spacing: each orbit ~300-700 tiles apart
        const variation = 0.2; // 20% variation
        const baseSpacing = 350;
        const distance = baseDistance + (orbitIndex * baseSpacing);
        const rand = rng ? (rng.random() - 0.5) : (Math.random() - 0.5);
        const variationAmount = distance * variation * rand;
        
        return Math.round(distance + variationAmount);
    }
}

module.exports = {
    CELESTIAL_OBJECT_TYPES,
    PLACEMENT_ZONES,
    ARCHETYPE_MODIFIERS,
    CelestialObjectManager
};