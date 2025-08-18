const express = require('express');
const db = require('../db');
const { SystemGenerator } = require('../system-generator');
const { CargoManager } = require('../cargo-manager');
const { SHIP_BLUEPRINTS, computeAllRequirements } = require('../blueprints');
const { Abilities } = require('../abilities');
const { SECTOR_ARCHETYPES } = require('../archetypes');
const { HarvestingManager } = require('../harvesting-manager');
const router = express.Router();

// Game initialization and management
class GameWorldManager {
    // Initialize a new game world when game starts
    static async initializeGame(gameId) {
        return new Promise((resolve, reject) => {
            console.log(`🚀 Initializing game world for game ${gameId}`);
            
            // Get all players in the game
            db.all(
                `SELECT gp.user_id, u.username 
                 FROM game_players gp 
                 JOIN users u ON gp.user_id = u.id 
                 WHERE gp.game_id = ?`,
                [gameId],
                (err, players) => {
                    if (err) {
                        console.error('Error fetching players:', err);
                        return reject(err);
                    }
                    
                    if (players.length === 0) {
                        return reject(new Error('No players found for this game'));
                    }
                    
                    console.log(`👥 Found ${players.length} players:`, players.map(p => p.username));
                    
                    // Process each player sequentially
                    this.createPlayerSectors(gameId, players, 0, resolve, reject);
                }
            );
        });
    }
    
    // Create sectors for players sequentially
    static createPlayerSectors(gameId, players, index, resolve, reject) {
        if (index >= players.length) {
            // All players processed, initialize first turn
            console.log('✅ All player sectors created, initializing turn system');
            this.initializeTurnSystem(gameId, resolve, reject);
            return;
        }
        
        const player = players[index];
        const sectorName = `${player.username}'s Domain`;
        
        console.log(`🌍 Creating sector for ${player.username}`);
        
        // Create sector with randomized gate slots (2–4)
        const initialGateSlots = 2 + Math.floor(Math.random() * 3); // 2,3,4
        db.run(
            'INSERT INTO sectors (game_id, owner_id, name, archetype, gate_slots) VALUES (?, ?, ?, ?, ?)',
            [gameId, player.user_id, sectorName, GameWorldManager.pickRandomArchetype(gameId, player.user_id), initialGateSlots],
            function(err) {
                if (err) {
                    console.error('Error creating sector:', err);
                    return reject(err);
                }
                
                const sectorId = this.lastID;
                console.log(`📍 Created sector ${sectorId} for ${player.username}`);
                
                // Generate celestial objects and create starting objects for this player
                GameWorldManager.generateSectorAndStartingObjects(gameId, player, sectorId, () => {
                    // Process next player
                    GameWorldManager.createPlayerSectors(gameId, players, index + 1, resolve, reject);
                }, reject);
            }
        );
    }
    
