// System Generator - Phase 2
// Procedural generation engine for creating balanced solar systems

const { CelestialObjectManager, CELESTIAL_OBJECT_TYPES, PLACEMENT_ZONES, ARCHETYPE_MODIFIERS } = require('./celestial-objects');
const { ResourceNodeGenerator } = require('./resource-node-generator');
const db = require('./db');

/**
 * SystemGenerator - Main class for procedural solar system generation
 */
class SystemGenerator {
    /**
     * Generate a complete solar system for a sector
     * @param {number} sectorId - Database ID of the sector
     * @param {string} archetype - System archetype ('resource-rich', 'asteroid-heavy', 'nebula', 'binary-star')
     * @param {number} seed - Random seed for deterministic generation
     * @returns {Promise<Object>} Generation result with object counts and statistics
     */
    static async generateSystem(sectorId, archetype = null, seed = null) {
        console.log(`🌌 Starting system generation for sector ${sectorId} (archetype: ${archetype || 'standard'})`);
        
        // Generate seed if not provided
        if (!seed) {
            seed = Math.floor(Math.random() * 1000000);
        }
        
        // Initialize random number generator with seed
        const rng = new SeededRandom(seed);
        
        try {
            // Update sector with generation info
            await this.updateSectorGenerationInfo(sectorId, seed, false);
            
            // Initialize generation context
            const context = {
                sectorId,
                archetype,
                seed,
                rng,
                placedObjects: [],
                orbitalZones: [],
                generationStats: {
                    totalObjects: 0,
                    objectCounts: {},
                    placementAttempts: 0,
                    placementFailures: 0
                }
            };
            
            // Execute generation phases in priority order
            console.log(`📊 Phase 1: Generating stellar objects...`);
            await this.generateStellarObjects(context);
            
            console.log(`📊 Phase 2: Generating planetary objects...`);
            await this.generatePlanetaryObjects(context);
            
            console.log(`📊 Phase 3: Generating field objects...`);
            await this.generateFieldObjects(context);
            
            console.log(`📊 Phase 4: Generating artificial objects...`);
            await this.generateArtificialObjects(context);
            
            console.log(`📊 Phase 5: Generating anomalies...`);
            await this.generateAnomalies(context);
            
            console.log(`📊 Phase 6: Generating resource nodes...`);
            await ResourceNodeGenerator.generateNodesForSector(sectorId, seed);
            
            // Mark generation as complete
            await this.updateSectorGenerationInfo(sectorId, seed, true);
            
            // Log generation history
            await this.logGenerationHistory(context);
            
            console.log(`✅ System generation complete for sector ${sectorId}:`);
            console.log(`   • Total objects: ${context.generationStats.totalObjects}`);
            console.log(`   • Object breakdown:`, context.generationStats.objectCounts);
            console.log(`   • Placement efficiency: ${((context.generationStats.placementAttempts - context.generationStats.placementFailures) / context.generationStats.placementAttempts * 100).toFixed(1)}%`);
            
            return {
                success: true,
                seed,
                totalObjects: context.generationStats.totalObjects,
                objectCounts: context.generationStats.objectCounts,
                placementEfficiency: (context.generationStats.placementAttempts - context.generationStats.placementFailures) / context.generationStats.placementAttempts
            };
            
        } catch (error) {
            console.error(`❌ System generation failed for sector ${sectorId}:`, error);
            
            // Mark generation as failed
            await this.updateSectorGenerationInfo(sectorId, seed, false);
            
            throw error;
        }
    }
    
    /**
     * Generate stellar objects (stars)
     */
    static async generateStellarObjects(context) {
        const stellarTypes = CelestialObjectManager.getObjectsByCategory('stellar');
        
        for (const [objectType, definition] of Object.entries(stellarTypes)) {
            // Apply archetype modifiers
            if (context.archetype === 'binary-star' && objectType === 'star') {
                // Special case: binary star system
                await this.placeBinaryStars(context);
                continue;
            }
            
            if (objectType === 'binary-star' && context.archetype !== 'binary-star') {
                continue; // Skip binary stars unless explicitly requested
            }
            
            const count = this.calculateObjectCount(definition, context.archetype, context.rng);
            
            for (let i = 0; i < count; i++) {
                await this.placeObject(objectType, context);
            }
        }
    }
    
