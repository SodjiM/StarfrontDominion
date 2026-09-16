const db = require('../../db');
const { seedSector } = require('../world/seed-orchestrator');
const { CargoManager } = require('./cargo-manager');
const { isObjectOperational } = require('../../domain/infrastructure');

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
            const archetype = sector?.archetype || null;
            console.log(`🎯 Archetype for sector ${sectorId}: ${archetype || '(pipeline will select)'} `);
            // Use unified generation pipeline only
            const { SectorGenerationPipeline } = require('../world/generation-pipeline');
            const pipeline = new SectorGenerationPipeline(sectorId, { gameId, player, createStartingObjects: true });
            await pipeline.execute();
            onComplete();
        } catch (error) {
            console.error(`❌ Failed to generate sector ${sectorId}:`, error);
            onError(error);
        }
    }

    static pickRandomArchetype(gameId, userId) { return 'standard'; }

    static createStartingObjects(gameId, player, sectorId, onComplete, onError) {
        const {CreateStartingObjectsStep}=require('../world/pipeline-steps/create-starting-objects-step');
        const {createRngStreams}=require('../world/rng');
        new CreateStartingObjectsStep().execute({sectorId,rngStreams:createRngStreams(sectorId)},{player,createStartingObjects:true})
            .then(()=>GameWorldManager.initializeVisibility(gameId,player.user_id,sectorId,2500,2500,onComplete,onError)).catch(onError);
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
        const sectors = await new Promise((resolve, reject) => db.all(
            `SELECT DISTINCT so.sector_id
             FROM sector_objects so
             JOIN sectors s ON s.id = so.sector_id
             WHERE s.game_id = ? AND so.owner_id = ?
               AND so.type IN ('ship', 'station', 'sensor-tower')`,
            [gameId, userId],
            (err, rows) => err ? reject(err) : resolve(rows || [])
        ));
        const seen = [];
        for (const { sector_id: sectorId } of sectors) {
            const sensors = await GameWorldManager.getOperationalSensorCoverage(gameId, userId, sectorId);
            if (sensors.length === 0) continue;
            const minX = Math.min(...sensors.map(s => s.x - s.scanRange));
            const maxX = Math.max(...sensors.map(s => s.x + s.scanRange));
            const minY = Math.min(...sensors.map(s => s.y - s.scanRange));
            const maxY = Math.max(...sensors.map(s => s.y + s.scanRange));
            const objects = await new Promise((resolve, reject) => db.all(
                'SELECT * FROM sector_objects WHERE sector_id = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?',
                [sectorId, minX, maxX, minY, maxY],
                (err, rows) => err ? reject(err) : resolve(rows || [])
            ));
            const visible = objects.map(object => ({
                object,
                visibilityLevel: GameWorldManager.visibilityLevelAt(sensors, object.x, object.y)
            })).filter(entry => entry.visibilityLevel > 0);
            if (visible.length === 0) continue;
            await new Promise((resolve, reject) => GameWorldManager.updateObjectVisibilityMemory(
                gameId, userId, sectorId, visible, turnNumber, resolve, reject
            ));
            seen.push(...visible.map(entry => entry.object));
        }
        return seen;
    }

    static updateObjectVisibilityMemory(gameId, userId, sectorId, visibleObjects, turnNumber, resolve, reject) {
        if (visibleObjects.length === 0) return resolve([]);
        const memoryStmt = db.prepare(
            `INSERT INTO object_visibility (game_id, user_id, sector_id, object_id, last_seen_turn, last_seen_at, best_visibility_level)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
             ON CONFLICT(game_id, user_id, sector_id, object_id)
             DO UPDATE SET last_seen_turn=excluded.last_seen_turn, last_seen_at=CURRENT_TIMESTAMP,
                           best_visibility_level=MAX(object_visibility.best_visibility_level, excluded.best_visibility_level)`
        );
        const historyStmt = db.prepare(
            `INSERT INTO object_visibility_history
                (game_id, user_id, sector_id, object_id, turn_number, visibility_level)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(game_id, user_id, sector_id, object_id, turn_number)
             DO UPDATE SET visibility_level=MAX(object_visibility_history.visibility_level, excluded.visibility_level)`
        );
        let count = 0;
        let failed = false;
        visibleObjects.forEach(({object, visibilityLevel}) => {
            memoryStmt.run([gameId, userId, sectorId, object.id, turnNumber, visibilityLevel], (memoryErr) => {
                if (memoryErr && !failed) {
                    failed = true;
                    memoryStmt.finalize();
                    historyStmt.finalize();
                    return reject(memoryErr);
                }
                historyStmt.run([gameId, userId, sectorId, object.id, turnNumber, visibilityLevel], (historyErr) => {
                    if (historyErr && !failed) {
                        failed = true;
                        memoryStmt.finalize();
                        historyStmt.finalize();
                        return reject(historyErr);
                    }
                    count++;
                    if (count === visibleObjects.length && !failed) {
                        memoryStmt.finalize((memoryFinalizeErr) => {
                            if (memoryFinalizeErr) return reject(memoryFinalizeErr);
                            historyStmt.finalize((historyFinalizeErr) => historyFinalizeErr ? reject(historyFinalizeErr) : resolve());
                        });
                    }
                });
            });
        });
    }

    static sensorDescriptor(unit) {
        const meta = (() => { try { return JSON.parse(unit.meta || '{}'); } catch { return {}; } })();
        let scanRange = Number(meta.scanRange) || 5;
        let hostMeta = {}; try { hostMeta = JSON.parse(unit.host_meta || '{}'); } catch {}
        if (meta.stationClass === 'moon-station' && (meta.hostGameplayType === 'cratered' || hostMeta.gameplayType === 'cratered' || hostMeta.visualType === 'cratered')) scanRange *= 1.25;
        let detailedRange = Number(meta.detailedScanRange) || Math.floor(scanRange / 3);
        if (typeof meta.scanRangeMultiplier === 'number' && meta.scanRangeMultiplier > 1) {
            scanRange = Math.ceil(scanRange * meta.scanRangeMultiplier);
            detailedRange = Math.ceil(detailedRange * meta.scanRangeMultiplier);
        }
        return { x: Number(unit.x), y: Number(unit.y), scanRange, detailedRange };
    }

    static visibilityLevelAt(sensors, x, y) {
        let level = 0;
        for (const sensor of sensors) {
            const distance = Math.hypot(Number(x) - sensor.x, Number(y) - sensor.y);
            if (distance <= sensor.detailedRange) return 2;
            if (distance <= sensor.scanRange) level = 1;
        }
        return level;
    }

    static async getOperationalSensorCoverage(gameId, userId, sectorId) {
        const units = await new Promise((resolve, reject) => db.all(
            `SELECT so.id, so.type, so.x, so.y, so.meta, parent.meta AS host_meta
             FROM sector_objects so
             JOIN sectors s ON s.id = so.sector_id
             LEFT JOIN sector_objects parent ON parent.id = so.parent_object_id
             WHERE s.game_id = ? AND so.sector_id = ? AND so.owner_id = ?
               AND so.type IN ('ship', 'station', 'sensor-tower')`,
            [gameId, sectorId, userId],
            (err, rows) => err ? reject(err) : resolve(rows || [])
        ));
        return units.filter(isObjectOperational).map(GameWorldManager.sensorDescriptor);
    }

    static async getVisibleResourceNodes(gameId, userId, sectorId, options = {}) {
        const sensors = options.sensors || await GameWorldManager.getOperationalSensorCoverage(gameId, userId, sectorId);
        if (sensors.length === 0) return [];
        const sensorBounds = {
            minX: Math.min(...sensors.map(sensor => sensor.x - sensor.scanRange)),
            maxX: Math.max(...sensors.map(sensor => sensor.x + sensor.scanRange)),
            minY: Math.min(...sensors.map(sensor => sensor.y - sensor.scanRange)),
            maxY: Math.max(...sensors.map(sensor => sensor.y + sensor.scanRange))
        };
        const requested = options.bounds || {};
        const bounds = {
            minX: Math.max(sensorBounds.minX, Number.isFinite(requested.minX) ? requested.minX : -Infinity),
            maxX: Math.min(sensorBounds.maxX, Number.isFinite(requested.maxX) ? requested.maxX : Infinity),
            minY: Math.max(sensorBounds.minY, Number.isFinite(requested.minY) ? requested.minY : -Infinity),
            maxY: Math.min(sensorBounds.maxY, Number.isFinite(requested.maxY) ? requested.maxY : Infinity)
        };
        if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) return [];
        const resources = await new Promise((resolve, reject) => db.all(
            `SELECT rn.id, 'resource_node' as type, rn.x, rn.y, NULL as owner_id,
                    JSON_OBJECT('resourceType', rt.resource_name,
                                'resourceAmount', rn.resource_amount,
                                'maxResource', rn.max_resource,
                                'size', rn.size,
                                'isDepleted', rn.is_depleted,
                                'iconEmoji', rt.icon_emoji,
                                'colorHex', rt.color_hex) as meta,
                    rn.sector_id, rt.category as celestial_type, rn.size as radius,
                    rn.parent_object_id, rt.resource_name as resource_name,
                    rt.icon_emoji as icon_emoji, rn.resource_amount, rn.is_depleted
             FROM resource_nodes rn
             JOIN resource_types rt ON rn.resource_type_id = rt.id
             JOIN sectors s ON s.id = rn.sector_id
             WHERE s.game_id = ? AND rn.sector_id = ?
               AND rn.resource_amount > 0 AND rn.is_depleted = 0
               AND rn.x BETWEEN ? AND ? AND rn.y BETWEEN ? AND ?`,
            [gameId, sectorId, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY],
            (error, rows) => error ? reject(error) : resolve(rows || [])
        ));
        return resources.flatMap(resource => {
            const visibilityLevel = GameWorldManager.visibilityLevelAt(sensors, resource.x, resource.y);
            return visibilityLevel > 0 ? [{ ...resource, visibility_level: visibilityLevel }] : [];
        });
    }

    static async computeCurrentVisibility(gameId, userId, sectorId) {
        const sensors = await GameWorldManager.getOperationalSensorCoverage(gameId, userId, sectorId);
        if (sensors.length === 0) return new Map();
        const minX = Math.min(...sensors.map(s => s.x - s.scanRange));
        const maxX = Math.max(...sensors.map(s => s.x + s.scanRange));
        const minY = Math.min(...sensors.map(s => s.y - s.scanRange));
        const maxY = Math.max(...sensors.map(s => s.y + s.scanRange));
        const objects = await new Promise((resolve, reject) => db.all(
            'SELECT id, x, y FROM sector_objects WHERE sector_id = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?',
            [sectorId, minX, maxX, minY, maxY],
            (err, rows) => err ? reject(err) : resolve(rows || [])
        ));
        const visible = new Map();
        for (const object of objects) {
            const level = GameWorldManager.visibilityLevelAt(sensors, object.x, object.y);
            if (level > 0) visible.set(object.id, { level });
        }
        return visible;
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

                Promise.all([
                    GameWorldManager.computeCurrentVisibility(gameId, userId, sector.id),
                    GameWorldManager.getOperationalSensorCoverage(gameId, userId, sector.id)
                ])
                    .then(([visibleMap, sensors]) => {
                        const visibleIds = Array.from(visibleMap.keys());
                        const ownedQuery = `SELECT so.id, so.type, so.x, so.y, so.owner_id, so.meta, so.sector_id, so.celestial_type, so.radius, so.parent_object_id,
                                                    mo.destination_x, mo.destination_y, mo.movement_path, mo.current_step, mo.movement_speed, mo.eta_turns, mo.status as movement_status,
                                                    mo.warp_phase, mo.warp_preparation_turns, mo.warp_destination_x, mo.warp_destination_y,
                                                    lt.edge_id AS lane_edge_id, lt.progress AS lane_progress, lt.direction AS lane_direction,
                                                    lt.mode AS lane_mode, lt.merge_turns AS lane_merge_turns, le.polyline_json AS lane_polyline_json,
                                                    ht.id as harvesting_task_id, ht.status as harvesting_status, ht.harvest_rate, ht.total_harvested, rt.resource_name as harvesting_resource
                         FROM sector_objects so
                                               LEFT JOIN movement_orders mo ON (so.id = mo.object_id AND mo.status IN ('active','blocked','completed','warp_preparing'))
                                               LEFT JOIN lane_transits lt ON lt.ship_id = so.id
                                               LEFT JOIN lane_edges le ON le.id = lt.edge_id
                                               LEFT JOIN harvesting_tasks ht ON (so.id = ht.ship_id AND ht.status IN ('active','paused'))
                         LEFT JOIN resource_nodes rn ON ht.resource_node_id = rn.id
                         LEFT JOIN resource_types rt ON rn.resource_type_id = rt.id
                                               WHERE so.sector_id = ? AND so.owner_id = ?`;
                        const nonOwnedVisibleQueryBase = `SELECT so.id, so.type, so.x, so.y, so.owner_id, so.meta, so.sector_id, so.celestial_type, so.radius, so.parent_object_id,
                                                    mo.destination_x, mo.destination_y, mo.movement_path, mo.current_step, mo.movement_speed, mo.eta_turns, mo.status as movement_status,
                                                    mo.warp_phase, mo.warp_preparation_turns, mo.warp_destination_x, mo.warp_destination_y,
                                                    lt.edge_id AS lane_edge_id, lt.progress AS lane_progress, lt.direction AS lane_direction,
                                                    lt.mode AS lane_mode, lt.merge_turns AS lane_merge_turns, le.polyline_json AS lane_polyline_json,
                                                    ht.id as harvesting_task_id, ht.status as harvesting_status, ht.harvest_rate, ht.total_harvested, rt.resource_name as harvesting_resource
                                               FROM sector_objects so
                                               LEFT JOIN movement_orders mo ON (so.id = mo.object_id AND mo.status IN ('active','blocked','completed','warp_preparing'))
                                               LEFT JOIN lane_transits lt ON lt.ship_id = so.id
                                               LEFT JOIN lane_edges le ON le.id = lt.edge_id
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
                        tasks.push(GameWorldManager.getVisibleResourceNodes(gameId, userId, sector.id, { sensors }));

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
                                        o.last_seen_turn = null;
                                    } else {
                                        if (o.meta && typeof o.meta === 'string') {
                                            try { o.meta = JSON.parse(o.meta); } catch { o.meta = {}; }
                                        }
                                        if (o.meta?.alwaysKnown === true) o.visibility_level = 1;
                                        else if (Number(o.owner_id) === Number(userId)) o.visibility_level = 2;
                                        else o.visibility_level = visibleMap.get(o.id)?.level || 0;
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
                                        'SELECT avatar, color_primary AS colorPrimary, color_secondary AS colorSecondary, setup_completed, political_influence AS politicalInfluence FROM game_players WHERE game_id = ? AND user_id = ?',
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
                                                                    plannedDestination: obj.destination_x != null && obj.destination_y != null ? { x: obj.destination_x, y: obj.destination_y } : null,
                                                                    movementETA: obj.eta_turns,
                                                                    movementActive: obj.movement_status === 'active',
                                                                    movementStatus: obj.movement_status,
                                                                    movementRetrying: obj.movement_status === 'blocked',
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

                                                            let laneTransit = null;
                                                            if (obj.lane_edge_id != null && obj.lane_polyline_json) {
                                                                try {
                                                                    laneTransit = {
                                                                        edgeId: Number(obj.lane_edge_id),
                                                                        progress: Number(obj.lane_progress || 0),
                                                                        direction: Number(obj.lane_direction || 1),
                                                                        mode: obj.lane_mode || 'core',
                                                                        mergeTurns: Number(obj.lane_merge_turns || 0),
                                                                        polyline: JSON.parse(obj.lane_polyline_json)
                                                                    };
                                                                } catch {}
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
                                                                laneTransit,
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
    const stats = await require('./pilot.service').getPilotStats(gameId, userId, currentTurn, db);
    const deadRows = await new Promise((resolve) => db.all(`SELECT respawn_turn AS turn, SUM(count) AS qty FROM dead_pilots_queue WHERE game_id=? AND user_id=? AND respawn_turn>? GROUP BY respawn_turn ORDER BY respawn_turn`, [gameId,userId,currentTurn], (e, rows) => resolve(rows || [])));
    return { ...stats, active: stats.deployed, dead: stats.recovering, respawnsByTurn: deadRows.map(r => ({ turn:Number(r.turn), turnsLeft:Math.max(0,Number(r.turn)-Number(currentTurn)), count:Number(r.qty||0) })) };
}

module.exports = { GameWorldManager, getCurrentTurnNumberServer, computePilotStats };