    // Generate celestial objects and create starting objects for a player
    static async generateSectorAndStartingObjects(gameId, player, sectorId, onComplete, onError) {
        try {
            console.log(`🌌 Generating celestial objects for ${player.username}'s sector ${sectorId}`);
            
            // Get sector info to determine archetype
            const sector = await new Promise((resolve, reject) => {
                db.get('SELECT archetype FROM sectors WHERE id = ?', [sectorId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            // If archetype not assigned for some reason, assign now and persist
            let archetype = sector?.archetype || null;
            if (!archetype) {
                archetype = GameWorldManager.pickRandomArchetype(gameId, player.user_id);
                await new Promise((resolve) => db.run('UPDATE sectors SET archetype = ? WHERE id = ?', [archetype, sectorId], () => resolve()));
            }
            console.log(`🎯 Using archetype: ${archetype || 'standard'} for sector ${sectorId}`);
            
            // Generate the complete solar system
            const generationResult = await SystemGenerator.generateSystem(sectorId, archetype);
            console.log(`✅ System generation complete:`, generationResult);
            
            // Now create starting objects in a suitable location
            this.createStartingObjects(gameId, player, sectorId, onComplete, onError);
            
        } catch (error) {
            console.error(`❌ Failed to generate sector ${sectorId}:`, error);
            onError(error);
        }
    }

    // Deterministic-ish random archetype picker using gameId and userId
    static pickRandomArchetype(gameId, userId) {
        const archetypes = require('../archetypes').ALL_ARCHETYPES_KEYS;
        const seed = (Number(gameId) * 9301 + Number(userId) * 49297) % 233280;
        const r = (seed / 233280);
        const idx = Math.floor(r * archetypes.length) % archetypes.length;
        return archetypes[idx];
    }
    
    // Create starting objects for a player
    static createStartingObjects(gameId, player, sectorId, onComplete, onError) {
        // Find a planet with no existing anchored station to spawn near/anchor to
        db.get(
            `SELECT p.id, p.x, p.y, p.meta
             FROM sector_objects p
             LEFT JOIN sector_objects s ON s.parent_object_id = p.id AND s.type = 'station'
             WHERE p.sector_id = ? AND p.celestial_type = 'planet' AND s.id IS NULL
             ORDER BY RANDOM() LIMIT 1`,
            [sectorId],
            (err, planet) => {
                if (err) {
                    console.error('Error finding spawn planet:', err);
                    return onError(err);
                }
                
                let spawnX, spawnY;
                
                if (planet) {
                    // Place on the same 35–45 tile ring used by manual planet-station deploys
                    // while still anchoring to the planet via parent_object_id
                    const planetMeta = JSON.parse(planet.meta || '{}');
                    const distance = 35 + Math.floor(Math.random() * 11); // 35..45
                    const angle = Math.random() * 2 * Math.PI;
                    spawnX = Math.round(planet.x + Math.cos(angle) * distance);
                    spawnY = Math.round(planet.y + Math.sin(angle) * distance);
                    // Clamp within bounds
                    spawnX = Math.max(1, Math.min(4999, spawnX));
                    spawnY = Math.max(1, Math.min(4999, spawnY));
                    console.log(`🌍 Spawning ${player.username} on ring ${distance}T from planet "${planetMeta.name}" at (${spawnX}, ${spawnY}) [planetId=${planet.id}]`);
                } else {
                    // Fallback to safe zone if no planets found (shouldn't happen with our generator)
                    spawnX = 1000 + Math.floor(Math.random() * 3000);
                    spawnY = 1000 + Math.floor(Math.random() * 3000);
                    console.warn(`⚠️ No planets found for ${player.username}, using fallback spawn at (${spawnX}, ${spawnY})`);
                }
                
                // Create starting station: standard planet-station baseline for now
                const stationClass = 'planet-station';
                const starbaseMetaObj = {
                    name: `${player.username} Station`,
                    hp: 100,
                    maxHp: 100,
                    scanRange: 200,
                    cargoCapacity: 50,
                    stationClass
                };
                const starbaseMeta = JSON.stringify(starbaseMetaObj);

                // Helper: create starter ship and initialize visibility after station placement
                const proceedAfterStation = (starbaseId) => {
                    const { SHIP_BLUEPRINTS } = require('../blueprints');
                    const explorer = (SHIP_BLUEPRINTS || []).find(b => b.id === 'explorer');
                    const resolved = explorer || {
                        class: 'frigate',
                        scanRange: 50,
                        movementSpeed: 4,
                        cargoCapacity: 10,
                        harvestRate: 1.0,
                        abilities: ['dual_light_coilguns','boost_engines','jury_rig_repair','survey_scanner','duct_tape_resilience']
                    };
                    const shipMetaObj = {
                        name: `${player.username} Explorer`,
                        ...resolved,
                        shipType: resolved.class,
                        blueprintId: resolved.id || 'explorer'
                    };
                    const shipMeta = JSON.stringify(shipMetaObj);

                    db.run(
                        'INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta, scan_range, movement_speed, can_active_scan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [sectorId, 'ship', spawnX + 1, spawnY, player.user_id, shipMeta, shipMetaObj.scanRange, shipMetaObj.movementSpeed, shipMetaObj.canActiveScan ? 1 : 0],
                        function(err) {
                            if (err) {
                                console.error('Error creating ship:', err);
                                return onError(err);
                            }
                            console.log(`🚢 Created ship for ${player.username} at (${spawnX + 1}, ${spawnY})`);
                            GameWorldManager.initializeVisibility(gameId, player.user_id, sectorId, spawnX, spawnY, onComplete, onError);
                        }
                    );
                };

                const insertAnchored = (parentId) => {
                    // Ensure uniqueness: one station per parent object (planet)
                    const ensureUnique = (cb) => {
                        if (!parentId) return cb();
                        db.get(`SELECT id FROM sector_objects WHERE type = 'station' AND parent_object_id = ? LIMIT 1`, [parentId], (e, r) => {
                            if (e) return cb(e);
                            if (r) return cb(new Error('station_already_anchored'));
                            cb();
                        });
                    };
                    ensureUnique((uniqueErr) => {
                        if (uniqueErr) {
                            console.warn(`⚠️ Planet ${parentId} already has a station; selecting fallback for ${player.username}`);
                            // Fallback: place slightly away but still in sector (unanchored)
                            db.run(
                                `INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta, parent_object_id) VALUES (?, 'station', ?, ?, ?, ?, NULL)`,
                                [sectorId, spawnX, spawnY, player.user_id, starbaseMeta],
                                function(err) {
                                    if (err) {
                                        console.error('Error creating fallback station:', err);
                                        return onError(err);
                                    }
                                    const starbaseId = this.lastID;
                                    console.log(`🏭 Created fallback station (unanchored) for ${player.username} at (${spawnX}, ${spawnY})`);
                                    // Continue flow
                                    CargoManager.initializeObjectCargo(starbaseId, 50)
                                        .then(() => CargoManager.addResourceToCargo(starbaseId, 'rock', 25, false))
                                        .catch(error => console.error('Error initializing station cargo or adding rocks:', error));
                                    // Create starting ship adjacent to starbase
                                    proceedAfterStation(starbaseId);
                                }
                            );
                            return;
                        }
                        db.run(
                            `INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta, parent_object_id) VALUES (?, 'station', ?, ?, ?, ?, ?)`,
                            [sectorId, spawnX, spawnY, player.user_id, starbaseMeta, parentId || null],
                        function(err) {
                            if (err) {
                                console.error('Error creating anchored station:', err);
                                return onError(err);
                            }
                            const starbaseId = this.lastID;
                            console.log(`🏭 Created anchored ${stationClass} for ${player.username} at (${spawnX}, ${spawnY}) parent=${parentId || 'none'}`);
                            
                            // Initialize cargo system for the station
                            CargoManager.initializeObjectCargo(starbaseId, 50)
                                .then(() => {
                                    return CargoManager.addResourceToCargo(starbaseId, 'rock', 25, false);
                                })
                                .catch(error => {
                                    console.error('Error initializing station cargo or adding rocks:', error);
                                });
                            
                            proceedAfterStation(starbaseId);
                        }
                        );
                    });
                };

                if (planet && planet.id) {
                    insertAnchored(planet.id);
                } else {
                    db.get(`SELECT id FROM sector_objects WHERE sector_id = ? AND celestial_type = 'sun' LIMIT 1`, [sectorId], (e2, sunRow) => {
                        insertAnchored(sunRow && sunRow.id ? sunRow.id : null);
                    });
                }
            }
        );
    }
    
    // Initialize visibility memory around starting position via object-based system
    static initializeVisibility(gameId, userId, sectorId, centerX, centerY, onComplete, onError) {
        db.get('SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [gameId], (e, row) => {
            const turnNumber = row?.turn_number || 1;
            GameWorldManager.calculatePlayerVision(gameId, userId, turnNumber)
                .then(() => onComplete())
                .catch(onError);
        });
    }
    
    // Initialize turn system
    static initializeTurnSystem(gameId, resolve, reject) {
        // Create first turn
        db.run(
            'INSERT INTO turns (game_id, turn_number, status) VALUES (?, ?, ?)',
            [gameId, 1, 'waiting'],
            function(err) {
                if (err) {
                    console.error('Error creating initial turn:', err);
                    return reject(err);
                }
                
                console.log('⏰ Turn system initialized');
                resolve({ 
                    success: true, 
                    message: 'Game world initialized successfully',
                    turnId: this.lastID
                });
            }
        );
    }

    // Calculate combined vision from all player units
    static async calculatePlayerVision(gameId, userId, turnNumber) {
        return new Promise((resolve, reject) => {
                    db.all(
                'SELECT id, sector_id, x, y, meta FROM sector_objects WHERE owner_id = ? AND type IN ("ship", "station")',
                [userId],
                        (err, units) => {
                            if (err) return reject(err);
                    if (!units || units.length === 0) return resolve([]);

                    // Group by sector to batch queries
                    const sectorIdToUnits = new Map();
                    for (const u of units) {
                        if (!sectorIdToUnits.has(u.sector_id)) sectorIdToUnits.set(u.sector_id, []);
                        sectorIdToUnits.get(u.sector_id).push(u);
                    }

                            const visibleObjects = new Map(); // objectId -> {object, visibilityLevel}
                    let sectorsProcessed = 0;

                    for (const [sectorId, sectorUnits] of sectorIdToUnits.entries()) {
                        // Compute bounding box for this sector's units
                        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                        const sensors = sectorUnits.map(u => {
                            const meta = (() => { try { return JSON.parse(u.meta || '{}'); } catch { return {}; } })();
                            let scanRange = meta.scanRange || 5;
                            let detailedRange = meta.detailedScanRange || Math.floor((scanRange || 1) / 3);
                            // Apply active survey scanner effect when present (multiplier)
                            // Read effects directly for this unit
                            try {
                                // Synchronous read via db.prepare isn't available here in this style; do a simple multiplier present in meta (fallback).
                                if (typeof meta.scanRangeMultiplier === 'number' && meta.scanRangeMultiplier > 1) {
                                    scanRange = Math.ceil(scanRange * meta.scanRangeMultiplier);
                                    detailedRange = Math.ceil(detailedRange * meta.scanRangeMultiplier);
                                }
                            } catch {}
                            minX = Math.min(minX, u.x - scanRange);
                            maxX = Math.max(maxX, u.x + scanRange);
                            minY = Math.min(minY, u.y - scanRange);
                            maxY = Math.max(maxY, u.y + scanRange);
                            return { x: u.x, y: u.y, scanRange, detailedRange };
                        });

                                db.all(
                            'SELECT * FROM sector_objects WHERE sector_id = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?',
                            [sectorId, minX, maxX, minY, maxY],
                            (e2, objectsInBox) => {
                                if (e2) return reject(e2);
                                for (const obj of objectsInBox) {
                                    for (const s of sensors) {
                                        const dx = obj.x - s.x;
                                        const dy = obj.y - s.y;
                                        const dist = Math.sqrt(dx * dx + dy * dy);
                                        if (dist <= s.scanRange) {
                                            const lvl = dist <= s.detailedRange ? 2 : 1;
                                                const existing = visibleObjects.get(obj.id);
                                            if (!existing || existing.visibilityLevel < lvl) {
                                                visibleObjects.set(obj.id, { object: obj, visibilityLevel: lvl });
                                            }
                                        }
                                    }
                                }
                                sectorsProcessed++;
                                if (sectorsProcessed === sectorIdToUnits.size) {
                                    // Persist memory per sector
                                    const bySector = new Map();
                                    for (const v of visibleObjects.values()) {
                                        const sid = v.object.sector_id;
                                        if (!bySector.has(sid)) bySector.set(sid, []);
                                        bySector.get(sid).push(v);
                                    }
                                    let done = 0; const total = bySector.size;
                                    if (total === 0) return resolve([]);
                                    for (const [sid, list] of bySector.entries()) {
                                        GameWorldManager.updateObjectVisibilityMemory(
                                            gameId, userId, sid, list, turnNumber,
                                            () => { if (++done === total) resolve(list.map(v => v.object)); },
                                            reject
                                        );
                                    }
                                }
                            }
                        );
                    }
                }
            );
        });
    }

    // STAGE 2 OPTIMIZATION: Batch database operations for visibility updates
    static updatePlayerVisibilityOptimized(gameId, userId, sectorId, visibleObjects, turnNumber, resolve, reject) {
        if (visibleObjects.length === 0) {
            console.log(`👁️ No objects visible for player ${userId} on turn ${turnNumber}`);
            return resolve([]);
        }
        // This method is deprecated; keep signature for compatibility
        return resolve([]);
    }

    // Legacy method kept for compatibility if needed
    static updatePlayerVisibility(gameId, userId, sectorId, visionTiles, detailedScanTiles, turnNumber, resolve, reject) {
        let updateCount = 0;
        const totalUpdates = visionTiles.size;
        
        if (totalUpdates === 0) {
            return resolve([]);
        }
        
        visionTiles.forEach(tileKey => {
            const [x, y] = tileKey.split(',').map(Number);
            const visibilityLevel = detailedScanTiles.has(tileKey) ? 2 : 1; // 2=detailed, 1=basic
            
            // Write into object_visibility by mapping tiles to existing objects for detailed tiles only
            db.all(
                'SELECT id FROM sector_objects WHERE sector_id = ? AND x = ? AND y = ?',
                [sectorId, x, y],
                (objErr, rows) => {
                    if (objErr) {
                        console.error('Error querying objects for visibility:', objErr);
                        return reject(objErr);
                    }
                    if (!rows || rows.length === 0) {
                    updateCount++;
                    if (updateCount === totalUpdates) {
                        console.log(`👁️ Updated ${totalUpdates} visibility tiles for player ${userId} on turn ${turnNumber}`);
                        resolve(Array.from(visionTiles));
                    }
                        return;
                    }
                    const stmt = db.prepare(
                        `INSERT INTO object_visibility (game_id, user_id, sector_id, object_id, last_seen_turn, last_seen_at, best_visibility_level)
                         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
                         ON CONFLICT(game_id, user_id, sector_id, object_id)
                         DO UPDATE SET last_seen_turn=excluded.last_seen_turn, last_seen_at=CURRENT_TIMESTAMP,
                                       best_visibility_level=MAX(object_visibility.best_visibility_level, excluded.best_visibility_level)`
                    );
                    let done = 0; let failed = false;
                    rows.forEach(r => {
                        stmt.run([gameId, userId, sectorId, r.id, turnNumber, visibilityLevel], (e2) => {
                            if (e2 && !failed) { failed = true; stmt.finalize(); return reject(e2); }
                            done++;
                            if (done === rows.length && !failed) {
                                stmt.finalize(() => {
                                    updateCount++;
                                    if (updateCount === totalUpdates) {
                                        console.log(`👁️ Updated ${totalUpdates} visibility tiles for player ${userId} on turn ${turnNumber}`);
                                        resolve(Array.from(visionTiles));
                                    }
                                });
                            }
                        });
                    });
                }
            );
        });
    }
    
    // Compute current visibility statelessly for a player's sector (no DB writes)
    static async computeCurrentVisibility(gameId, userId, sectorId) {
        return new Promise((resolve, reject) => {
            // Get all player's vision sources (ships, starbases, sensor-tower if present)
            db.all(
                'SELECT id, x, y, meta FROM sector_objects WHERE sector_id = ? AND owner_id = ? AND type IN ("ship", "station", "sensor-tower")',
                [sectorId, userId],
                (err, units) => {
                    if (err) return reject(err);
                    if (!units || units.length === 0) return resolve(new Map());

                    // Compute a single bounding box covering all units' scan ranges
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    const sensors = units.map(u => {
                        const meta = (() => { try { return JSON.parse(u.meta || '{}'); } catch { return {}; } })();
                        let scanRange = meta.scanRange || 5;
                        let detailedRange = meta.detailedScanRange || Math.floor((scanRange || 1) / 3);
                        try {
                            if (typeof meta.scanRangeMultiplier === 'number' && meta.scanRangeMultiplier > 1) {
                                scanRange = Math.ceil(scanRange * meta.scanRangeMultiplier);
                                detailedRange = Math.ceil(detailedRange * meta.scanRangeMultiplier);
                            }
                        } catch {}
                        minX = Math.min(minX, u.x - scanRange);
                        maxX = Math.max(maxX, u.x + scanRange);
                        minY = Math.min(minY, u.y - scanRange);
                        maxY = Math.max(maxY, u.y + scanRange);
                        return { x: u.x, y: u.y, scanRange, detailedRange };
                    });

                    db.all(
                        `SELECT id, x, y FROM sector_objects WHERE sector_id = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?`,
                        [sectorId, minX, maxX, minY, maxY],
                        (e2, objectsInBox) => {
                            if (e2) return reject(e2);
                            const visible = new Map();
                            for (const obj of objectsInBox) {
                                for (const s of sensors) {
                                    const dx = obj.x - s.x;
                                    const dy = obj.y - s.y;
                                    const dist = Math.sqrt(dx * dx + dy * dy);
                                    if (dist <= s.scanRange) {
                                        const level = dist <= s.detailedRange ? 2 : 1;
                                        const existing = visible.get(obj.id);
                                        if (!existing || existing.level < level) {
                                            visible.set(obj.id, { level });
                                        }
                                    }
                                }
                            }
                            resolve(visible);
                        }
                    );
                }
            );
        });
    }

    // New: Batch update per-object visibility memory
    static updateObjectVisibilityMemory(gameId, userId, sectorId, visibleObjects, turnNumber, resolve, reject) {
        if (visibleObjects.length === 0) {
            console.log(`👁️ No objects visible for player ${userId} on turn ${turnNumber}`);
            return resolve([]);
        }
        const stmt = db.prepare(
            `INSERT INTO object_visibility (game_id, user_id, sector_id, object_id, last_seen_turn, last_seen_at, best_visibility_level)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
             ON CONFLICT(game_id, user_id, sector_id, object_id)
             DO UPDATE SET last_seen_turn=excluded.last_seen_turn, last_seen_at=CURRENT_TIMESTAMP,
                           best_visibility_level=MAX(object_visibility.best_visibility_level, excluded.best_visibility_level)`
        );
        let count = 0;
        let failed = false;
        visibleObjects.forEach(({object, visibilityLevel}) => {
            stmt.run([gameId, userId, sectorId, object.id, turnNumber, visibilityLevel], (err) => {
                if (err && !failed) {
                    failed = true;
                    stmt.finalize();
                    return reject(err);
                }
                count++;
                if (count === visibleObjects.length && !failed) {
                    stmt.finalize((finErr) => {
                        if (finErr) return reject(finErr);
                        console.log(`👁️ Updated visibility memory for ${visibleObjects.length} objects (user ${userId})`);
                        resolve();
                    });
                }
            });
        });
    }
    
    // Get game state for a specific player (works asynchronously)
    static async getPlayerGameState(gameId, userId, specificSectorId = null) {
        return new Promise((resolve, reject) => {
            // Get player's sector or specific sector
            const sectorQuery = specificSectorId ? 
                'SELECT * FROM sectors WHERE id = ? AND game_id = ?' :
                'SELECT * FROM sectors WHERE game_id = ? AND owner_id = ?';
            const sectorParams = specificSectorId ? 
                [specificSectorId, gameId] : 
                [gameId, userId];
                
            db.get(sectorQuery, sectorParams, (err, sector) => {
                if (err) return reject(err);
                if (!sector) return reject(new Error('Sector not found for player'));
                    
                    // NEW: Compute stateless current visibility and then select owned + visible objects
                    GameWorldManager.computeCurrentVisibility(gameId, userId, sector.id)
                        .then(visibleMap => {
                            const visibleIds = Array.from(visibleMap.keys());
                            const ownedQuery = `SELECT so.id, so.type, so.x, so.y, so.owner_id, so.meta, so.sector_id, so.celestial_type, so.radius, so.parent_object_id,
                                                    mo.destination_x, mo.destination_y, mo.movement_path, mo.current_step, mo.movement_speed, mo.eta_turns, mo.status as movement_status,
                                mo.warp_phase, mo.warp_preparation_turns, mo.warp_destination_x, mo.warp_destination_y,
                                                    ht.id as harvesting_task_id, ht.status as harvesting_status, ht.harvest_rate, ht.total_harvested, rt.resource_name as harvesting_resource
                         FROM sector_objects so
                                               LEFT JOIN movement_orders mo ON (so.id = mo.object_id AND mo.status IN ('active','blocked','completed','warp_preparing'))
                                               LEFT JOIN harvesting_tasks ht ON (so.id = ht.ship_id AND ht.status IN ('active','paused'))
                         LEFT JOIN resource_nodes rn ON ht.resource_node_id = rn.id
                         LEFT JOIN resource_types rt ON rn.resource_type_id = rt.id
                                               WHERE so.sector_id = ? AND so.owner_id = ?`;
                            const nonOwnedVisibleQueryBase = `SELECT so.id, so.type, so.x, so.y, so.owner_id, so.meta, so.sector_id, so.celestial_type, so.radius, so.parent_object_id,
                                                    mo.destination_x, mo.destination_y, mo.movement_path, mo.current_step, mo.movement_speed, mo.eta_turns, mo.status as movement_status,
                                                    mo.warp_phase, mo.warp_preparation_turns, mo.warp_destination_x, mo.warp_destination_y,
                                                    ht.id as harvesting_task_id, ht.status as harvesting_status, ht.harvest_rate, ht.total_harvested, rt.resource_name as harvesting_resource
                                               FROM sector_objects so
                                               LEFT JOIN movement_orders mo ON (so.id = mo.object_id AND mo.status IN ('active','blocked','completed','warp_preparing'))
                                               LEFT JOIN harvesting_tasks ht ON (so.id = ht.ship_id AND ht.status IN ('active','paused'))
                                               LEFT JOIN resource_nodes rn ON ht.resource_node_id = rn.id
                                               LEFT JOIN resource_types rt ON rn.resource_type_id = rt.id
                                               WHERE so.sector_id = ? AND so.owner_id != ?`;

                            const tasks = [];
                            tasks.push(new Promise((res, rej) => {
                                db.all(ownedQuery, [sector.id, userId], (e, rows) => e ? rej(e) : res(rows || []));
                            }));
                            if (visibleIds.length > 0) {
                                const placeholders = visibleIds.map(() => '?').join(',');
                                const nonOwnedVisibleQuery = nonOwnedVisibleQueryBase + ` AND so.id IN (${placeholders})`;
                                tasks.push(new Promise((res, rej) => {
                                    db.all(nonOwnedVisibleQuery, [sector.id, userId, ...visibleIds], (e, rows) => e ? rej(e) : res(rows || []));
                                }));
                            } else {
                                tasks.push(Promise.resolve([]));
                            }
                            const resourceQuery = `SELECT rn.id, 'resource_node' as type, rn.x, rn.y, NULL as owner_id,
                                                        JSON_OBJECT('resourceType', rt.resource_name,
                                    'resourceAmount', rn.resource_amount,
                                    'maxResource', rn.max_resource,
                                    'size', rn.size,
                                    'isDepleted', rn.is_depleted,
                                    'iconEmoji', rt.icon_emoji,
                                    'colorHex', rt.color_hex,
                                                                    'alwaysKnown', 1) as meta,
                                rn.sector_id, rt.category as celestial_type, rn.size as radius,
                                                        rn.parent_object_id
                         FROM resource_nodes rn
                         JOIN resource_types rt ON rn.resource_type_id = rt.id
                                                 WHERE rn.sector_id = ? AND rn.resource_amount > 0 AND rn.is_depleted = 0`;
                            tasks.push(new Promise((res, rej) => {
                                db.all(resourceQuery, [sector.id], (e, rows) => e ? rej(e) : res(rows || []));
                            }));

                            // Always-visible celestial bodies in this sector (no ships/structures)
                            const celestialQuery = `SELECT so.id, so.type, so.x, so.y, so.owner_id, so.meta, so.sector_id, so.celestial_type, so.radius, so.parent_object_id,
                                                          NULL as destination_x, NULL as destination_y, NULL as movement_path, NULL as eta_turns, NULL as movement_status,
                                                          NULL as warp_phase, NULL as warp_preparation_turns, NULL as warp_destination_x, NULL as warp_destination_y,
                                                          NULL as harvesting_task_id, NULL as harvesting_status, NULL as harvest_rate, NULL as total_harvested, NULL as resource_name
                                                   FROM sector_objects so
                                                   WHERE so.sector_id = ? AND JSON_EXTRACT(so.meta, '$.alwaysKnown') = 1`;
                            tasks.push(new Promise((res, rej) => {
                                db.all(celestialQuery, [sector.id], (e, rows) => e ? rej(e) : res(rows || []));
                            }));

                            Promise.all(tasks)
                                .then(([owned, nonOwnedVisible, resources, celestials]) => {
                                    const objects = [...owned, ...nonOwnedVisible, ...resources, ...celestials];
                                    objects.forEach(o => {
                                        if (o.type === 'resource_node') {
                                            o.visibility_level = 1;
                                            o.last_seen_turn = null;
                                        } else if (o.meta && typeof o.meta === 'string') {
                                            // Normalize meta if some rows returned raw JSON
                                            try { o.meta = JSON.parse(o.meta); } catch {}
                                            const alwaysKnown = o.meta?.alwaysKnown === true;
                                            if (alwaysKnown) {
                                                o.visibility_level = 1;
                                                o.last_seen_turn = null;
                                                return;
                                            }
                                        } else if (o.owner_id === userId) {
                                            o.visibility_level = 2;
                                            o.last_seen_turn = null;
                                        } else {
                                            const v = visibleMap.get(o.id);
                                            o.visibility_level = v ? v.level : 0;
                                            o.last_seen_turn = null;
                                        }
                                    });
                                    proceed(objects);
                                })
                                .catch(err2 => reject(err2));
                        })
                        .catch(err => reject(err));

                    const proceed = (objects) => {
                            // Get current turn info
                            db.get(
                                'SELECT * FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1',
                                [gameId],
                                (err, currentTurn) => {
                                    if (err) return reject(err);
                                    
                                    // Check if player has locked their turn (if there is a current turn)
                                    const turnNumber = currentTurn?.turn_number || 1;
                                    db.get(
                                        'SELECT locked FROM turn_locks WHERE game_id = ? AND user_id = ? AND turn_number = ?',
                                        [gameId, userId, turnNumber],
                                        (err, lockStatus) => {
                                            if (err) return reject(err);
                                            
                                            // Get player setup data
                                            db.get(
                                                'SELECT avatar, color_primary AS colorPrimary, color_secondary AS colorSecondary, setup_completed FROM game_players WHERE game_id = ? AND user_id = ?',
                                                [gameId, userId],
                                                (err, playerData) => {
                                                    if (err) return reject(err);
                                                    
                                                    // Get auto turn minutes from game settings
                                                    db.get(
                                                        'SELECT auto_turn_minutes FROM games WHERE id = ?',
                                                        [gameId],
                                                        (err, gameRow) => {
                                                            if (err) return reject(err);
                                                            const autoTurnMinutes = (gameRow && gameRow.auto_turn_minutes !== undefined) ? gameRow.auto_turn_minutes : null;
                                                            
                                                            // Fetch minimal players list for palettes
                                                            db.all(
                                                                `SELECT gp.user_id AS userId, u.username, gp.avatar,
                                                                        gp.color_primary AS colorPrimary, gp.color_secondary AS colorSecondary
                                                                 FROM game_players gp
                                                                 LEFT JOIN users u ON gp.user_id = u.id
                                                                 WHERE gp.game_id = ?`,
                                                                [gameId],
                                                                (playersErr, playersRows) => {
                                                                    if (playersErr) return reject(playersErr);
                                                                    const players = playersRows || [];

                                                    // Collect object ids and fetch active status effects
                                                    const objectIds = (objects || []).map(o => o.id).filter(id => typeof id === 'number');
                                                    const finishWithEffects = (effectsByShipId) => {
                                                        // Parse meta JSON and determine visibility status for objects
                                                        const parsedObjects = objects.map(obj => {
                                                            let meta;
                                                            if (typeof obj.meta === 'string') {
                                                                try {
                                                                    meta = JSON.parse(obj.meta || '{}');
                                                                } catch (e) {
                                                                    console.error('Meta JSON parse error for object', obj.id, e);
                                                                    meta = {};
                                                                }
                                                            } else {
                                                                meta = obj.meta || {};
                                                            }
                                                            const isOwned = obj.owner_id === userId;
                                                            const isVisible = (obj.visibility_level || 0) > 0;
                                                            const isAlwaysKnown = meta.alwaysKnown === true;

                                                            // Parse movement data if available
                                                            let movementData = null;
                                                            if (obj.movement_path && obj.movement_status) {
                                                                const movementPath = JSON.parse(obj.movement_path || '[]');
                                                                movementData = {
                                                                    movementPath: movementPath,
                                                                    plannedDestination: obj.destination_x && obj.destination_y ? { x: obj.destination_x, y: obj.destination_y } : null,
                                                                    movementETA: obj.eta_turns,
                                                                    movementActive: obj.movement_status === 'active',
                                                                    movementStatus: obj.movement_status,
                                                                    currentStep: (obj.current_step !== null && obj.current_step !== undefined) ? obj.current_step : null,
                                                                    baseMovementSpeed: (obj.movement_speed !== null && obj.movement_speed !== undefined) ? obj.movement_speed : null
                                                                };
                                                            }

                                                            // Parse warp data if available
                                                            let warpData = null;
                                                            if (obj.warp_phase) {
                                                                warpData = {
                                                                    warpPhase: obj.warp_phase,
                                                                    warpPreparationTurns: obj.warp_preparation_turns || 0,
                                                                    warpDestination: obj.warp_destination_x && obj.warp_destination_y ? { x: obj.warp_destination_x, y: obj.warp_destination_y } : null
                                                                };
                                                            }

                                                            // Parse harvesting data if available
                                                            let harvestingData = null;
                                                            if (obj.harvesting_task_id) {
                                                                harvestingData = {
                                                                    harvestingTaskId: obj.harvesting_task_id,
                                                                    harvestingStatus: obj.harvesting_status,
                                                                    harvestRate: obj.harvest_rate,
                                                                    totalHarvested: obj.total_harvested,
                                                                    harvestingResource: obj.harvesting_resource
                                                                };
                                                            }

                                                            return {
                                                                ...obj,
                                                                meta,
                                                                statusEffects: effectsByShipId.get(obj.id) || [],
                                                                ...movementData,
                                                                ...warpData,
                                                                ...harvestingData,
                                                                queuedOrders: null,
                                                                sectorInfo: {
                                                                    name: sector.name,
                                                                    archetype: sector.archetype,
                                                                    id: sector.id
                                                                },
                                                                visibilityStatus: {
                                                                    owned: isOwned,
                                                                    visible: isVisible || isOwned,
                                                                    dimmed: isAlwaysKnown && !isVisible && !isOwned,
                                                                    level: obj.visibility_level || 0,
                                                                    lastSeen: obj.last_seen_turn || (isOwned ? turnNumber : null)
                                                                }
                                                            };
                                                        });

                                                        resolve({
                                                            sector: {
                                                                ...sector,
                                                                name: sector.name,
                                                                archetype: sector.archetype
                                                            },
                                                            objects: parsedObjects,
                                                            currentTurn: currentTurn || { turn_number: 1, status: 'waiting' },
                                                            turnLocked: lockStatus?.locked || false,
                                                            // Normalize playerSetup colors to camelCase for client usage
                                                            playerSetup: playerData || { setup_completed: false },
                                                            // Provide players for color palettes and labels
                                                            players,
                                                            autoTurnMinutes: autoTurnMinutes
                                                        });
                                                    };

                                                    if (objectIds.length === 0) {
                                                        finishWithEffects(new Map());
                                                    } else {
                                                        const placeholders = objectIds.map(() => '?').join(',');
                                                        db.all(
                                                            `SELECT ship_id, effect_key as effectKey, magnitude, effect_data as effectData, applied_turn as appliedTurn, expires_turn as expiresTurn
                                                             FROM ship_status_effects
                                                             WHERE ship_id IN (${placeholders}) AND (expires_turn IS NULL OR expires_turn >= ?)`,
                                                            [...objectIds, turnNumber],
                                                            (effErr, rows) => {
                                                                if (effErr) return reject(effErr);
                                                                const byId = new Map();
                                                                (rows || []).forEach(r => {
                                                                    let effectData;
                                                                    try { effectData = r.effectData ? JSON.parse(r.effectData) : null; } catch { effectData = null; }
                                                                    const arr = byId.get(r.ship_id) || [];
                                                                    arr.push({ effectKey: r.effectKey, magnitude: r.magnitude, effectData, appliedTurn: r.appliedTurn, expiresTurn: r.expiresTurn });
                                                                    byId.set(r.ship_id, arr);
                                                                });
                                                                finishWithEffects(byId);
                                                            }
                                                        );
                                                    }
                                                                    }
                                                                );
                                                        }
                                                    );
                                                }
                                            );
                                        }
                                    );
                                }
                            );
                    };
                }
            );
        });
    }
}

// Pilot system helpers
const PILOT_RESPAWN_TURNS_DEFAULT = 10;

async function getCurrentTurnNumberServer(gameId) {
    return new Promise((resolve) => db.get(
        'SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1',
        [gameId],
        (e, r) => resolve(r ? r.turn_number : 1)
    ));
}

async function computePilotStats(gameId, userId, currentTurn) {
    // Capacity: base 5 + anchored station bonuses
    const stationRows = await new Promise((resolve) => {
        db.all(
            `SELECT so.meta FROM sector_objects so
             JOIN sectors s ON s.id = so.sector_id
             WHERE s.game_id = ? AND so.owner_id = ? AND so.type = 'station'`,
            [gameId, userId],
            (e, rows) => resolve(rows || [])
        );
    });
    let capacity = 5;
    for (const r of stationRows) {
        try {
            const meta = JSON.parse(r.meta || '{}');
            const cls = meta.stationClass;
            // For now, normalize station classes: treat all as planet-station for capacity
            if (cls === 'sun-station') capacity += 10; // legacy
            else if (cls === 'planet-station' || !cls) capacity += 5;
            else if (cls === 'moon-station') capacity += 3;
        } catch {}
    }

    // Active pilots = sum pilotCost for all owned ships in all sectors of this game
    const shipRows = await new Promise((resolve) => {
        db.all(
            `SELECT so.meta FROM sector_objects so
             JOIN sectors s ON s.id = so.sector_id
             WHERE s.game_id = ? AND so.owner_id = ? AND so.type = 'ship'`,
            [gameId, userId],
            (e, rows) => resolve(rows || [])
        );
    });
    let active = 0;
    for (const r of shipRows) {
        try { const m = JSON.parse(r.meta || '{}'); active += Number(m.pilotCost || 1); } catch { active += 1; }
    }

    // Dead pilots queue still waiting to respawn
    const deadRows = await new Promise((resolve) => {
        db.all(
            `SELECT respawn_turn as turn, SUM(count) as qty
             FROM dead_pilots_queue
             WHERE game_id = ? AND user_id = ? AND respawn_turn > ?
             GROUP BY respawn_turn ORDER BY respawn_turn ASC`,
            [gameId, userId, currentTurn],
            (e, rows) => resolve(rows || [])
        );
    });
    const respawnsByTurn = (deadRows || []).map(r => ({
        turn: Number(r.turn),
        turnsLeft: Math.max(0, Number(r.turn) - Number(currentTurn)),
        count: Number(r.qty || 0)
    }));
    const dead = respawnsByTurn.reduce((sum, r) => sum + (r.count || 0), 0);
    const available = Math.max(0, capacity - active - dead);
    return { capacity, active, dead, available, respawnsByTurn };
}

// Start a game (change status from recruiting to active) - ASYNCHRONOUS FRIENDLY
router.post('/start/:gameId', async (req, res) => {
    const gameId = req.params.gameId;
    const { userId } = req.body;
    
    try {
        console.log(`🎮 Starting game ${gameId} requested by user ${userId}`);
        
        // Check if user is in the game
        const membership = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM game_players WHERE game_id = ? AND user_id = ?',
                [gameId, userId],
                (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                }
            );
        });
        
        if (!membership) {
            return res.status(403).json({ error: 'Not authorized to start this game' });
        }
        
        // Check if game is in recruiting status
        const game = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM games WHERE id = ? AND status = ?',
                [gameId, 'recruiting'],
                (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                }
            );
        });
        
        if (!game) {
            return res.status(400).json({ error: 'Game cannot be started (not in recruiting status)' });
        }
        
        // Initialize game world
        const initResult = await GameWorldManager.initializeGame(gameId);
        console.log('✅ Game world initialized:', initResult);
        
        // Update game status to active
        await new Promise((resolve, reject) => {
            db.run(
                'UPDATE games SET status = ? WHERE id = ?',
                ['active', gameId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
        
        console.log(`🎉 Game ${gameId} started successfully!`);
        res.json({ 
            success: true, 
            message: 'Game started successfully! Players can now join the action at any time.' 
        });
        
    } catch (error) {
        console.error('❌ Start game error:', error);
        res.status(500).json({ 
            error: 'Failed to start game', 
            details: error.message 
        });
    }
});

// Get game state for player - ASYNCHRONOUS FRIENDLY
router.get('/:gameId/state/:userId', async (req, res) => {
    const { gameId, userId } = req.params;
    
    try {
        // Verify user is in the game
        const membership = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM game_players WHERE game_id = ? AND user_id = ?',
                [gameId, userId],
                (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                }
            );
        });
        
        if (!membership) {
            return res.status(403).json({ error: 'Not authorized to view this game' });
        }
        
        const gameState = await GameWorldManager.getPlayerGameState(gameId, parseInt(userId));
        try {
            const currentTurn = gameState?.currentTurn?.turn_number || await getCurrentTurnNumberServer(gameId);
            gameState.pilotStats = await computePilotStats(gameId, parseInt(userId), currentTurn);
        } catch (e) { console.warn('pilotStats error:', e?.message || e); }
        res.json(gameState);
        
    } catch (error) {
        console.error('❌ Get game state error:', error);
        res.status(500).json({ 
            error: 'Failed to get game state', 
            details: error.message 
        });
    }
});

