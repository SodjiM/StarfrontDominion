const db = require('../../db');
const { seedSector } = require('../world/seed-orchestrator');
const { CargoManager } = require('./cargo-manager');

class GameWorldManager {
    static async initializeGame(gameId) {
        return new Promise((resolve, reject) => {
            console.log(`🚀 Initializing game world for game ${gameId}`);
            db.all(
                `SELECT gp.user_id, u.username 
                 FROM game_players gp 
                 JOIN users u ON gp.user_id = u.id 
                 WHERE gp.game_id = ?`,
                [gameId],
                (err, players) => {
                    if (err) return reject(err);
                    if (!players || players.length === 0) return reject(new Error('No players found for this game'));
                    console.log(`👥 Found ${players.length} players:`, players.map(p => p.username));
                    this.createPlayerSectors(gameId, players, 0, resolve, reject);
                }
            );
        });
    }

    static createPlayerSectors(gameId, players, index, resolve, reject) {
        if (index >= players.length) {
            console.log('✅ All player sectors created, initializing turn system');
            this.initializeTurnSystem(gameId, resolve, reject);
            return;
        }
        const player = players[index];
        const sectorName = `${player.username}'s Domain`;
        console.log(`🌍 Creating sector for ${player.username}`);
        const initialGateSlots = 2 + Math.floor(Math.random() * 3);
        // Defer archetype selection and seeding to player setup; create sector with NULL archetype
        db.run(
            'INSERT INTO sectors (game_id, owner_id, name, archetype, gate_slots) VALUES (?, ?, ?, NULL, ?)',
            [gameId, player.user_id, sectorName, initialGateSlots],
            function(err) {
                if (err) return reject(err);
                const sectorId = this.lastID;
                console.log(`📍 Created sector ${sectorId} for ${player.username}`);
                // Do not seed yet; wait for player setup to select archetype
                GameWorldManager.createPlayerSectors(gameId, players, index + 1, resolve, reject);
            }
        );
    }

    static async generateSectorAndStartingObjects(gameId, player, sectorId, onComplete, onError) {
        try {
            console.log(`🌌 Generating celestial objects for ${player.username}'s sector ${sectorId}`);
            const sector = await new Promise((resolve, reject) => {
                db.get('SELECT archetype FROM sectors WHERE id = ?', [sectorId], (err, row) => err ? reject(err) : resolve(row));
            });
            let archetype = sector?.archetype || null;
            if (!archetype) {
                archetype = GameWorldManager.pickRandomArchetype(gameId, player.user_id);
                await new Promise((resolve) => db.run('UPDATE sectors SET archetype = ? WHERE id = ?', [archetype, sectorId], () => resolve()));
            }
            console.log(`🎯 Using archetype: ${archetype || 'standard'} for sector ${sectorId}`);
            // Guard against double-seeding: only seed if sector has no sun and no belts persisted
            const existing = await new Promise((resolve) => db.get(
                `SELECT 
                    (SELECT COUNT(1) FROM sector_objects WHERE sector_id = ? AND celestial_type = 'star') AS suns,
                    (SELECT COUNT(1) FROM belt_sectors WHERE sector_id = ?) AS belts`,
                [sectorId, sectorId],
                (e, r) => resolve(r || { suns: 0, belts: 0 })
            ));
            if (Number(existing.suns || 0) === 0 && Number(existing.belts || 0) === 0) {
                const generationResult = await seedSector({ sectorId, archetypeKey: archetype, seedBase: gameId });
                console.log(`✅ Seeded sector:`, generationResult);
            } else {
                console.log(`ℹ️ Sector ${sectorId} already seeded (suns=${existing.suns}, belts=${existing.belts}); skipping seeding.`);
            }
            this.createStartingObjects(gameId, player, sectorId, onComplete, onError);
        } catch (error) {
            console.error(`❌ Failed to generate sector ${sectorId}:`, error);
            onError(error);
        }
    }