    /**
     * Generate planetary objects (planets, moons)
     */
    static async generatePlanetaryObjects(context) {
        // First, generate orbital zones based on placed stars
        this.calculateOrbitalZones(context);
        
        // Generate planets in orbital zones
        const planetDefinition = CELESTIAL_OBJECT_TYPES.planet;
        const planetCount = this.calculateObjectCount(planetDefinition, context.archetype, context.rng);
        
        console.log(`🪐 Generating ${planetCount} planets in ${context.orbitalZones.length} orbital zones`);
        
        for (let i = 0; i < planetCount; i++) {
            await this.placePlanetInOrbit(context, i);
        }
        
        // Generate gas giants in outer zones
        if (context.rng.random() < 0.4) { // 40% chance for gas giants
            const gasGiantCount = context.rng.randInt(1, 2);
            for (let i = 0; i < gasGiantCount; i++) {
                await this.placeGasGiant(context);
            }
        }
        
        // Generate moons for suitable planets
        await this.generateMoons(context);
    }
    
    /**
     * Generate field objects (asteroid belts, nebulae)
     */
    static async generateFieldObjects(context) {
        // Asteroid belts - place between orbital zones
        const beltDefinition = CELESTIAL_OBJECT_TYPES.belt;
        const beltCount = this.calculateObjectCount(beltDefinition, context.archetype, context.rng);
        
        for (let i = 0; i < beltCount; i++) {
            await this.placeAsteroidBelt(context);
        }
        
        // Nebulae - place in outer zones
        const nebulaDefinition = CELESTIAL_OBJECT_TYPES.nebula;
        const nebulaCount = this.calculateObjectCount(nebulaDefinition, context.archetype, context.rng);
        
        for (let i = 0; i < nebulaCount; i++) {
            await this.placeObject('nebula', context);
        }
    }
    
    /**
     * Generate artificial objects (wormholes, jump gates, derelicts)
     */
    static async generateArtificialObjects(context) {
        const artificialTypes = ['wormhole', 'jump-gate', 'derelict'];
        
        for (const objectType of artificialTypes) {
            if (!CELESTIAL_OBJECT_TYPES[objectType]) continue;
            
            const definition = CELESTIAL_OBJECT_TYPES[objectType];
            const count = this.calculateObjectCount(definition, context.archetype, context.rng);
            
            for (let i = 0; i < count; i++) {
                await this.placeObject(objectType, context);
            }
        }
    }
    
    /**
     * Generate anomalies (graviton sinks, etc.)
     */
    static async generateAnomalies(context) {
        // Graviton sinks are rare - only 20% chance
        if (context.rng.random() < 0.2) {
            await this.placeObject('graviton-sink', context);
        }
    }
    
    /**
     * Place a binary star system
     */
    static async placeBinaryStars(context) {
        const definition = CELESTIAL_OBJECT_TYPES['binary-star'];
        
        // Primary star position (slightly off-center)
        const centerX = 2300 + context.rng.randInt(0, 400); // 2300-2700
        const centerY = 2300 + context.rng.randInt(0, 400);
        
        const primaryRadius = CelestialObjectManager.calculateRadius('binary-star', context.rng.random());
        const secondaryRadius = CelestialObjectManager.calculateRadius('binary-star', context.rng.random());
        
        // Place primary star
        const primaryMeta = CelestialObjectManager.generateMetadata('binary-star', {
            name: 'Primary Star',
            luminosity: 1.0,
            stellar_class: 'A'
        });
        
        await this.insertObject(context.sectorId, 'star', centerX, centerY, primaryRadius, null, primaryMeta);
        context.placedObjects.push({ x: centerX, y: centerY, radius: primaryRadius, type: 'star' });
        
        // Place secondary star
        const separation = 200 + context.rng.randInt(0, 300); // 200-500 tiles apart
        const angle = context.rng.random() * 2 * Math.PI;
        const secondaryX = Math.round(centerX + Math.cos(angle) * separation);
        const secondaryY = Math.round(centerY + Math.sin(angle) * separation);
        
        const secondaryMeta = CelestialObjectManager.generateMetadata('binary-star', {
            name: 'Secondary Star',
            luminosity: 0.7,
            stellar_class: 'K'
        });
        
        await this.insertObject(context.sectorId, 'star', secondaryX, secondaryY, secondaryRadius, null, secondaryMeta);
        context.placedObjects.push({ x: secondaryX, y: secondaryY, radius: secondaryRadius, type: 'star' });
        
        // Update stats
        this.updateGenerationStats(context, 'star', 2);
        
        console.log(`⭐ Placed binary star system: Primary at (${centerX},${centerY}), Secondary at (${secondaryX},${secondaryY})`);
    }
    