// Sector-specific state to keep view pinned to a sector (e.g., selected unit's sector)
router.get('/:gameId/state/:userId/sector/:sectorId', async (req, res) => {
    const { gameId, userId, sectorId } = req.params;
    try {
        // Verify user is in the game
        const membership = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM game_players WHERE game_id = ? AND user_id = ?',
                [gameId, userId],
                (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                }
            );
        });
        if (!membership) return res.status(403).json({ error: 'Not authorized to view this game' });

        const gameState = await GameWorldManager.getPlayerGameState(gameId, parseInt(userId), parseInt(sectorId));
        try {
            const currentTurn = gameState?.currentTurn?.turn_number || await getCurrentTurnNumberServer(gameId);
            gameState.pilotStats = await computePilotStats(gameId, parseInt(userId), currentTurn);
        } catch (e) { console.warn('pilotStats error:', e?.message || e); }
        res.json(gameState);
    } catch (error) {
        console.error('❌ Get sector state error:', error);
        res.status(500).json({ error: 'Failed to get sector state', details: error.message });
    }
});

// Galaxy graph: systems (sectors) and gates (interstellar connections)
router.get('/:gameId/galaxy-graph', (req, res) => {
    const { gameId } = req.params;
    // Get sectors in this game
    db.all('SELECT id, name FROM sectors WHERE game_id = ? ORDER BY id', [gameId], (err, sectors) => {
        if (err) {
            console.error('Error fetching sectors for galaxy graph:', err);
            return res.status(500).json({ error: 'Failed to fetch sectors' });
        }
        // Get interstellar gates across all sectors in this game
            db.all(
            `SELECT so.sector_id as sourceSectorId,
                    JSON_EXTRACT(so.meta, '$.destinationSectorId') as destSectorId,
                    so.meta as rawMeta
                 FROM sector_objects so
             JOIN sectors s ON so.sector_id = s.id
             WHERE s.game_id = ? AND so.type = 'interstellar-gate'`,
            [gameId],
            (err2, gatesRows) => {
                if (err2) {
                    console.error('Error fetching gates for galaxy graph:', err2);
                    return res.status(500).json({ error: 'Failed to fetch gates' });
                }
                const systems = sectors.map(s => ({ id: s.id, name: s.name }));
                const validSectorIds = new Set(sectors.map(s => s.id));
                const edgeSet = new Set();
                const gates = [];
                (gatesRows || []).forEach(r => {
                    const src = parseInt(r.sourceSectorId);
                    const dst = parseInt(r.destSectorId);
                    if (!Number.isFinite(src) || !Number.isFinite(dst)) return;
                    if (!validSectorIds.has(src) || !validSectorIds.has(dst)) return;
                    const a = Math.min(src, dst);
                    const b = Math.max(src, dst);
                    const key = `${a}-${b}`;
                    if (!edgeSet.has(key)) {
                        edgeSet.add(key);
                        gates.push({ source: a, target: b });
                    }
                });
                res.json({ systems, gates });
            }
        );
    });
});