    static pickRandomArchetype(gameId, userId) {
        const archetypes = require('../registry/archetypes').ALL_ARCHETYPES_KEYS;
        const seed = (Number(gameId) * 9301 + Number(userId) * 49297) % 233280;
        const r = (seed / 233280);
        const idx = Math.floor(r * archetypes.length) % archetypes.length;
        return archetypes[idx];
    }

    static createStartingObjects(gameId, player, sectorId, onComplete, onError) {
        db.all(
            `SELECT p.id, p.x, p.y, p.meta
             FROM sector_objects p
             WHERE p.sector_id = ? AND p.celestial_type = 'planet'`,
            [sectorId],
            (err, planets) => {
                if (err) return onError(err);
                let anchorPlanet = null; let spawnX, spawnY;
                if (Array.isArray(planets) && planets.length > 0) {
                    // Prefer the planet nearest to sector center for safer spawn
                    const centerX = 2500, centerY = 2500;
                    anchorPlanet = planets.reduce((best, p) => {
                        const dx = (p.x - centerX); const dy = (p.y - centerY); const d = dx*dx + dy*dy;
                        if (!best) return { p, d };
                        return d < best.d ? { p, d } : best;
                    }, null)?.p || planets[0];
                    const distance = 18 + Math.floor(Math.random() * 10); // tighter ring 18–27
                    const angle = Math.random() * 2 * Math.PI;
                    spawnX = Math.max(1, Math.min(4999, Math.round(anchorPlanet.x + Math.cos(angle) * distance)));
                    spawnY = Math.max(1, Math.min(4999, Math.round(anchorPlanet.y + Math.sin(angle) * distance)));
                    const pm = (() => { try { return JSON.parse(anchorPlanet.meta || '{}'); } catch { return {}; } })();
                    console.log(`🌍 Spawning ${player.username} at ${distance}T from planet "${pm.name || 'Planet'}" (${anchorPlanet.id}) → (${spawnX},${spawnY})`);
                } else {
                    // Fallback near sun center
                    const sun = { x: 2500, y: 2500 };
                    const distance = 25 + Math.floor(Math.random() * 10);
                    const angle = Math.random() * 2 * Math.PI;
                    spawnX = Math.round(sun.x + Math.cos(angle) * distance);
                    spawnY = Math.round(sun.y + Math.sin(angle) * distance);
                    console.warn(`⚠️ No planets found for ${player.username}, fallback near sun at (${spawnX}, ${spawnY})`);
                }

                const stationClass = 'planet-station';
                const starbaseMetaObj = { name: `${player.username} Station`, hp: 100, maxHp: 100, scanRange: 200, cargoCapacity: 50, stationClass };
                const starbaseMeta = JSON.stringify(starbaseMetaObj);

                const proceedAfterStation = (starbaseId) => {
                    const { SHIP_BLUEPRINTS } = require('../registry/blueprints');
                    const explorer = (SHIP_BLUEPRINTS || []).find(b => b.id === 'explorer');
                    const resolved = explorer || { class: 'frigate', scanRange: 50, movementSpeed: 4, cargoCapacity: 10, abilities: ['dual_light_coilguns','boost_engines','jury_rig_repair','survey_scanner','duct_tape_resilience','prospector_microlasers'] };
                    const shipMetaObj = { name: `${player.username} Explorer`, ...resolved, shipType: resolved.class, blueprintId: resolved.id || 'explorer' };
                    const shipMeta = JSON.stringify(shipMetaObj);
                    db.run(
                        'INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta, scan_range, movement_speed, can_active_scan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [sectorId, 'ship', spawnX + 1, spawnY, player.user_id, shipMeta, shipMetaObj.scanRange, shipMetaObj.movementSpeed, shipMetaObj.canActiveScan ? 1 : 0],
                        function(err) {
                            if (err) return onError(err);
                            console.log(`🚢 Created ship for ${player.username} at (${spawnX + 1}, ${spawnY})`);
                            GameWorldManager.initializeVisibility(gameId, player.user_id, sectorId, spawnX, spawnY, onComplete, onError);
                        }
                    );
                };

                const insertAnchored = (parentId) => {
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
                            db.run(
                                `INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta, parent_object_id) VALUES (?, 'station', ?, ?, ?, ?, NULL)`,
                                [sectorId, spawnX, spawnY, player.user_id, starbaseMeta],
                                function(err) {
                                    if (err) return onError(err);
                                    const starbaseId = this.lastID;
                                    console.log(`🏭 Created fallback station (unanchored) for ${player.username} at (${spawnX}, ${spawnY})`);
                                    CargoManager.initializeObjectCargo(starbaseId, 50)
                                        .then(() => CargoManager.addResourceToCargo(starbaseId, 'rock', 25, false))
                                        .catch(error => console.error('Error initializing station cargo or adding rocks:', error));
                                    proceedAfterStation(starbaseId);
                                }
                            );
                            return;
                        }
                        db.run(
                            `INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta, parent_object_id) VALUES (?, 'station', ?, ?, ?, ?, ?)`,
                            [sectorId, spawnX, spawnY, player.user_id, starbaseMeta, parentId || null],
                            function(err) {
                                if (err) return onError(err);
                                const starbaseId = this.lastID;
                                console.log(`🏭 Created anchored ${stationClass} for ${player.username} at (${spawnX}, ${spawnY}) parent=${parentId || 'none'}`);
                                CargoManager.initializeObjectCargo(starbaseId, 50)
                                    .then(() => CargoManager.addResourceToCargo(starbaseId, 'rock', 25, false))
                                    .catch(error => console.error('Error initializing station cargo or adding rocks:', error));
                                proceedAfterStation(starbaseId);
                            }
                        );
                    });
                };