    /**
     * Calculate orbital zones around stars
     */
    static calculateOrbitalZones(context) {
        const stars = context.placedObjects.filter(obj => obj.type === 'star');
        
        if (stars.length === 0) {
            console.warn('⚠️ No stars found for orbital zone calculation');
            return;
        }
        
        // For binary systems, calculate barycenter
        let centerX, centerY;
        if (stars.length === 2) {
            centerX = (stars[0].x + stars[1].x) / 2;
            centerY = (stars[0].y + stars[1].y) / 2;
        } else {
            centerX = stars[0].x;
            centerY = stars[0].y;
        }
        
        // Generate 6-8 orbital zones
        const zoneCount = 6 + context.rng.randInt(0, 3);
        const baseDistance = 400 + Math.max(...stars.map(s => s.radius)) + 100; // Start beyond star radius + buffer
        
        for (let i = 0; i < zoneCount; i++) {
            const distance = CelestialObjectManager.calculateOrbitalDistance(i, baseDistance);
            context.orbitalZones.push({
                index: i,
                distance,
                centerX,
                centerY,
                occupied: false
            });
        }
        
        console.log(`🌌 Calculated ${zoneCount} orbital zones around stellar center (${centerX.toFixed(0)},${centerY.toFixed(0)})`);
    }
    
    /**
     * Place a planet in an orbital zone
     */
    static async placePlanetInOrbit(context, planetIndex) {
        const availableZones = context.orbitalZones.filter(zone => !zone.occupied);
        
        if (availableZones.length === 0) {
            console.warn('⚠️ No available orbital zones for planet placement');
            return;
        }
        
        // Select zone (prefer inner zones for first few planets)
        let selectedZone;
        if (planetIndex < 3 && availableZones.some(z => z.distance < 800)) {
            // Prefer inner zones for first 3 planets
            selectedZone = availableZones.filter(z => z.distance < 800)[0];
        } else {
            // Random selection from available zones
            selectedZone = availableZones[context.rng.randInt(0, availableZones.length)];
        }
        
        // Calculate orbital position
        const angle = context.rng.random() * 2 * Math.PI;
        const x = Math.round(selectedZone.centerX + Math.cos(angle) * selectedZone.distance);
        const y = Math.round(selectedZone.centerY + Math.sin(angle) * selectedZone.distance);
        
        // Validate placement
        if (!CelestialObjectManager.validatePlacement(x, y, 15, 5000, 5000)) {
            console.warn(`⚠️ Planet placement out of bounds: (${x},${y})`);
            return;
        }
        
        // Check collisions
        const radius = CelestialObjectManager.calculateRadius('planet', context.rng.random());
        const bufferDistance = CELESTIAL_OBJECT_TYPES.planet.bufferDistance;
        
        for (const existing of context.placedObjects) {
            if (CelestialObjectManager.checkCollision(
                { x, y, radius },
                existing,
                bufferDistance
            )) {
                console.warn(`⚠️ Planet collision detected at (${x},${y}), skipping`);
                return;
            }
        }
        
        // Determine planet type based on orbital zone
        let planetType = 'terrestrial';
        let habitability = 0.3 + context.rng.random() * 0.6; // 0.3-0.9
        let resources = 0.8 + context.rng.random() * 0.4; // 0.8-1.2
        
        if (selectedZone.distance < 600) {
            planetType = 'hot';
            habitability *= 0.5; // Too hot
        } else if (selectedZone.distance > 1200) {
            planetType = 'cold';
            habitability *= 0.6; // Too cold
        }
        
        // Apply archetype bonuses
        if (context.archetype === 'resource-rich') {
            resources *= 1.5;
        }
        
        const meta = CelestialObjectManager.generateMetadata('planet', {
            name: `Planet ${String.fromCharCode(65 + planetIndex)}`, // Planet A, B, C, etc.
            type: planetType,
            orbital_zone: selectedZone.index,
            orbital_distance: selectedZone.distance,
            habitability,
            resources
        });
        
        await this.insertObject(context.sectorId, 'planet', x, y, radius, null, meta);
        context.placedObjects.push({ x, y, radius, type: 'planet', id: context.placedObjects.length });
        
        // Mark zone as occupied
        selectedZone.occupied = true;
        
        this.updateGenerationStats(context, 'planet', 1);
        
        console.log(`🪐 Placed ${planetType} planet "${meta.name}" at orbital zone ${selectedZone.index} (${x},${y}), habitability: ${habitability.toFixed(2)}`);
    }
    