// System facts: core bias, themed/minor minerals, gate slots
router.get('/system/:sectorId/facts', (req, res) => {
    const { sectorId } = req.params;
    db.get('SELECT name, archetype, gate_slots, gates_used FROM sectors WHERE id = ?', [sectorId], (err, sector) => {
        if (err || !sector) return res.status(404).json({ error: 'sector_not_found' });
        try {
            const { getArchetype } = require('../archetypes');
            const arch = sector.archetype ? getArchetype(sector.archetype) : null;
            const coreBias = arch && arch.coreBias ? arch.coreBias : {
                Ferrite: '1.00', Crytite: '1.00', Ardanium: '1.00', Vornite: '1.00', Zerothium: '1.00'
            };
            // Themed (fixedSpecialized) and minor (deterministic extras)
            const themed = (arch && Array.isArray(arch.fixedSpecialized)) ? arch.fixedSpecialized.slice(0,2) : [];
            const { pickDeterministicExtrasForSector } = require('../resource-node-generator');
            const minor = pickDeterministicExtrasForSector ? pickDeterministicExtrasForSector(sectorId, arch).slice(0,3) : [];
            res.json({
                name: sector.name,
                type: sector.archetype,
                coreBias,
                themed,
                minor,
                gateSlots: sector.gate_slots || 3,
                gatesUsed: sector.gates_used || 0
            });
        } catch (e) {
            console.error('facts error:', e);
            res.status(500).json({ error: 'facts_error' });
        }
    });
});

