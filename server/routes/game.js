const express = require('express');
const db = require('../db');
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
        
        // Create sector
        db.run(
            'INSERT INTO sectors (game_id, owner_id, name) VALUES (?, ?, ?)',
            [gameId, player.user_id, sectorName],
            function(err) {
                if (err) {
                    console.error('Error creating sector:', err);
                    return reject(err);
                }
                
                const sectorId = this.lastID;
                console.log(`📍 Created sector ${sectorId} for ${player.username}`);
                
                // Create starting objects for this player
                GameWorldManager.createStartingObjects(gameId, player, sectorId, () => {
                    // Process next player
                    GameWorldManager.createPlayerSectors(gameId, players, index + 1, resolve, reject);
                }, reject);
            }
        );
    }
    
    // Create starting objects for a player
    static createStartingObjects(gameId, player, sectorId, onComplete, onError) {
        // Create starting starbase at center (2500, 2500)
        const starbaseMeta = JSON.stringify({
            name: `${player.username} Prime Station`,
            hp: 100,
            maxHp: 100,
            scanRange: 15,
            pilots: 5
        });
        
        db.run(
            'INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta) VALUES (?, ?, ?, ?, ?, ?)',
            [sectorId, 'starbase', 2500, 2500, player.user_id, starbaseMeta],
            function(err) {
                if (err) {
                    console.error('Error creating starbase:', err);
                    return onError(err);
                }
                
                console.log(`🏭 Created starbase for ${player.username}`);
                
                // Create starting ship adjacent to starbase
                const shipMeta = JSON.stringify({
                    name: `${player.username} Explorer`,
                    hp: 50,
                    maxHp: 50,
                    scanRange: 8,
                    movementSpeed: 4
                });
                
                db.run(
                    'INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta) VALUES (?, ?, ?, ?, ?, ?)',
                    [sectorId, 'ship', 2501, 2500, player.user_id, shipMeta],
                    function(err) {
                        if (err) {
                            console.error('Error creating ship:', err);
                            return onError(err);
                        }
                        
                        console.log(`🚢 Created ship for ${player.username}`);
                        
                        // Initialize visibility around starting position
                        GameWorldManager.initializeVisibility(gameId, player.user_id, sectorId, 2500, 2500, onComplete, onError);
                    }
                );
            }
        );
    }
    
    // Initialize visibility around starting position
    static initializeVisibility(gameId, userId, sectorId, centerX, centerY, onComplete, onError) {
        const visibilityRange = 10;
        let insertCount = 0;
        let totalInserts = 0;
        
        // Count total inserts needed
        for (let dx = -visibilityRange; dx <= visibilityRange; dx++) {
            for (let dy = -visibilityRange; dy <= visibilityRange; dy++) {
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance <= visibilityRange) {
                    totalInserts++;
                }
            }
        }
        
        // Insert visibility data
        for (let dx = -visibilityRange; dx <= visibilityRange; dx++) {
            for (let dy = -visibilityRange; dy <= visibilityRange; dy++) {
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance <= visibilityRange) {
                    db.run(
                        'INSERT OR IGNORE INTO player_visibility (game_id, user_id, sector_id, x, y, last_seen_turn, visibility_level) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [gameId, userId, sectorId, centerX + dx, centerY + dy, 1, 1],
                        (err) => {
                            if (err) {
                                console.error('Error creating visibility:', err);
                                return onError(err);
                            }
                            
                            insertCount++;
                            if (insertCount === totalInserts) {
                                console.log(`👁️ Initialized visibility for player ${userId}`);
                                onComplete();
                            }
                        }
                    );
                }
            }
        }
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
            // Get player's sector
            db.get(
                'SELECT id FROM sectors WHERE game_id = ? AND owner_id = ?',
                [gameId, userId],
                (err, sector) => {
                    if (err || !sector) return reject(new Error('Sector not found'));
                    
                    // Get all player's units with scan capabilities
                    db.all(
                        'SELECT * FROM sector_objects WHERE sector_id = ? AND owner_id = ? AND type IN ("ship", "starbase")',
                        [sector.id, userId],
                        (err, units) => {
                            if (err) return reject(err);
                            
                            const visionTiles = new Set();
                            const detailedScanTiles = new Set();
                            
                            units.forEach(unit => {
                                const meta = JSON.parse(unit.meta || '{}');
                                const scanRange = meta.scanRange || 5; // Default scan range
                                const detailedRange = meta.detailedScanRange || 2; // Close-range detailed scan
                                
                                // Add vision tiles around this unit
                                for (let dx = -scanRange; dx <= scanRange; dx++) {
                                    for (let dy = -scanRange; dy <= scanRange; dy++) {
                                        const distance = Math.sqrt(dx * dx + dy * dy);
                                        if (distance <= scanRange) {
                                            const tileKey = `${unit.x + dx},${unit.y + dy}`;
                                            visionTiles.add(tileKey);
                                            
                                            // Add detailed scan for close range
                                            if (distance <= detailedRange) {
                                                detailedScanTiles.add(tileKey);
                                            }
                                        }
                                    }
                                }
                            });
                            
                            // Update visibility in database
                            this.updatePlayerVisibility(gameId, userId, sector.id, visionTiles, detailedScanTiles, turnNumber, resolve, reject);
                        }
                    );
                }
            );
        });
    }

    // Update player visibility in database
    static updatePlayerVisibility(gameId, userId, sectorId, visionTiles, detailedScanTiles, turnNumber, resolve, reject) {
        let updateCount = 0;
        const totalUpdates = visionTiles.size;
        
        if (totalUpdates === 0) {
            return resolve([]);
        }
        
        visionTiles.forEach(tileKey => {
            const [x, y] = tileKey.split(',').map(Number);
            const visibilityLevel = detailedScanTiles.has(tileKey) ? 2 : 1; // 2=detailed, 1=basic
            
            db.run(
                `INSERT OR REPLACE INTO player_visibility 
                 (game_id, user_id, sector_id, x, y, last_seen_turn, visibility_level) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [gameId, userId, sectorId, x, y, turnNumber, visibilityLevel],
                (err) => {
                    if (err) {
                        console.error('Error updating visibility:', err);
                        return reject(err);
                    }
                    
                    updateCount++;
                    if (updateCount === totalUpdates) {
                        console.log(`👁️ Updated ${totalUpdates} visibility tiles for player ${userId} on turn ${turnNumber}`);
                        resolve(Array.from(visionTiles));
                    }
                }
            );
        });
    }
    
    // Get game state for a specific player (works asynchronously)
    static async getPlayerGameState(gameId, userId) {
        return new Promise((resolve, reject) => {
            // Get player's sector
            db.get(
                'SELECT * FROM sectors WHERE game_id = ? AND owner_id = ?',
                [gameId, userId],
                (err, sector) => {
                    if (err) return reject(err);
                    if (!sector) return reject(new Error('Sector not found for player'));
                    
                    // Get visible objects with fog of war filtering, including movement data
                    db.all(
                        `SELECT so.*, pv.visibility_level, pv.last_seen_turn, 
                                mo.destination_x, mo.destination_y, mo.movement_path, 
                                mo.eta_turns, mo.status as movement_status
                         FROM sector_objects so
                         LEFT JOIN player_visibility pv ON (
                             pv.game_id = ? AND pv.user_id = ? AND pv.sector_id = so.sector_id 
                             AND pv.x = so.x AND pv.y = so.y
                         )
                         LEFT JOIN movement_orders mo ON (
                             so.id = mo.object_id AND mo.status IN ('active', 'blocked', 'completed')
                         )
                         WHERE so.sector_id = ? 
                         AND (
                             so.owner_id = ? OR 
                             pv.visibility_level > 0 OR
                             JSON_EXTRACT(so.meta, '$.alwaysKnown') = 1
                         )`,
                        [gameId, userId, sector.id, userId],
                        (err, objects) => {
                            if (err) return reject(err);
                            
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
                                                'SELECT avatar, color_primary, color_secondary, setup_completed FROM game_players WHERE game_id = ? AND user_id = ?',
                                                [gameId, userId],
                                                (err, playerData) => {
                                                    if (err) return reject(err);
                                                    
                                                    // Parse meta JSON and determine visibility status for objects
                                                    const parsedObjects = objects.map(obj => {
                                                        const meta = JSON.parse(obj.meta || '{}');
                                                        const isOwned = obj.owner_id === userId;
                                                        const isVisible = obj.visibility_level > 0;
                                                        const isAlwaysKnown = meta.alwaysKnown === true;
                                                        
                                                        // Parse movement data if available
                                                        let movementData = null;
                                                        if (obj.movement_path && obj.movement_status) {
                                                            const movementPath = JSON.parse(obj.movement_path || '[]');
                                                            movementData = {
                                                                movementPath: movementPath,
                                                                plannedDestination: obj.destination_x && obj.destination_y ? 
                                                                    { x: obj.destination_x, y: obj.destination_y } : null,
                                                                movementETA: obj.eta_turns,
                                                                movementActive: obj.movement_status === 'active' || obj.movement_status === 'completed',
                                                                movementStatus: obj.movement_status
                                                            };
                                                        }
                                                        
                                                        return {
                                                            ...obj,
                                                            meta,
                                                            ...movementData, // Spread movement data directly into object
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
                                                        playerSetup: playerData || { setup_completed: false }
                                                    });
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
        });
    }
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
        res.json(gameState);
        
    } catch (error) {
        console.error('❌ Get game state error:', error);
        res.status(500).json({ 
            error: 'Failed to get game state', 
            details: error.message 
        });
    }
});

// Get visible map data for player around a specific position - ASYNCHRONOUS FRIENDLY
router.get('/:gameId/map/:userId/:x/:y', (req, res) => {
    const { gameId, userId, x, y } = req.params;
    const centerX = parseInt(x);
    const centerY = parseInt(y);
    const viewRange = parseInt(req.query.range) || 15;
    
    // Get player's sector
    db.get(
        'SELECT id FROM sectors WHERE game_id = ? AND owner_id = ?',
        [gameId, userId],
        (err, sector) => {
            if (err || !sector) {
                return res.status(404).json({ error: 'Sector not found' });
            }
            
            // Get visible objects within range
            db.all(
                `SELECT so.*, pv.visibility_level 
                 FROM sector_objects so
                 LEFT JOIN player_visibility pv ON (
                     pv.game_id = ? AND pv.user_id = ? AND pv.sector_id = so.sector_id 
                     AND pv.x = so.x AND pv.y = so.y
                 )
                 WHERE so.sector_id = ? 
                 AND so.x BETWEEN ? AND ? 
                 AND so.y BETWEEN ? AND ?
                 AND (pv.visibility_level > 0 OR so.owner_id = ?)`,
                [
                    gameId, userId, sector.id,
                    centerX - viewRange, centerX + viewRange,
                    centerY - viewRange, centerY + viewRange,
                    userId
                ],
                (err, objects) => {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to get map data' });
                    }
                    
                    // Parse meta JSON and format response
                    const mapData = objects.map(obj => ({
                        id: obj.id,
                        type: obj.type,
                        x: obj.x,
                        y: obj.y,
                        owner_id: obj.owner_id,
                        meta: JSON.parse(obj.meta || '{}'),
                        visible: obj.visibility_level > 0 || obj.owner_id == userId
                    }));
                    
                    res.json({
                        centerX,
                        centerY,
                        viewRange,
                        objects: mapData
                    });
                }
            );
        }
    );
});

// Player setup route
router.post('/setup/:gameId', (req, res) => {
    const { gameId } = req.params;
    const { userId, avatar, colorPrimary, colorSecondary, systemName, archetype } = req.body;
    
    console.log(`🎨 Setup request for game ${gameId}, user ${userId}:`, {
        avatar, colorPrimary, colorSecondary, systemName, archetype
    });
    
    // Validate input
    if (!userId || !avatar || !colorPrimary || !colorSecondary || !systemName || !archetype) {
        console.error('❌ Missing required fields:', { userId, avatar, colorPrimary, colorSecondary, systemName, archetype });
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
                    
                    // Update sector name and archetype
                    db.run('UPDATE sectors SET name = ?, archetype = ? WHERE game_id = ? AND owner_id = ?',
                        [systemName, archetype, gameId, userId], function(sectorErr) {
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
router.post('/scan/:gameId', (req, res) => {
    const { gameId } = req.params;
    const { userId, unitId, scanType = 'active' } = req.body;
    
    console.log(`🔍 Active scan request for game ${gameId}, user ${userId}, unit ${unitId}`);
    
    // Get the unit being used for scanning
    db.get(
        'SELECT so.*, s.id as sector_id FROM sector_objects so JOIN sectors s ON so.sector_id = s.id WHERE so.id = ? AND so.owner_id = ? AND s.game_id = ?',
        [unitId, userId, gameId],
        (err, unit) => {
            if (err) {
                console.error('Error finding unit:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!unit) {
                return res.status(404).json({ error: 'Unit not found or not owned by player' });
            }
            
            const meta = JSON.parse(unit.meta || '{}');
            
            // Check if unit can perform active scans
            if (!meta.canActiveScan) {
                return res.status(400).json({ error: 'Unit cannot perform active scans' });
            }
            
            // Check energy/cooldown (if implemented)
            const activeScanRange = meta.activeScanRange || meta.scanRange * 2 || 10;
            const energyCost = meta.activeScanCost || 1;
            
            if (meta.energy !== undefined && meta.energy < energyCost) {
                return res.status(400).json({ error: 'Insufficient energy for active scan' });
            }
            
            // Get current turn
            db.get(
                'SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1',
                [gameId],
                (err, turn) => {
                    if (err) {
                        console.error('Error getting current turn:', err);
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    const currentTurn = turn?.turn_number || 1;
                    
                    // Create temporary extended vision
                    const visionTiles = new Set();
                    const detailedScanTiles = new Set();
                    
                    for (let dx = -activeScanRange; dx <= activeScanRange; dx++) {
                        for (let dy = -activeScanRange; dy <= activeScanRange; dy++) {
                            const distance = Math.sqrt(dx * dx + dy * dy);
                            if (distance <= activeScanRange) {
                                const tileKey = `${unit.x + dx},${unit.y + dy}`;
                                visionTiles.add(tileKey);
                                
                                // Detailed scan for closer range
                                if (distance <= activeScanRange / 2) {
                                    detailedScanTiles.add(tileKey);
                                }
                            }
                        }
                    }
                    
                    // Update visibility with temporary high-level scan
                    GameWorldManager.updatePlayerVisibility(
                        gameId, userId, unit.sector_id, visionTiles, detailedScanTiles, currentTurn,
                        (updatedTiles) => {
                            // Optionally reduce unit energy
                            if (meta.energy !== undefined) {
                                meta.energy = Math.max(0, meta.energy - energyCost);
                                
                                db.run(
                                    'UPDATE sector_objects SET meta = ? WHERE id = ?',
                                    [JSON.stringify(meta), unitId],
                                    (err) => {
                                        if (err) console.error('Error updating unit energy:', err);
                                    }
                                );
                            }
                            
                            console.log(`✅ Active scan completed: ${updatedTiles.length} tiles revealed`);
                            res.json({
                                success: true,
                                tilesRevealed: updatedTiles.length,
                                energyRemaining: meta.energy,
                                message: `Active scan revealed ${updatedTiles.length} new tiles`
                            });
                        },
                        (error) => {
                            console.error('Error updating visibility:', error);
                            res.status(500).json({ error: 'Failed to update visibility' });
                        }
                    );
                }
            );
        }
    );
});

module.exports = { router, GameWorldManager }; 