    /**
     * Place gas giant in outer zones
     */
    static async placeGasGiant(context) {
        const outerZones = context.orbitalZones.filter(zone => !zone.occupied && zone.distance > 1000);
        
        if (outerZones.length === 0) {
            console.warn('⚠️ No available outer zones for gas giant');
            return;
        }
        
        const selectedZone = outerZones[context.rng.randInt(0, outerZones.length)];
        const angle = context.rng.random() * 2 * Math.PI;
        const x = Math.round(selectedZone.centerX + Math.cos(angle) * selectedZone.distance);
        const y = Math.round(selectedZone.centerY + Math.sin(angle) * selectedZone.distance);
        
        const radius = CelestialObjectManager.calculateRadius('gas-giant', context.rng.random());
        
        const meta = CelestialObjectManager.generateMetadata('gas-giant', {
            name: `Gas Giant ${String.fromCharCode(71 + context.generationStats.objectCounts['gas-giant'] || 0)}`, // Gas Giant G, H, etc.
            orbital_zone: selectedZone.index,
            orbital_distance: selectedZone.distance,
            moon_potential: 3 // High potential for moons
        });
        
        await this.insertObject(context.sectorId, 'planet', x, y, radius, null, meta);
        context.placedObjects.push({ x, y, radius, type: 'gas-giant', id: context.placedObjects.length });
        
        selectedZone.occupied = true;
        this.updateGenerationStats(context, 'gas-giant', 1);
        
        console.log(`🪐 Placed gas giant "${meta.name}" at orbital zone ${selectedZone.index} (${x},${y})`);
    }
    
    /**
     * Generate moons for planets
     */
    static async generateMoons(context) {
        const planets = context.placedObjects.filter(obj => obj.type === 'planet' || obj.type === 'gas-giant');
        
        for (const planet of planets) {
            const moonCount = this.calculateMoonCount(planet, context.rng);
            
            for (let i = 0; i < moonCount; i++) {
                await this.placeMoon(context, planet, i);
            }
        }
    }
    
    /**
     * Calculate number of moons for a planet
     */
    static calculateMoonCount(planet, rng) {
        let baseProbability = 0.3; // 30% base chance per moon slot
        
        if (planet.type === 'gas-giant') {
            baseProbability = 0.8; // Gas giants more likely to have moons
        }
        
        let moonCount = 0;
        for (let i = 0; i < 3; i++) { // Max 3 moons
            if (rng.random() < baseProbability) {
                moonCount++;
                baseProbability *= 0.6; // Diminishing probability for additional moons
            }
        }
        
        return moonCount;
    }
    