// Ship blueprints listing with computed requirements
router.get('/blueprints', (req, res) => {
    try {
        const enriched = SHIP_BLUEPRINTS.map(bp => {
            const resolved = bp;
            const abilitiesMeta = (resolved.abilities || []).filter(k => !!Abilities[k]).map(key => {
                const a = Abilities[key];
                return {
                    key,
                    name: a.name,
                    type: a.type,
                    target: a.target || 'self',
                    cooldown: a.cooldown || 0,
                    range: a.range || null,
                    energyCost: a.energyCost || 0,
                    shortDescription: a.shortDescription || a.description || null,
                    longDescription: a.longDescription || null
                };
            });
            return {
                ...bp,
                abilities: resolved.abilities || [],
                abilitiesMeta,
                requirements: computeAllRequirements(bp)
            };
        });
        res.json({ blueprints: enriched });
    } catch (e) {
        console.error('Error returning blueprints', e);
        res.status(500).json({ error: 'Failed to load blueprints' });
    }
});

// Abilities registry (for client UI)
router.get('/abilities', (req, res) => {
    try {
        const abilities = {};
        Object.keys(Abilities || {}).forEach((key) => {
            const a = Abilities[key] || {};
            abilities[key] = {
                key: a.key || key,
                name: a.name || key,
                description: a.description || null,
                shortDescription: a.shortDescription || null,
                longDescription: a.longDescription || null,
                type: a.type || 'active',
                target: a.target || 'self',
                cooldown: a.cooldown || 0,
                range: a.range || null,
                energyCost: a.energyCost || 0
            };
        });
        res.json({ abilities });
    } catch (e) {
        console.error('Error returning abilities', e);
        res.status(500).json({ error: 'Failed to load abilities' });
    }
});

// System archetypes registry
router.get('/archetypes', (req, res) => {
    try {
        res.json({ archetypes: SECTOR_ARCHETYPES });
    } catch (e) {
        console.error('Error returning archetypes', e);
        res.status(500).json({ error: 'Failed to load archetypes' });
    }
});

// Get visible map data for player around a specific position - ASYNCHRONOUS FRIENDLY
router.get('/:gameId/map/:userId/:sectorId/:x/:y', (req, res) => {
    const { gameId, userId, sectorId, x, y } = req.params;
    const centerX = parseInt(x);
    const centerY = parseInt(y);
    const viewRange = parseInt(req.query.range) || 15;
    const sector = parseInt(sectorId);
    
    // Compute stateless visibility for this user in the requested sector and window
    GameWorldManager.computeCurrentVisibility(gameId, parseInt(userId), sector)
        .then(visibleMap => {
            db.all(
                `SELECT id, type, x, y, owner_id, meta FROM sector_objects
                 WHERE sector_id = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?`,
                [
                    sector,
                    centerX - viewRange, centerX + viewRange,
                    centerY - viewRange, centerY + viewRange
                ],
                (err, objects) => {
                    if (err) return res.status(500).json({ error: 'Failed to get map data' });
                    const mapData = objects.map(o => {
                        let meta;
                        if (typeof o.meta === 'string') { try { meta = JSON.parse(o.meta || '{}'); } catch { meta = {}; } }
                        else meta = o.meta || {};
                        const v = visibleMap.get(o.id);
                        const visible = (v && v.level > 0) || o.owner_id == userId || meta.alwaysKnown === true;
                        return { id: o.id, type: o.type, x: o.x, y: o.y, owner_id: o.owner_id, meta, visible };
                    });
                    res.json({ centerX, centerY, viewRange, objects: mapData });
                }
            );
        })
        .catch(() => res.status(500).json({ error: 'Failed to compute visibility' }));
});

// Player setup route
router.post('/setup/:gameId', (req, res) => {
    const { gameId } = req.params;
    const { userId, avatar, colorPrimary, colorSecondary, systemName } = req.body;
    
    console.log(`🎨 Setup request for game ${gameId}, user ${userId}:`, {
        avatar, colorPrimary, colorSecondary, systemName
    });
    
    // Validate input
    if (!userId || !avatar || !colorPrimary || !colorSecondary || !systemName) {
        console.error('❌ Missing required fields:', { userId, avatar, colorPrimary, colorSecondary, systemName });
        return res.status(400).json({ error: 'Missing required setup fields' });
    }
    
    // Validate system name length
    if (systemName.length > 30) {
        return res.status(400).json({ error: 'System name too long (max 30 characters)' });
    }
    
    // Validate color codes
    const colorRegex = /^#[0-9A-F]{6}$/i;
    if (!colorRegex.test(colorPrimary) || !colorRegex.test(colorSecondary)) {
        return res.status(400).json({ error: 'Invalid color format' });
    }
    
    // Check if setup already completed
    db.get('SELECT setup_completed FROM game_players WHERE game_id = ? AND user_id = ?', 
        [gameId, userId], (err, player) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!player) {
                return res.status(404).json({ error: 'Player not found in game' });
            }
            
            if (player.setup_completed) {
                return res.status(400).json({ error: 'Setup already completed' });
            }
            
            // Update player customization
            db.run(`UPDATE game_players SET 
                avatar = ?, color_primary = ?, color_secondary = ?, setup_completed = 1 
                WHERE game_id = ? AND user_id = ?`,
                [avatar, colorPrimary, colorSecondary, gameId, userId], function(err) {
                    if (err) {
                        console.error('Error updating player:', err);
                        return res.status(500).json({ error: 'Failed to update player' });
                    }
                    
                    // Update sector name only (archetype is assigned at sector creation)
                    db.run('UPDATE sectors SET name = ? WHERE game_id = ? AND owner_id = ?',
                        [systemName, gameId, userId], function(sectorErr) {
                            if (sectorErr) {
                                console.error('Error updating sector:', sectorErr);
                                return res.status(500).json({ error: 'Failed to update sector' });
                            }
                            
                            console.log(`✅ Player ${userId} completed setup for game ${gameId}`);
                            res.json({ 
                                success: true,
                                message: 'Setup completed successfully'
                            });
                        });
                });
        });
});

// Active scan route - temporary extended vision
// Active scan removed in favor of abilities (e.g., survey_scanner). Keep endpoint as no-op for compatibility.
router.post('/scan/:gameId', (req, res) => {
    return res.status(410).json({ error: 'Active scan has been removed. Use abilities like survey_scanner.' });
});

// PHASE 1C: Get movement history for accurate trail rendering
// GET /game/:gameId/movement-history/:userId
router.get('/:gameId/movement-history/:userId', async (req, res) => {
    const { gameId, userId } = req.params;
    const { turns = 10, shipId } = req.query; // Default to 10 turns of history
    
    try {
        // Verify user is in the game
        const membership = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM game_players WHERE game_id = ? AND user_id = ?',
                [gameId, userId],
                (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                }
            );
        });
        
        if (!membership) {
            return res.status(403).json({ error: 'Not authorized to view this game' });
        }
        
        // Get current turn to calculate history range
        const currentTurn = await new Promise((resolve, reject) => {
            db.get(
                'SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1',
                [gameId],
                (err, result) => {
                    if (err) reject(err);
                    else resolve(result?.turn_number || 1);
                }
            );
        });
        
        // Build movement history query without legacy tile visibility
        let historyQuery = `
            SELECT mh.*, so.owner_id, so.meta, so.type
            FROM movement_history mh
            JOIN sector_objects so ON mh.object_id = so.id
            JOIN sectors s ON so.sector_id = s.id
            WHERE mh.game_id = ? 
            AND mh.turn_number > ?
        `;
        
        let queryParams = [gameId, currentTurn - turns];

        // Filter by specific ship if requested  
        if (shipId) {
            historyQuery += ' AND mh.object_id = ?';
            queryParams.push(shipId);
        }
        
        // Only show movements for owned ships or visible enemy movements.
        // Visibility will be checked after fetching using stateless computeCurrentVisibility.
        historyQuery += ` 
            ORDER BY mh.turn_number DESC, mh.created_at DESC
        `;
        
        const rawHistory = await new Promise((resolve, reject) => {
            db.all(historyQuery, queryParams, (err, results) => {
                if (err) reject(err);
                else resolve(results || []);
            });
        });
        
        // Compute stateless visibility for the sector of interest per item (batch by sector)
        // Fetch sectors for the involved movements
        const objectIds = [...new Set(rawHistory.map(r => r.object_id))];
        const objectIdToSector = new Map();
        if (objectIds.length > 0) {
            await new Promise((resolve) => {
                const placeholders = objectIds.map(() => '?').join(',');
                db.all(`SELECT id, sector_id, owner_id, meta, type FROM sector_objects WHERE id IN (${placeholders})`, objectIds, (e2, rows) => {
                    (rows || []).forEach(r => objectIdToSector.set(r.id, r.sector_id));
                    resolve();
                });
            });
        }
        const sectorIds = [...new Set(rawHistory.map(r => objectIdToSector.get(r.object_id)).filter(Boolean))];
        const sectorIdToVisibleMap = new Map();
        for (const sid of sectorIds) {
            const vmap = await GameWorldManager.computeCurrentVisibility(gameId, parseInt(userId), sid).catch(() => new Map());
            sectorIdToVisibleMap.set(sid, vmap);
        }
        
        // Process results and filter by ownership or visibility
        const processedHistory = rawHistory
            .filter(movement => {
                const isOwned = movement.owner_id === parseInt(userId);
                if (isOwned) return true;
                const sectorId = objectIdToSector.get(movement.object_id);
                const vmap = sectorIdToVisibleMap.get(sectorId) || new Map();
                // Consider a movement visible if either end tile currently reveals the object
                return vmap.has(movement.object_id);
            })
            .map(movement => {
            const meta = JSON.parse(movement.meta || '{}');
            return {
                shipId: movement.object_id,
                shipName: meta.name || `${movement.type} ${movement.object_id}`,
                turnNumber: movement.turn_number,
                segment: {
                    from: { x: movement.from_x, y: movement.from_y },
                    to: { x: movement.to_x, y: movement.to_y }
                },
                movementSpeed: movement.movement_speed,
                isOwned: movement.owner_id === parseInt(userId),
                isVisible: true,
                timestamp: movement.created_at
            };
        });
        
        console.log(`📜 Retrieved ${processedHistory.length} movement history segments for game ${gameId}, user ${userId} (last ${turns} turns)`);
        
        res.json({
            success: true,
            currentTurn,
            turnsRequested: turns,
            movementHistory: processedHistory
        });
        
    } catch (error) {
        console.error('❌ Get movement history error:', error);
        res.status(500).json({ 
            error: 'Failed to get movement history', 
            details: error.message 
        });
    }
});

