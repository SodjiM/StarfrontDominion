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
                    
                    // Get all objects in player's sector
                    db.all(
                        'SELECT * FROM sector_objects WHERE sector_id = ?',
                        [sector.id],
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
                                            
                                            // Parse meta JSON for objects
                                            const parsedObjects = objects.map(obj => ({
                                                ...obj,
                                                meta: JSON.parse(obj.meta || '{}')
                                            }));
                                            
                                            resolve({
                                                sector,
                                                objects: parsedObjects,
                                                currentTurn: currentTurn || { turn_number: 1, status: 'waiting' },
                                                turnLocked: lockStatus?.locked || false
                                            });
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

module.exports = router; 