    /**
     * Place a moon around a planet
     */
    static async placeMoon(context, planet, moonIndex) {
        const moonDistance = 30 + (moonIndex * 20) + context.rng.randInt(0, 20); // 30-90 tiles from planet
        const angle = context.rng.random() * 2 * Math.PI;
        
        const x = Math.round(planet.x + Math.cos(angle) * moonDistance);
        const y = Math.round(planet.y + Math.sin(angle) * moonDistance);
        
        if (!CelestialObjectManager.validatePlacement(x, y, 5, 5000, 5000)) {
            return; // Skip if out of bounds
        }
        
        const radius = CelestialObjectManager.calculateRadius('moon', context.rng.random());
        
        const meta = CelestialObjectManager.generateMetadata('moon', {
            name: `Moon ${moonIndex + 1}`,
            orbital_distance: moonDistance,
            parent_planet: planet.id
        });
        
        await this.insertObject(context.sectorId, 'moon', x, y, radius, planet.id, meta);
        context.placedObjects.push({ x, y, radius, type: 'moon', parentId: planet.id });
        
        this.updateGenerationStats(context, 'moon', 1);
        
        console.log(`🌙 Placed moon "${meta.name}" around planet at (${x},${y}), distance: ${moonDistance}`);
    }
    
    /**
     * Place asteroid belt between orbital zones
     */
    static async placeAsteroidBelt(context) {
        if (context.orbitalZones.length < 2) return;
        
        // Find gap between occupied zones
        const occupiedZones = context.orbitalZones.filter(z => z.occupied).sort((a, b) => a.distance - b.distance);
        
        if (occupiedZones.length < 2) return;
        
        // Place belt between two zones
        const zone1 = occupiedZones[context.rng.randInt(0, occupiedZones.length - 1)];
        const zone2 = occupiedZones.find(z => z.distance > zone1.distance);
        
        if (!zone2) return;
        
        const beltDistance = (zone1.distance + zone2.distance) / 2;
        const angle = context.rng.random() * 2 * Math.PI;
        
        const x = Math.round(zone1.centerX + Math.cos(angle) * beltDistance);
        const y = Math.round(zone1.centerY + Math.sin(angle) * beltDistance);
        
        const radius = CelestialObjectManager.calculateRadius('belt', context.rng.random());
        
        const meta = CelestialObjectManager.generateMetadata('belt', {
            name: `Asteroid Belt ${context.generationStats.objectCounts.belt + 1 || 1}`,
            orbital_distance: beltDistance,
            density: context.archetype === 'asteroid-heavy' ? 'high' : 'medium'
        });
        
        await this.insertObject(context.sectorId, 'belt', x, y, radius, null, meta);
        context.placedObjects.push({ x, y, radius, type: 'belt' });
        
        this.updateGenerationStats(context, 'belt', 1);
        
        console.log(`🪨 Placed asteroid belt at (${x},${y}), radius: ${radius}`);
    }
    
    /**
     * Place a generic object with collision checking
     */
    static async placeObject(objectType, context, maxAttempts = 10) {
        const definition = CELESTIAL_OBJECT_TYPES[objectType];
        if (!definition) return;
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            context.generationStats.placementAttempts++;
            
            const position = this.generatePosition(definition.placementZone, context.rng);
            const radius = CelestialObjectManager.calculateRadius(objectType, context.rng.random());
            
            // Validate placement
            if (!CelestialObjectManager.validatePlacement(position.x, position.y, radius, 5000, 5000)) {
                context.generationStats.placementFailures++;
                continue;
            }
            
            // Check collisions
            let collision = false;
            for (const existing of context.placedObjects) {
                if (CelestialObjectManager.checkCollision(
                    { x: position.x, y: position.y, radius },
                    existing,
                    definition.bufferDistance
                )) {
                    collision = true;
                    break;
                }
            }
            
            if (collision) {
                context.generationStats.placementFailures++;
                continue;
            }
            
            // Success! Place the object
            const meta = CelestialObjectManager.generateMetadata(objectType, {
                name: `${definition.name} ${context.generationStats.objectCounts[objectType] + 1 || 1}`
            });
            
            await this.insertObject(context.sectorId, objectType, position.x, position.y, radius, null, meta);
            context.placedObjects.push({ x: position.x, y: position.y, radius, type: objectType });
            
            this.updateGenerationStats(context, objectType, 1);
            
            console.log(`✨ Placed ${objectType} "${meta.name}" at (${position.x},${position.y}), radius: ${radius}`);
            return;
        }
        