// Get resource nodes near a ship
router.get('/resource-nodes/:gameId/:shipId', (req, res) => {
    const { gameId, shipId } = req.params;
    const { userId } = req.query;
    
    // Verify ship ownership
    db.get(
        `SELECT so.* FROM sector_objects so
         JOIN sectors s ON so.sector_id = s.id
         WHERE so.id = ? AND so.owner_id = ? AND s.game_id = ?`,
        [shipId, userId, gameId],
        (err, ship) => {
            if (err) {
                console.error('Error verifying ship ownership:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!ship) {
                return res.status(404).json({ error: 'Ship not found or not owned by player' });
            }
            
            // Get nearby resource nodes
            HarvestingManager.getNearbyResourceNodes(shipId)
                .then(nodes => {
                    res.json({ resourceNodes: nodes });
                })
                .catch(error => {
                    console.error('Error getting resource nodes:', error);
                    res.status(500).json({ error: 'Failed to get resource nodes' });
                });
        }
    );
});

// Get object cargo (ships, structures, etc.)
router.get('/cargo/:objectId', (req, res) => {
    const { objectId } = req.params;
    const { userId } = req.query;
    
    // Verify object existence; allow access if owned OR publicAccess meta
    db.get('SELECT type, meta, owner_id FROM sector_objects WHERE id = ?', [objectId], (err, object) => {
        if (err) {
            console.error('Error verifying object ownership:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!object) {
            return res.status(404).json({ error: 'Object not found or not owned by player' });
        }
        let allowed = Number(object.owner_id) === Number(userId);
        if (!allowed) {
            try { const m = JSON.parse(object.meta || '{}'); allowed = !!m.publicAccess; } catch {}
        }
        if (!allowed) return res.status(404).json({ error: 'Object not found or not owned by player' });
        
        // Get cargo data - use legacy table for ships for backward compatibility
        const useLegacyTable = object.type === 'ship';
        CargoManager.getObjectCargo(objectId, useLegacyTable)
            .then(cargo => {
                res.json({ cargo });
            })
            .catch(error => {
                console.error('Error getting object cargo:', error);
                res.status(500).json({ error: 'Failed to get object cargo' });
            });
    });
});

// Transfer resources between objects
router.post('/transfer', (req, res) => {
    const { fromObjectId, toObjectId, resourceName, quantity, userId } = req.body;
    
    // Validate input
    if (!fromObjectId || !toObjectId || !resourceName || !quantity || !userId) {
        return res.status(400).json({ error: 'Missing required fields: fromObjectId, toObjectId, resourceName, quantity, userId' });
    }
    
    if (quantity <= 0) {
        return res.status(400).json({ error: 'Quantity must be positive' });
    }
    
    if (fromObjectId === toObjectId) {
        return res.status(400).json({ error: 'Cannot transfer to the same object' });
    }
    
    // Perform the transfer
    CargoManager.transferResources(fromObjectId, toObjectId, resourceName, quantity, userId)
        .then(result => {
            if (result.success) {
                res.json({
                    success: true,
                    message: `Successfully transferred ${result.quantityTransferred} ${result.resourceName} from ${result.fromObject} to ${result.toObject}`,
                    transfer: result
                });
            } else {
                res.status(400).json({ error: result.error, details: result });
            }
        })
        .catch(error => {
            console.error('Error transferring resources:', error);
            res.status(500).json({ error: 'Failed to transfer resources' });
        });
});

// Ship type definitions
const SHIP_TYPES = {
    'explorer': {
        name: 'Explorer Ship',
        emoji: '🔍',
        cargoCapacity: 10,
        movementSpeed: 4,
        harvestRate: 1.0,
        canMine: true,
        canActiveScan: false,
        hp: 50,
        maxHp: 50,
        scanRange: 50
    },
    'mining-vessel': {
        name: 'Mining Vessel',
        emoji: '⛏️',
        cargoCapacity: 20,
        movementSpeed: 3,
        harvestRate: 2.0, // 2x mining speed
        canMine: true,
        canActiveScan: false,
        hp: 60,
        maxHp: 60,
        scanRange: 50
    },
    'logistics': {
        name: 'Logistics Ship',
        emoji: '🚚',
        cargoCapacity: 50,
        movementSpeed: 2,
        harvestRate: 0, // Cannot mine
        canMine: false,
        canActiveScan: false,
        hp: 40,
        maxHp: 40,
        scanRange: 50
    }
};

// Structure type definitions (as cargo items)
const STRUCTURE_TYPES = {
    'storage-box': {
        name: 'Storage Box',
        emoji: '📦',
        description: 'Deployable storage structure',
        cargoCapacity: 25,
        deployable: true
    },
    'warp-beacon': {
        name: 'Warp Beacon',
        emoji: '🌌',
        description: 'Deployable warp destination',
        deployable: true,
        publicAccess: true
    },
    'interstellar-gate': {
        name: 'Interstellar Gate',
        emoji: '🌀',
        description: 'Gateway between solar systems',
        deployable: true,
        publicAccess: true,
        requiresSectorSelection: true
    },
    // New anchored stations (test cost handled client-side)
    'sun-station': {
        name: 'Sun Station',
        emoji: '☀️',
        description: 'Anchors in orbit around a star',
        deployable: true,
        requiresAnchor: true,
        anchorType: 'star',
        cargoCapacity: 50
    },
    'planet-station': {
        name: 'Planet Station',
        emoji: '🪐',
        description: 'Anchors in orbit around a planet',
        deployable: true,
        requiresAnchor: true,
        anchorType: 'planet',
        cargoCapacity: 50
    },
    'moon-station': {
        name: 'Moon Station',
        emoji: '🌘',
        description: 'Anchors in orbit around a moon',
        deployable: true,
        requiresAnchor: true,
        anchorType: 'moon',
        cargoCapacity: 50
    }
};

// Build ship endpoint
router.post('/build-ship', (req, res) => {
    const { stationId, blueprintId, userId, freeBuild } = req.body;
    const devMode = process.env.SF_DEV_MODE === '1' || process.env.NODE_ENV === 'development';
    
    // Validate blueprint
    const blueprint = SHIP_BLUEPRINTS.find(b => b.id === blueprintId);
    if (!blueprint) {
        return res.status(400).json({ error: 'Invalid blueprint' });
    }
    
    // Verify station ownership (starbase or station)
    db.get('SELECT * FROM sector_objects WHERE id = ? AND owner_id = ? AND type IN ("starbase","station")', 
        [stationId, userId], async (err, station) => {
        if (err) {
            console.error('Error finding station:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!station) {
            return res.status(404).json({ error: 'Station not found or not owned by player' });
        }
        
        // Enforce pilot capacity (default pilotCost = 1; later blueprints can add property)
        try {
            const currentTurn = await getCurrentTurnNumberServer(station.game_id || (await new Promise(r=>db.get('SELECT game_id FROM sectors WHERE id = ?', [station.sector_id], (e,row)=>r(row?.game_id)))));
            const stats = await computePilotStats(station.game_id || (await new Promise(r=>db.get('SELECT game_id FROM sectors WHERE id = ?', [station.sector_id], (e,row)=>r(row?.game_id)))), userId, currentTurn);
            const pilotCost = 1; // blueprint-level override can be added later
            if ((stats.available || 0) < pilotCost) {
                return res.status(400).json({ error: 'No available pilots to command a new ship' });
            }
        } catch (e) {
            console.warn('Pilot capacity check failed (continuing with build):', e?.message || e);
        }
        
        // Compute requirements (core + specialized)
        const reqs = computeAllRequirements(blueprint);
        const resourceMap = { ...reqs.core, ...reqs.specialized };

        // Atomically consume resources from the building station (unless freeBuild flag)
        const allowFree = !!freeBuild && devMode;
        const consume = allowFree ? Promise.resolve({ success: true }) : CargoManager.consumeResourcesAtomic(stationId, resourceMap, false);
        consume
            .then(async (result) => {
                if (!result.success) {
                    return res.status(400).json({ error: 'Insufficient resources', details: result.shortages });
                }
                
                // Create ship adjacent to station using resolved blueprint
                const shipName = `${blueprint.name} ${Math.floor(Math.random() * 1000)}`;
                const resolved = blueprint;
                const shipMetaObj = {
                    name: shipName,
                    ...resolved,
                    shipType: resolved.class,
                    blueprintId: resolved.id
                };
                // Sanity: ensure abilities array exists and filter to known keys for UI
                if (!Array.isArray(shipMetaObj.abilities)) shipMetaObj.abilities = [];
                shipMetaObj.abilities = shipMetaObj.abilities.filter(k => !!Abilities[k]);
                const shipMeta = JSON.stringify(shipMetaObj);
                
                // Find adjacent position
                const spawnX = station.x + (Math.random() < 0.5 ? -1 : 1);
                const spawnY = station.y + (Math.random() < 0.5 ? -1 : 1);
                
                db.run(
                    'INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta, scan_range, movement_speed, can_active_scan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [station.sector_id, 'ship', spawnX, spawnY, userId, shipMeta, shipMetaObj.scanRange, shipMetaObj.movementSpeed, shipMetaObj.canActiveScan ? 1 : 0],
                    function(shipErr) {
                        if (shipErr) {
                            console.error('Error creating ship:', shipErr);
                            return res.status(500).json({ error: 'Failed to create ship' });
                        }
                        
                        const shipId = this.lastID;
                        console.log(`🚢 Built ${shipName} (ID: ${shipId}) for user ${userId}`);
                        
                        // Initialize ship cargo
                        CargoManager.initializeShipCargo(shipId, shipMetaObj.cargoCapacity)
                            .then(() => {
                                res.json({ 
                                    success: true, 
                                    shipName: shipName,
                                    shipId: shipId,
                                    consumed: resourceMap
                                });
                            })
                            .catch(cargoErr => {
                                console.error('Error initializing ship cargo:', cargoErr);
                                res.json({ 
                                    success: true, 
                                    shipName: shipName,
                                    shipId: shipId,
                                    warning: 'Ship created but cargo initialization failed',
                                    consumed: resourceMap
                                });
                            });
                    }
                );
            })
            .catch(error => {
                console.error('Error consuming resources:', error);
                res.status(500).json({ error: 'Failed to consume resources' });
            });
    });
});

// Build structure endpoint (creates cargo item)
router.post('/build-structure', (req, res) => {
    const { stationId, structureType, cost, userId } = req.body;
    
    // Validate structure type
    if (!STRUCTURE_TYPES[structureType]) {
        return res.status(400).json({ error: 'Invalid structure type' });
    }
    
    const structureTemplate = STRUCTURE_TYPES[structureType];
    
    // Verify station ownership (starbase or station)
    db.get('SELECT * FROM sector_objects WHERE id = ? AND owner_id = ? AND type IN ("starbase","station")', 
        [stationId, userId], (err, station) => {
        if (err) {
            console.error('Error finding station:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!station) {
            return res.status(404).json({ error: 'Station not found or not owned by player' });
        }
        
        // Check and consume resources
        CargoManager.removeResourceFromCargo(stationId, 'rock', cost, false)
            .then(result => {
                if (!result.success) {
                    return res.status(400).json({ error: result.error || 'Insufficient resources' });
                }
                
                // Add structure to station cargo as an item
                // First, ensure we have a structure resource type
                db.get('SELECT id FROM resource_types WHERE resource_name = ?', [structureType], (typeErr, resourceType) => {
                    if (typeErr) {
                        console.error('Error finding resource type:', typeErr);
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    if (!resourceType) {
                        // Create the resource type if it doesn't exist
                        db.run(
                            'INSERT INTO resource_types (resource_name, category, base_size, base_value, description, icon_emoji, color_hex) VALUES (?, ?, ?, ?, ?, ?, ?)',
                            [structureType, 'structure', 5, 10, structureTemplate.description, structureTemplate.emoji, '#64b5f6'],
                            function(insertErr) {
                                if (insertErr) {
                                    console.error('Error creating resource type:', insertErr);
                                    return res.status(500).json({ error: 'Failed to create structure type' });
                                }
                                
                                const newResourceTypeId = this.lastID;
                                addStructureToStation(stationId, newResourceTypeId);
                            }
                        );
                    } else {
                        addStructureToStation(stationId, resourceType.id);
                    }
                });
                
                function addStructureToStation(stationId, resourceTypeId) {
                    CargoManager.addResourceToCargo(stationId, structureType, 1, false)
                        .then(addResult => {
                            if (addResult.success) {
                                console.log(`🏗️ Built ${structureTemplate.name} for user ${userId}`);
                                res.json({ 
                                    success: true, 
                                    structureName: structureTemplate.name
                                });
                            } else {
                                res.status(500).json({ error: 'Failed to add structure to cargo' });
                            }
                        })
                        .catch(addError => {
                            console.error('Error adding structure to cargo:', addError);
                            res.status(500).json({ error: 'Failed to add structure to cargo' });
                        });
                }
            })
            .catch(error => {
                console.error('Error consuming resources:', error);
                res.status(500).json({ error: 'Failed to consume resources' });
            });
    });
});

// Deploy structure endpoint
router.post('/deploy-structure', (req, res) => {
    const { shipId, structureType, userId } = req.body;
    
    // Validate structure type
    if (!STRUCTURE_TYPES[structureType]) {
        return res.status(400).json({ error: 'Invalid structure type' });
    }
    
    const structureTemplate = STRUCTURE_TYPES[structureType];
    
    // Verify ship ownership
    db.get('SELECT * FROM sector_objects WHERE id = ? AND owner_id = ? AND type = ?', 
        [shipId, userId, 'ship'], (err, ship) => {
        if (err) {
            console.error('Error finding ship:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!ship) {
            return res.status(404).json({ error: 'Ship not found or not owned by player' });
        }
        
        // Check if ship has the structure in cargo and remove it
        CargoManager.removeResourceFromCargo(shipId, structureType, 1, true) // Use legacy table for ships
            .then(result => {
                if (!result.success) {
                    return res.status(400).json({ error: result.error || 'Structure not found in ship cargo' });
                }
                
                // If this is an anchored station, enforce placement rules
                if (['sun-station','planet-station','moon-station'].includes(structureType)) {
                    const requiredType = structureTemplate.anchorType;
                    db.all(
                        `SELECT id, x, y, radius, type FROM sector_objects WHERE sector_id = ? AND type = ?`,
                        [ship.sector_id, requiredType],
                        (objErr, celestialObjects) => {
                            if (objErr) {
                                console.error('Error finding celestial objects:', objErr);
                                return res.status(500).json({ error: 'Database error' });
                            }
                            if (!celestialObjects || celestialObjects.length === 0) {
                                return res.status(400).json({ error: `No ${requiredType} present in this sector` });
                            }
                            const candidate = celestialObjects.find(o => {
                                const dx = ship.x - o.x; const dy = ship.y - o.y;
                                const dist = Math.sqrt(dx*dx + dy*dy);
                                return dist <= (o.radius + 1);
                            });
                            if (!candidate) {
                                return res.status(400).json({ error: `Must be adjacent to a ${requiredType} to deploy this station` });
                            }
                            // One station per celestial object
                            db.get(
                                `SELECT id FROM sector_objects WHERE parent_object_id = ? AND type = 'station' LIMIT 1`,
                                [candidate.id],
                                (exErr, existing) => {
                                    if (exErr) {
                                        console.error('Error checking existing station:', exErr);
                                        return res.status(500).json({ error: 'Database error' });
                                    }
                                    if (existing) {
                                        return res.status(400).json({ error: 'This celestial object already has a station anchored' });
                                    }
                                    // Place on ring
                                    let vx = ship.x - candidate.x; let vy = ship.y - candidate.y;
                                    if (vx === 0 && vy === 0) vx = 1;
                                    const len = Math.sqrt(vx*vx + vy*vy) || 1;
                                    const ring = (candidate.radius || 1) + 1;
                                    const deployX = Math.round(candidate.x + vx/len * ring);
                                    const deployY = Math.round(candidate.y + vy/len * ring);
                                    const stationMeta = JSON.stringify({
                                        name: `${structureTemplate.name} ${Math.floor(Math.random() * 1000)}`,
                                        stationClass: structureType,
                                        anchoredToType: requiredType,
                                        anchoredToId: candidate.id,
                                        hp: 150,
                                        maxHp: 150,
                                        cargoCapacity: structureTemplate.cargoCapacity || 50
                                    });
                                    db.run(
                                        `INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta, parent_object_id) VALUES (?, 'station', ?, ?, ?, ?, ?)`,
                                        [ship.sector_id, deployX, deployY, userId, stationMeta, candidate.id],
                                        function(insertErr) {
                                            if (insertErr) {
                                                console.error('Error creating anchored station:', insertErr);
                                                return res.status(500).json({ error: 'Failed to deploy station' });
                                            }
                                            const newStationId = this.lastID;
                                            CargoManager.initializeObjectCargo(newStationId, structureTemplate.cargoCapacity || 50)
                                                .then(() => {
                                                    console.log(`🛰️ Deployed ${structureTemplate.name} (ID: ${newStationId}) anchored to ${requiredType} ${candidate.id} at (${deployX}, ${deployY})`);
                                                    res.json({ success: true, structureName: structureTemplate.name, structureId: newStationId });
                                                })
                                                .catch(cargoErr => {
                                                    console.error('Error initializing station cargo:', cargoErr);
                                                    res.json({ success: true, structureName: structureTemplate.name, structureId: newStationId, warning: 'Station deployed but cargo initialization failed' });
                                                });
                                        }
                                    );
                                }
                            );
                        }
                    );
                    return; // stop generic flow
                }
                
                // Generic, non-anchored structures
                const deployX = ship.x + (Math.random() < 0.5 ? -1 : 1);
                const deployY = ship.y + (Math.random() < 0.5 ? -1 : 1);
                const structureMeta = JSON.stringify({
                    name: `${structureTemplate.name} ${Math.floor(Math.random() * 1000)}`,
                    structureType: structureType,
                    hp: 100,
                    maxHp: 100,
                    cargoCapacity: structureTemplate.cargoCapacity || 0,
                    publicAccess: structureTemplate.publicAccess || false
                });
                const dbStructureType = structureType === 'warp-beacon' ? 'warp-beacon' : 'storage-structure';
                db.run(
                    'INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta) VALUES (?, ?, ?, ?, ?, ?)',
                    [ship.sector_id, dbStructureType, deployX, deployY, userId, structureMeta],
                    function(structureErr) {
                        if (structureErr) {
                            console.error('Error creating structure:', structureErr);
                            return res.status(500).json({ error: 'Failed to deploy structure' });
                        }
                        const structureId = this.lastID;
                        console.log(`🏗️ Deployed ${structureTemplate.name} (ID: ${structureId}) for user ${userId} at (${deployX}, ${deployY})`);
                        if (structureTemplate.cargoCapacity > 0) {
                            CargoManager.initializeObjectCargo(structureId, structureTemplate.cargoCapacity)
                                .then(() => {
                                    console.log(`📦 Initialized cargo system for deployed structure ${structureId}`);
                                    res.json({ success: true, structureName: structureTemplate.name, structureId: structureId });
                                })
                                .catch(cargoErr => {
                                    console.error('Error initializing structure cargo:', cargoErr);
                                    res.json({ success: true, structureName: structureTemplate.name, structureId: structureId, warning: 'Structure deployed but cargo initialization failed' });
                                });
                        } else {
                            res.json({ success: true, structureName: structureTemplate.name, structureId: structureId });
                        }
                    }
                );
            })
            .catch(error => {
                console.error('Error removing structure from cargo:', error);
                res.status(500).json({ error: 'Failed to remove structure from cargo' });
            });
    });
});

// Build a basic Explorer for testing (1 rock)
router.post('/build-basic-explorer', (req, res) => {
    const { stationId, userId } = req.body;

    db.get('SELECT * FROM sector_objects WHERE id = ? AND owner_id = ? AND type = ?', [stationId, userId, 'station'], async (err, station) => {
        if (err) {
            console.error('Error finding station:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!station) return res.status(404).json({ error: 'Station not found or not owned by player' });
        
        // Enforce pilot capacity (pilotCost=1)
        try {
            const currentTurn = await getCurrentTurnNumberServer(station.game_id || (await new Promise(r=>db.get('SELECT game_id FROM sectors WHERE id = ?', [station.sector_id], (e,row)=>r(row?.game_id)))));
            const stats = await computePilotStats(station.game_id || (await new Promise(r=>db.get('SELECT game_id FROM sectors WHERE id = ?', [station.sector_id], (e,row)=>r(row?.game_id)))), userId, currentTurn);
            if ((stats.available || 0) < 1) {
                return res.status(400).json({ error: 'No available pilots to command a new ship' });
            }
        } catch (e) { console.warn('Pilot capacity check failed (continuing):', e?.message || e); }

        CargoManager.removeResourceFromCargo(stationId, 'rock', 1, false)
            .then(result => {
                if (!result.success) {
                    return res.status(400).json({ error: 'Insufficient resources' });
                }

                const shipMetaObj = {
                    name: 'Explorer',
                    hp: 50,
                    maxHp: 50,
                    scanRange: 50,
                    movementSpeed: 4,
                    cargoCapacity: 10,
                    harvestRate: 1.0,
                    canMine: true,
                    canActiveScan: false,
                    shipType: 'explorer',
                    pilotCost: 1
                };
                const shipMeta = JSON.stringify(shipMetaObj);

                const spawnX = station.x + (Math.random() < 0.5 ? -1 : 1);
                const spawnY = station.y + (Math.random() < 0.5 ? -1 : 1);
                db.run(
                    'INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta, scan_range, movement_speed, can_active_scan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [station.sector_id, 'ship', spawnX, spawnY, userId, shipMeta, shipMetaObj.scanRange, shipMetaObj.movementSpeed, 0],
                    function(shipErr) {
                        if (shipErr) {
                            console.error('Error creating basic explorer:', shipErr);
                            return res.status(500).json({ error: 'Failed to create ship' });
                        }
                        const shipId = this.lastID;
                        CargoManager.initializeShipCargo(shipId, shipMetaObj.cargoCapacity)
                            .then(() => res.json({ success: true, shipName: shipMetaObj.name, shipId }))
                            .catch(cargoErr => {
                                console.error('Error initializing ship cargo:', cargoErr);
                                res.json({ success: true, shipName: shipMetaObj.name, shipId, warning: 'Ship created but cargo initialization failed' });
                            });
                    }
                );
            })
            .catch(error => {
                console.error('Error consuming rock for explorer:', error);
                res.status(500).json({ error: 'Failed to consume resources' });
            });
    });
});

// Get all sectors in a game
router.get('/sectors', (req, res) => {
    const { gameId, userId } = req.query;
    
    if (!gameId || !userId) {
        return res.status(400).json({ error: 'Game ID and User ID required' });
    }
    
    db.all(`
        SELECT s.*, u.username as owner_name 
        FROM sectors s 
        LEFT JOIN users u ON s.owner_id = u.id 
        WHERE s.game_id = ?
        ORDER BY s.name
    `, [gameId], (err, sectors) => {
        if (err) {
            console.error('Error fetching sectors:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        res.json({ sectors: sectors });
    });
});

// Get all player objects across all sectors
router.get('/player-fleet', (req, res) => {
    const { gameId, userId } = req.query;
    
    if (!gameId || !userId) {
        return res.status(400).json({ error: 'Game ID and User ID required' });
    }
    
    // Include latest movement order and active/paused harvesting task for each object
    db.all(`
        SELECT 
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
        ORDER BY s.name, so.type, so.id
    `, [gameId, userId], (err, objects) => {
        if (err) {
            console.error('Error fetching player fleet:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        res.json({ fleet: objects });
    });
});

// Switch player's view to a different sector
router.post('/switch-sector', (req, res) => {
    const { gameId, userId, sectorId } = req.body;
    
    if (!gameId || !userId || !sectorId) {
        return res.status(400).json({ error: 'Game ID, User ID, and Sector ID required' });
    }
    
    // Verify the sector exists and is part of this game
    db.get('SELECT * FROM sectors WHERE id = ? AND game_id = ?', [sectorId, gameId], (err, sector) => {
        if (err) {
            console.error('Error finding sector:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!sector) {
            return res.status(404).json({ error: 'Sector not found' });
        }
        
        // Return the game state for the new sector
        GameWorldManager.getPlayerGameState(gameId, userId, sectorId)
            .then(gameState => {
                res.json({
                    success: true,
                    gameState: gameState,
                    message: `Switched to ${sector.name}`
                });
            })
            .catch(error => {
                console.error('Error getting game state for sector switch:', error);
                res.status(500).json({ error: 'Failed to switch sectors' });
            });
    });
});

// Deploy interstellar gate with destination sector
router.post('/deploy-interstellar-gate', (req, res) => {
    const { shipId, destinationSectorId, userId } = req.body;
    
    // Verify ship ownership
    db.get('SELECT * FROM sector_objects WHERE id = ? AND owner_id = ? AND type = ?', 
        [shipId, userId, 'ship'], (err, ship) => {
        if (err) {
            console.error('Error finding ship:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!ship) {
            return res.status(404).json({ error: 'Ship not found or not owned by player' });
        }
        
        // Verify destination sector exists
        db.get('SELECT * FROM sectors WHERE id = ?', [destinationSectorId], (sectorErr, destinationSector) => {
            if (sectorErr) {
                console.error('Error finding destination sector:', sectorErr);
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!destinationSector) {
                return res.status(404).json({ error: 'Destination sector not found' });
            }
            
            // Check if ship has the interstellar gate in cargo and remove it
            CargoManager.removeResourceFromCargo(shipId, 'interstellar-gate', 1, true) // Use legacy table for ships
                .then(result => {
                    if (!result.success) {
                        return res.status(400).json({ error: result.error || 'Interstellar gate not found in ship cargo' });
                    }
                    
                    // Generate unique gate pair ID
                    const gatePairId = `gate_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                    
                    // Enforce gate slots and prevent duplicate edges
                    db.get('SELECT gate_slots, gates_used FROM sectors WHERE id = ?', [ship.sector_id], (eA, originSector) => {
                        if (eA || !originSector) return res.status(400).json({ error: 'origin_sector_not_found' });
                        db.get('SELECT gate_slots, gates_used FROM sectors WHERE id = ?', [destinationSectorId], (eB, destSector) => {
                            if (eB || !destSector) return res.status(400).json({ error: 'destination_sector_not_found' });
                            if ((originSector.gates_used || 0) >= (originSector.gate_slots || 3)) return res.status(400).json({ error: 'origin_gate_slots_full' });
                            if ((destSector.gates_used || 0) >= (destSector.gate_slots || 3)) return res.status(400).json({ error: 'dest_gate_slots_full' });
                            // Prevent existing A->B connection
                            db.get(
                                `SELECT 1 FROM sector_objects WHERE sector_id = ? AND type='interstellar-gate' AND json_extract(meta,'$.destinationSectorId') = ? LIMIT 1`,
                                [ship.sector_id, destinationSectorId],
                                (edgeErr, exists) => {
                                    if (edgeErr) return res.status(500).json({ error: 'edge_check_failed' });
                                    if (exists) return res.status(400).json({ error: 'connection_already_exists' });
                    // Create gate in current sector (origin)
                    const originGateX = ship.x + (Math.random() < 0.5 ? -1 : 1);
                    const originGateY = ship.y + (Math.random() < 0.5 ? -1 : 1);
                    
                    const originGateMeta = JSON.stringify({
                        name: `Interstellar Gate to ${destinationSector.name}`,
                        structureType: 'interstellar-gate',
                        hp: 200,
                        maxHp: 200,
                        publicAccess: true,
                        gatePairId: gatePairId,
                        destinationSectorId: destinationSectorId,
                        destinationSectorName: destinationSector.name,
                        isOriginGate: true
                    });
                    
                    db.run(
                        'INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta) VALUES (?, ?, ?, ?, ?, ?)',
                        [ship.sector_id, 'interstellar-gate', originGateX, originGateY, userId, originGateMeta],
                        function(originErr) {
                            if (originErr) {
                                console.error('Error creating origin gate:', originErr);
                                return res.status(500).json({ error: 'Failed to create origin gate' });
                            }
                            
                            const originGateId = this.lastID;
                            
                            // Create gate in destination sector
                            // Find a safe spawn location in destination sector (near center)
                            const destGateX = 2500 + Math.floor(Math.random() * 100) - 50; // Near center with some randomness
                            const destGateY = 2500 + Math.floor(Math.random() * 100) - 50;
                            
                            const destGateMeta = JSON.stringify({
                                name: `Interstellar Gate to ${ship.sector_id === destinationSector.id ? 'Origin' : 'Sector ' + ship.sector_id}`,
                                structureType: 'interstellar-gate',
                                hp: 200,
                                maxHp: 200,
                                publicAccess: true,
                                gatePairId: gatePairId,
                                destinationSectorId: ship.sector_id,
                                destinationSectorName: 'Origin Sector', // Will be updated with proper name
                                isOriginGate: false
                            });
                            
                            db.run(
                                'INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta) VALUES (?, ?, ?, ?, ?, ?)',
                                [destinationSectorId, 'interstellar-gate', destGateX, destGateY, userId, destGateMeta],
                                function(destErr) {
                                    if (destErr) {
                                        console.error('Error creating destination gate:', destErr);
                                        return res.status(500).json({ error: 'Failed to create destination gate' });
                                    }
                                    
                                    const destGateId = this.lastID;
                                    console.log(`🌀 Created interstellar gate pair (${gatePairId}): Origin ${originGateId} in sector ${ship.sector_id}, Destination ${destGateId} in sector ${destinationSectorId}`);
                                    // Increment gates_used for both sectors
                                    db.run('UPDATE sectors SET gates_used = gates_used + 1 WHERE id IN (?, ?)', [ship.sector_id, destinationSectorId], () => {});
                                    res.json({ 
                                        success: true, 
                                        structureName: 'Interstellar Gate',
                                        originGateId: originGateId,
                                        destGateId: destGateId,
                                        gatePairId: gatePairId
                                    });
                                }
                            );
                                }
                            );
                        });
                    });
                        }
                    );
                })
                .catch(error => {
                    console.error('Error removing gate from cargo:', error);
                    res.status(500).json({ error: 'Failed to remove gate from cargo' });
                });
        });
    });
});

// Interstellar travel through gates
router.post('/interstellar-travel', (req, res) => {
    const { shipId, gateId, userId } = req.body;
    
    // Verify ship ownership
    db.get('SELECT * FROM sector_objects WHERE id = ? AND owner_id = ? AND type = ?', 
        [shipId, userId, 'ship'], (err, ship) => {
        if (err) {
            console.error('Error finding ship:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!ship) {
            return res.status(404).json({ error: 'Ship not found or not owned by player' });
        }
        
        // Verify gate exists and get its destination
        db.get('SELECT * FROM sector_objects WHERE id = ? AND type = ?', 
            [gateId, 'interstellar-gate'], (gateErr, gate) => {
            if (gateErr) {
                console.error('Error finding gate:', gateErr);
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!gate) {
                return res.status(404).json({ error: 'Interstellar gate not found' });
            }
            
            const gateMeta = JSON.parse(gate.meta || '{}');
            const destinationSectorId = gateMeta.destinationSectorId;
            
            if (!destinationSectorId) {
                return res.status(400).json({ error: 'Gate has no valid destination' });
            }
            
            // Check if ship is adjacent to gate
            const dx = Math.abs(ship.x - gate.x);
            const dy = Math.abs(ship.y - gate.y);
            if (dx > 1 || dy > 1) {
                return res.status(400).json({ error: 'Ship must be adjacent to the gate to travel' });
            }
            
            // Find the paired gate in the destination sector
            db.get(`
                SELECT * FROM sector_objects 
                WHERE sector_id = ? AND type = 'interstellar-gate' 
                AND JSON_EXTRACT(meta, '$.gatePairId') = ?
            `, [destinationSectorId, gateMeta.gatePairId], (pairErr, pairedGate) => {
                if (pairErr) {
                    console.error('Error finding paired gate:', pairErr);
                    return res.status(500).json({ error: 'Database error' });
                }
                
                if (!pairedGate) {
                    return res.status(404).json({ error: 'Destination gate not found' });
                }
                
                // Move ship to destination sector, adjacent to the paired gate
                const newX = pairedGate.x + (Math.random() < 0.5 ? -1 : 1);
                const newY = pairedGate.y + (Math.random() < 0.5 ? -1 : 1);
                
                db.run(
                    'UPDATE sector_objects SET sector_id = ?, x = ?, y = ? WHERE id = ?',
                    [destinationSectorId, newX, newY, shipId],
                    function(updateErr) {
                        if (updateErr) {
                            console.error('Error moving ship through gate:', updateErr);
                            return res.status(500).json({ error: 'Failed to move ship through gate' });
                        }
                        
                        const shipMeta = JSON.parse(ship.meta || '{}');
                        console.log(`🌀 Ship ${shipId} (${shipMeta.name}) traveled through gate ${gateId} from sector ${ship.sector_id} to sector ${destinationSectorId}`);
                        
                        // After move, refresh visibility memory for this user (fire-and-forget)
                        // Derive gameId from the destination sector
                        db.get('SELECT game_id FROM sectors WHERE id = ?', [destinationSectorId], (gErr, secRow) => {
                            if (gErr || !secRow) {
                                if (gErr) console.error('Error getting game_id for visibility refresh:', gErr);
                                return; // non-fatal
                            }
                            const gid = secRow.game_id;
                            db.get('SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [gid], (tErr, tRow) => {
                                const tNum = tRow?.turn_number || 1;
                                GameWorldManager.calculatePlayerVision(gid, userId, tNum)
                                    .catch(e => console.error('Visibility refresh after gate travel failed:', e));
                            });
                        });
                        
                        res.json({ 
                            success: true, 
                            message: 'Ship successfully traveled through interstellar gate',
                            newSectorId: destinationSectorId,
                            newX: newX,
                            newY: newY
                        });
                    }
                );
            });
        });
    });
});

module.exports = { router, GameWorldManager }; 