                if (anchorPlanet && anchorPlanet.id) {
                    insertAnchored(anchorPlanet.id);
                } else {
                    db.get(`SELECT id FROM sector_objects WHERE sector_id = ? AND celestial_type = 'sun' LIMIT 1`, [sectorId], (e2, sunRow) => {
                        insertAnchored(sunRow && sunRow.id ? sunRow.id : null);
                    });
                }
            }
        );
    }

    static initializeVisibility(gameId, userId, sectorId, centerX, centerY, onComplete, onError) {
        db.get('SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [gameId], (e, row) => {
            const turnNumber = row?.turn_number || 1;
            GameWorldManager.calculatePlayerVision(gameId, userId, turnNumber)
                .then(() => onComplete())
                .catch(onError);
        });
    }

    static initializeTurnSystem(gameId, resolve, reject) {
        db.run(
            'INSERT INTO turns (game_id, turn_number, status) VALUES (?, ?, ?)',
            [gameId, 1, 'waiting'],
            function(err) {
                if (err) return reject(err);
                console.log('⏰ Turn system initialized');
                resolve({ success: true, message: 'Game world initialized successfully', turnId: this.lastID });
            }
        );
    }

    static async calculatePlayerVision(gameId, userId, turnNumber) {
        return new Promise((resolve, reject) => {
            db.all('SELECT id, sector_id, x, y, meta FROM sector_objects WHERE owner_id = ? AND type IN ("ship", "station")', [userId], (err, units) => {
                if (err) return reject(err);
                if (!units || units.length === 0) return resolve([]);
                const sectorIdToUnits = new Map();
                for (const u of units) {
                    if (!sectorIdToUnits.has(u.sector_id)) sectorIdToUnits.set(u.sector_id, []);
                    sectorIdToUnits.get(u.sector_id).push(u);
                }
                const visibleObjects = new Map();
                let sectorsProcessed = 0;
                for (const [sectorId, sectorUnits] of sectorIdToUnits.entries()) {
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    const sensors = sectorUnits.map(u => {
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
                    db.all('SELECT * FROM sector_objects WHERE sector_id = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?', [sectorId, minX, maxX, minY, maxY], (e2, objectsInBox) => {
                        if (e2) return reject(e2);
                        for (const obj of objectsInBox) {
                            for (const s of sensors) {
                                const dx = obj.x - s.x;
                                const dy = obj.y - s.y;
                                const dist = Math.sqrt(dx * dx + dy * dy);
                                if (dist <= s.scanRange) {
                                    const lvl = dist <= s.detailedRange ? 2 : 1;
                                    const existing = visibleObjects.get(obj.id);
                                    if (!existing || existing.visibilityLevel < lvl) visibleObjects.set(obj.id, { object: obj, visibilityLevel: lvl });
                                }
                            }
                        }
                        sectorsProcessed++;
                        if (sectorsProcessed === sectorIdToUnits.size) {
                            const bySector = new Map();
                            for (const v of visibleObjects.values()) {
                                const sid = v.object.sector_id;
                                if (!bySector.has(sid)) bySector.set(sid, []);
                                bySector.get(sid).push(v);
                            }
                            let done = 0; const total = bySector.size;
                            if (total === 0) return resolve([]);
                            for (const [sid, list] of bySector.entries()) {
                                GameWorldManager.updateObjectVisibilityMemory(gameId, userId, sid, list, turnNumber, () => { if (++done === total) resolve(list.map(v => v.object)); }, reject);
                            }
                        }
                    });
                }
            });
        });
    }

    static updateObjectVisibilityMemory(gameId, userId, sectorId, visibleObjects, turnNumber, resolve, reject) {
        if (visibleObjects.length === 0) return resolve([]);
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
                if (err && !failed) { failed = true; stmt.finalize(); return reject(err); }
                count++;
                if (count === visibleObjects.length && !failed) {
                    stmt.finalize((finErr) => finErr ? reject(finErr) : resolve());
                }
            });
        });
    }

    static async computeCurrentVisibility(gameId, userId, sectorId) {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT id, x, y, meta FROM sector_objects WHERE sector_id = ? AND owner_id = ? AND type IN ("ship", "station", "sensor-tower")',
                [sectorId, userId],
                (err, units) => {
                    if (err) return reject(err);
                    if (!units || units.length === 0) return resolve(new Map());
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
                                        if (!existing || existing.level < level) visible.set(obj.id, { level });
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

    static updatePlayerVisibilityOptimized(gameId, userId, sectorId, visibleObjects, turnNumber, resolve, reject) {
        return resolve([]);
    }

    // Get game state for a specific player (service version used by state routes)
    static async getPlayerGameState(gameId, userId, specificSectorId = null) {
        return new Promise((resolve, reject) => {
            const sectorQuery = specificSectorId ?
                'SELECT * FROM sectors WHERE id = ? AND game_id = ?' :
                'SELECT * FROM sectors WHERE game_id = ? AND owner_id = ?';
            const sectorParams = specificSectorId ? [specificSectorId, gameId] : [gameId, userId];

            db.get(sectorQuery, sectorParams, (err, sector) => {
                if (err) return reject(err);
                if (!sector) return reject(new Error('Sector not found for player'));

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
                    db.get(
                        'SELECT * FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1',
                        [gameId],
                        (err, currentTurn) => {
                            if (err) return reject(err);
                            const turnNumber = currentTurn?.turn_number || 1;
                            db.get(
                                'SELECT locked FROM turn_locks WHERE game_id = ? AND user_id = ? AND turn_number = ?',
                                [gameId, userId, turnNumber],
                                (err, lockStatus) => {
                                    if (err) return reject(err);
                                    db.get(
                                        'SELECT avatar, color_primary AS colorPrimary, color_secondary AS colorSecondary, setup_completed FROM game_players WHERE game_id = ? AND user_id = ?',
                                        [gameId, userId],
                                        (err, playerData) => {
                                            if (err) return reject(err);
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

                                                    const objectIds = (objects || []).map(o => o.id).filter(id => typeof id === 'number');
                                                    const finishWithEffects = (effectsByShipId) => {
                                                        const parsedObjects = objects.map(obj => {
                                                            let meta;
                                                            if (typeof obj.meta === 'string') { try { meta = JSON.parse(obj.meta || '{}'); } catch { meta = {}; } }
                                                            else meta = obj.meta || {};
                                                            const isOwned = obj.owner_id === userId;
                                                            const isVisible = (obj.visibility_level || 0) > 0;
                                                            const isAlwaysKnown = meta.alwaysKnown === true;

                                                            let movementData = null;
                                                            if (obj.movement_path && obj.movement_status) {
                                                                const movementPath = JSON.parse(obj.movement_path || '[]');
                                                                movementData = {
                                                                    movementPath,
                                                                    plannedDestination: obj.destination_x && obj.destination_y ? { x: obj.destination_x, y: obj.destination_y } : null,
                                                                    movementETA: obj.eta_turns,
                                                                    movementActive: obj.movement_status === 'active',
                                                                    movementStatus: obj.movement_status,
                                                                    currentStep: (obj.current_step !== null && obj.current_step !== undefined) ? obj.current_step : null,
                                                                    baseMovementSpeed: (obj.movement_speed !== null && obj.movement_speed !== undefined) ? obj.movement_speed : null
                                                                };
                                                            }

                                                            let warpData = null;
                                                            if (obj.warp_phase) {
                                                                warpData = {
                                                                    warpPhase: obj.warp_phase,
                                                                    warpPreparationTurns: obj.warp_preparation_turns || 0,
                                                                    warpDestination: obj.warp_destination_x && obj.warp_destination_y ? { x: obj.warp_destination_x, y: obj.warp_destination_y } : null
                                                                };
                                                            }

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
                                                                sectorInfo: { name: sector.name, archetype: sector.archetype, id: sector.id },
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
                                                            sector: { ...sector, name: sector.name, archetype: sector.archetype },
                                                            objects: parsedObjects,
                                                            currentTurn: currentTurn || { turn_number: 1, status: 'waiting' },
                                                            turnLocked: lockStatus?.locked || false,
                                                            playerSetup: playerData || { setup_completed: false },
                                                            players,
                                                            autoTurnMinutes: awaitAutoTurnMinutes()
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

                    function awaitAutoTurnMinutes() {
                        return new Promise((res, rej) => {
                            db.get('SELECT auto_turn_minutes FROM games WHERE id = ?', [gameId], (err, row) => {
                                if (err) return res(null);
                                res((row && row.auto_turn_minutes !== undefined) ? row.auto_turn_minutes : null);
                            });
                        });
                    }
                };
            });
        });
    }
}

async function getCurrentTurnNumberServer(gameId) {
    return new Promise((resolve) => db.get('SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [gameId], (e, r) => resolve(r ? r.turn_number : 1)));
}

async function computePilotStats(gameId, userId, currentTurn) {
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
            if (cls === 'sun-station') capacity += 10;
            else if (cls === 'planet-station' || !cls) capacity += 5;
            else if (cls === 'moon-station') capacity += 3;
        } catch {}
    }
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
    const respawnsByTurn = (deadRows || []).map(r => ({ turn: Number(r.turn), turnsLeft: Math.max(0, Number(r.turn) - Number(currentTurn)), count: Number(r.qty || 0) }));
    const dead = respawnsByTurn.reduce((sum, r) => sum + (r.count || 0), 0);
    const available = Math.max(0, capacity - active - dead);
    return { capacity, active, dead, available, respawnsByTurn };
}

module.exports = { GameWorldManager, getCurrentTurnNumberServer, computePilotStats };