        console.warn(`⚠️ Failed to place ${objectType} after ${maxAttempts} attempts`);
    }
    
    /**
     * Generate position based on placement zone
     */
    static generatePosition(zoneName, rng) {
        const zone = CelestialObjectManager.getPlacementZone(zoneName);
        
        if (zone.type === 'orbital') {
            // Special orbital placement around center
            const distance = 500 + rng.randInt(0, 1000);
            const angle = rng.random() * 2 * Math.PI;
            return {
                x: Math.round(zone.centerX + Math.cos(angle) * distance),
                y: Math.round(zone.centerY + Math.sin(angle) * distance)
            };
        }
        
        if (zone.edgeConstraint) {
            // Place near edges
            const side = rng.randInt(0, 4);
            if (side === 0) return { x: rng.randInt(zone.minX, zone.maxX), y: zone.minY + rng.randInt(0, 200) };
            if (side === 1) return { x: zone.maxX - rng.randInt(0, 200), y: rng.randInt(zone.minY, zone.maxY) };
            if (side === 2) return { x: rng.randInt(zone.minX, zone.maxX), y: zone.maxY - rng.randInt(0, 200) };
            return { x: zone.minX + rng.randInt(0, 200), y: rng.randInt(zone.minY, zone.maxY) };
        }
        
        return {
            x: rng.randInt(zone.minX, zone.maxX),
            y: rng.randInt(zone.minY, zone.maxY)
        };
    }
    
    /**
     * Calculate object count with archetype modifiers
     */
    static calculateObjectCount(definition, archetype, rng) {
        let baseCount = definition.minCount + rng.randInt(0, definition.maxCount - definition.minCount + 1);
        
        // Apply archetype modifiers
        const modifiers = CelestialObjectManager.applyArchetypeModifiers(archetype, definition.name.toLowerCase(), { count: baseCount });
        
        return Math.max(0, modifiers.count);
    }
    
    /**
     * Insert object into database
     */
    static async insertObject(sectorId, type, x, y, radius, parentId, meta) {
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO sector_objects (sector_id, type, x, y, radius, celestial_type, parent_object_id, meta, owner_id) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
                [sectorId, type, x, y, radius, type, parentId, JSON.stringify(meta)],
                function(err) {
                    if (err) {
                        console.error('Database insertion error:', err);
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                }
            );
        });
    }
    
    /**
     * Update sector generation info
     */
    static async updateSectorGenerationInfo(sectorId, seed, completed) {
        return new Promise((resolve, reject) => {
            db.run(
                'UPDATE sectors SET generation_seed = ?, generation_completed = ? WHERE id = ?',
                [seed, completed, sectorId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
    
    /**
     * Log generation history
     */
    static async logGenerationHistory(context) {
        for (const [objectType, count] of Object.entries(context.generationStats.objectCounts)) {
            await new Promise((resolve, reject) => {
                db.run(
                    'INSERT INTO generation_history (sector_id, generation_seed, celestial_type, object_count, archetype) VALUES (?, ?, ?, ?, ?)',
                    [context.sectorId, context.seed, objectType, count, context.archetype],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }
    }
    
    /**
     * Update generation statistics
     */
    static updateGenerationStats(context, objectType, count = 1) {
        if (!context.generationStats.objectCounts[objectType]) {
            context.generationStats.objectCounts[objectType] = 0;
        }
        context.generationStats.objectCounts[objectType] += count;
        context.generationStats.totalObjects += count;
    }
}

/**
 * Seeded Random Number Generator
 * Ensures deterministic generation with the same seed
 */
class SeededRandom {
    constructor(seed) {
        this.seed = seed % 2147483647;
        if (this.seed <= 0) this.seed += 2147483646;
    }
    
    random() {
        this.seed = this.seed * 16807 % 2147483647;
        return (this.seed - 1) / 2147483646;
    }
    
    randInt(min, max) {
        return Math.floor(this.random() * (max - min)) + min;
    }
}

module.exports = { SystemGenerator, SeededRandom };