const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const db = require('./db');
const authRoutes = require('./routes/auth');
const lobbyRoutes = require('./routes/lobby');
const { router: gameRoutes, GameWorldManager } = require('./routes/game');
const { HarvestingManager } = require('./harvesting-manager');

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../client')));

// Routes
app.use('/auth', authRoutes);
app.use('/lobby', lobbyRoutes);
app.use('/game', gameRoutes);

// Serve client files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Socket.IO connection handling - ASYNCHRONOUS FRIENDLY
io.on('connection', (socket) => {
    console.log(`🚀 Player connected: ${socket.id}`);
    
    // Join game room and get current game status
    socket.on('join-game', (gameId, userId) => {
        socket.join(`game-${gameId}`);
        socket.gameId = gameId;
        socket.userId = userId;
        console.log(`👤 Player ${userId} joined game ${gameId} room`);
        
        // Send current game status to newly connected player
        sendGameStatusUpdate(gameId, userId, socket);
    });
    
    // Handle turn locking - ASYNCHRONOUS: Players can lock turns anytime
    socket.on('lock-turn', async (gameId, userId, turnNumber) => {
        try {
            console.log(`🔒 Player ${userId} locking turn ${turnNumber} in game ${gameId}`);
            
            // Update turn lock in database
            db.run(
                'INSERT OR REPLACE INTO turn_locks (game_id, user_id, turn_number, locked, locked_at) VALUES (?, ?, ?, ?, ?)',
                [gameId, userId, turnNumber, true, new Date().toISOString()],
                () => {
                    // Notify all players in the game (whether online or not)
                    io.to(`game-${gameId}`).emit('player-locked-turn', { 
                        userId, 
                        turnNumber,
                        message: `Player ${userId} has locked their turn ${turnNumber}` 
                    });
                    
                    // Check if we can auto-resolve (optional - for faster gameplay)
                    checkTurnResolution(gameId, turnNumber);
                }
            );
        } catch (error) {
            console.error('Turn lock error:', error);
            socket.emit('error', { message: 'Failed to lock turn' });
        }
    });
    
    // Handle movement orders - Store in database for asynchronous processing
    socket.on('move-ship', (data) => {
        const { gameId, shipId, currentX, currentY, destinationX, destinationY, movementPath, estimatedTurns } = data;
        console.log(`🚢 Ship ${shipId} move order: from (${currentX || 'unknown'}, ${currentY || 'unknown'}) to (${destinationX}, ${destinationY}) in game ${gameId}`);
        
        // Get ship's current position and metadata
        db.get('SELECT x, y, meta FROM sector_objects WHERE id = ?', [shipId], (err, ship) => {
            if (err || !ship) {
                console.error('Error finding ship:', err);
                socket.emit('error', { message: 'Ship not found' });
                return;
            }
            
            const meta = JSON.parse(ship.meta || '{}');
            const movementSpeed = meta.movementSpeed || 1;
            const pathLength = movementPath ? movementPath.length - 1 : 0;
            const actualETA = Math.ceil(pathLength / movementSpeed);
            
            // Log position validation
            const serverX = ship.x;
            const serverY = ship.y;
            const clientX = currentX;
            const clientY = currentY;
            
            if (clientX !== undefined && clientY !== undefined) {
                const positionDiff = Math.abs(serverX - clientX) + Math.abs(serverY - clientY);
                if (positionDiff > 0) {
                    console.log(`⚠️ Position desync detected: Ship ${shipId} server:(${serverX},${serverY}) vs client:(${clientX},${clientY}) diff:${positionDiff}`);
                } else {
                    console.log(`✅ Position sync confirmed: Ship ${shipId} at (${serverX},${serverY})`);
                }
            }
            
            // First, cancel any existing movement orders for this ship
            db.run(
                'DELETE FROM movement_orders WHERE object_id = ? AND status IN ("active", "blocked")',
                [shipId],
                function(err) {
                    if (err) {
                        console.error('Error canceling old movement orders:', err);
                        socket.emit('error', { message: 'Failed to cancel previous movement order' });
                        return;
                    }
                    
                    if (this.changes > 0) {
                        console.log(`🗑️ Canceled ${this.changes} existing movement orders for ship ${shipId}`);
                    }
                    
                    // Now store the new movement order with timestamp to prevent duplicates
                    const orderTimestamp = new Date().toISOString();
        db.run(
                        `INSERT INTO movement_orders 
                         (object_id, destination_x, destination_y, movement_speed, eta_turns, movement_path, current_step, status, created_at) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            shipId, 
                            destinationX, 
                            destinationY, 
                            movementSpeed, 
                            actualETA,
                            JSON.stringify(movementPath || []),
                            0,
                            'active',
                            orderTimestamp
                        ],
            (err) => {
                if (err) {
                    console.error('Error storing movement order:', err);
                    socket.emit('error', { message: 'Failed to store movement order' });
                } else {
                                console.log(`📝 Movement order stored: ${pathLength} tiles, ETA ${actualETA} turns`);
                                
                    // Confirm order received
                    socket.emit('movement-confirmed', { 
                        shipId, 
                        destinationX, 
                        destinationY,
                                    pathLength,
                                    estimatedTurns: actualETA,
                                    message: `Movement order confirmed: ${pathLength} tiles, ETA ${actualETA} turns`
                    });
                    
                                // Notify other players about the movement
                    socket.to(`game-${gameId}`).emit('ship-movement-ordered', {
                        shipId,
                        destinationX,
                        destinationY,
                                    pathLength,
                                    estimatedTurns: actualETA,
                        userId: socket.userId
                    });
                }
            }
        );
                }
            );
        });
    });
    
    // Handle warp orders - Store warp preparation in database
    socket.on('warp-ship', (data) => {
        const { gameId, shipId, targetId, targetX, targetY, shipName, targetName } = data;
        console.log(`🌌 Ship ${shipId} (${shipName}) warp order: to ${targetName} at (${targetX}, ${targetY}) in game ${gameId}`);
        
        // Validate ship exists and is owned by player
        db.get('SELECT x, y, meta FROM sector_objects WHERE id = ?', [shipId], (err, ship) => {
            if (err || !ship) {
                console.error('Error finding ship for warp:', err);
                socket.emit('error', { message: 'Ship not found' });
                return;
            }
            
            // Validate target exists
            db.get('SELECT x, y, meta, celestial_type FROM sector_objects WHERE id = ?', [targetId], (err, target) => {
                if (err || !target) {
                    console.error('Error finding warp target:', err);
                    socket.emit('error', { message: 'Warp target not found' });
                    return;
                }
                
                // Cancel any existing movement/warp orders for this ship
                db.run(
                    'DELETE FROM movement_orders WHERE object_id = ? AND status IN ("active", "blocked")',
                    [shipId],
                    function(err) {
                        if (err) {
                            console.error('Error canceling old orders for warp:', err);
                            socket.emit('error', { message: 'Failed to cancel previous orders' });
                            return;
                        }
                        
                        if (this.changes > 0) {
                            console.log(`🗑️ Canceled ${this.changes} existing orders for warp ship ${shipId}`);
                        }
                        
                        // Store warp order with preparation phase
                        const orderTimestamp = new Date().toISOString();
                        db.run(
                            `INSERT INTO movement_orders 
                             (object_id, warp_target_id, warp_destination_x, warp_destination_y, 
                              warp_phase, warp_preparation_turns, status, created_at) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                shipId,
                                targetId,
                                targetX,
                                targetY,
                                'preparing',
                                0,
                                'warp_preparing',
                                orderTimestamp
                            ],
                            (err) => {
                                if (err) {
                                    console.error('Error storing warp order:', err);
                                    socket.emit('error', { message: 'Failed to store warp order' });
                                } else {
                                    console.log(`🌌 Warp order stored: ${shipName} → ${targetName}, preparation phase started`);
                                    
                                    // Confirm warp order received
                                    socket.emit('warp-confirmed', {
                                        shipId,
                                        targetId,
                                        targetName,
                                        targetX,
                                        targetY,
                                        phase: 'preparing',
                                        preparationTurns: 0,
                                        message: `Warp drive engaging. Preparation: 0/2 turns`
                                    });
                                    
                                    // Notify other players about the warp preparation
                                    socket.to(`game-${gameId}`).emit('ship-warp-ordered', {
                                        shipId,
                                        shipName,
                                        targetName,
                                        targetX,
                                        targetY,
                                        phase: 'preparing',
                                        userId: socket.userId
                                    });
                                }
                            }
                        );
                    }
                );
            });
        });
    });
    
    // Handle harvesting operations
    socket.on('start-harvesting', async (data) => {
        const { gameId, shipId, resourceNodeId } = data;
        console.log(`⛏️ Start harvesting request: Ship ${shipId} → Node ${resourceNodeId} in game ${gameId}`);
        
        try {
            // Get current turn
            const currentTurn = await getCurrentTurnNumber(gameId);
            
            const result = await HarvestingManager.startHarvesting(shipId, resourceNodeId, currentTurn);
            
            if (result.success) {
                socket.emit('harvesting-started', {
                    shipId,
                    resourceNodeId,
                    harvestRate: result.harvestRate,
                    resourceType: result.resourceType,
                    message: `Started harvesting ${result.resourceType} at ${result.harvestRate}/turn`
                });
                
                // Notify other players
                socket.to(`game-${gameId}`).emit('ship-harvesting-started', {
                    shipId,
                    resourceType: result.resourceType,
                    userId: socket.userId
                });
            } else {
                socket.emit('harvesting-error', {
                    shipId,
                    error: result.error
                });
            }
        } catch (error) {
            console.error('Error starting harvesting:', error);
            socket.emit('harvesting-error', {
                shipId,
                error: 'Server error starting harvesting operation'
            });
        }
    });
    
    socket.on('stop-harvesting', async (data) => {
        const { gameId, shipId } = data;
        console.log(`🛑 Stop harvesting request: Ship ${shipId} in game ${gameId}`);
        
        try {
            const result = await HarvestingManager.stopHarvesting(shipId);
            
            if (result.success) {
                socket.emit('harvesting-stopped', {
                    shipId,
                    totalHarvested: result.totalHarvested,
                    resourceType: result.resourceType,
                    message: `Stopped harvesting. Total collected: ${result.totalHarvested} ${result.resourceType}`
                });
                
                // Notify other players
                socket.to(`game-${gameId}`).emit('ship-harvesting-stopped', {
                    shipId,
                    userId: socket.userId
                });
            } else {
                socket.emit('harvesting-error', {
                    shipId,
                    error: result.error
                });
            }
        } catch (error) {
            console.error('Error stopping harvesting:', error);
            socket.emit('harvesting-error', {
                shipId,
                error: 'Server error stopping harvesting operation'
            });
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`👋 Player ${socket.userId} disconnected from game ${socket.gameId}`);
    });
});

// Helper function to get current turn number
async function getCurrentTurnNumber(gameId) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1',
            [gameId],
            (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row ? row.turn_number : 1);
                }
            }
        );
    });
}

// Send current game status to a player
function sendGameStatusUpdate(gameId, userId, socket) {
    // Get current turn status
    db.get(
        'SELECT * FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1',
        [gameId],
        (err, currentTurn) => {
            if (err || !currentTurn) return;
            
            // Get player's lock status
            db.get(
                'SELECT locked FROM turn_locks WHERE game_id = ? AND user_id = ? AND turn_number = ?',
                [gameId, userId, currentTurn.turn_number],
                (err, lockStatus) => {
                    if (err) return;
                    
                    socket.emit('game-status-update', {
                        currentTurn: currentTurn.turn_number,
                        turnStatus: currentTurn.status,
                        playerLocked: lockStatus?.locked || false,
                        message: `Welcome back! Current turn: ${currentTurn.turn_number}`
                    });
                }
            );
        }
    );
}

// Check if turn can be resolved (optional auto-resolution for faster gameplay)
function checkTurnResolution(gameId, turnNumber) {
    // Get all players in game
    db.all(
        'SELECT gp.user_id FROM game_players gp WHERE gp.game_id = ?',
        [gameId],
        (err, allPlayers) => {
            if (err) return;
            
            // Get locked players for this turn
            db.all(
                'SELECT user_id FROM turn_locks WHERE game_id = ? AND turn_number = ? AND locked = 1',
                [gameId, turnNumber],
                (err, lockedPlayers) => {
                    if (err) return;
                    
                    console.log(`📊 Game ${gameId} Turn ${turnNumber}: ${lockedPlayers.length}/${allPlayers.length} players have locked`);
                    
                    // Option 1: Auto-resolve when all players lock (immediate)
                    if (lockedPlayers.length === allPlayers.length) {
                        console.log(`⚡ All players locked turn ${turnNumber} for game ${gameId} - auto-resolving!`);
                        resolveTurn(gameId, turnNumber);
                    }
                    
                    // Option 2: Set timer for auto-resolution (e.g., 24 hours)
                    // This allows asynchronous play where players don't need to be online simultaneously
                    // Uncomment the following for time-based resolution:
                    /*
                    else if (lockedPlayers.length > 0) {
                        // Set up delayed resolution (24 hour example)
                        setTimeout(() => {
                            resolveTurn(gameId, turnNumber);
                        }, 24 * 60 * 60 * 1000); // 24 hours
                    }
                    */
                }
            );
        }
    );
}

// Resolve a turn (process all moves, combat, etc.)
// ✅ ATOMIC TURN RESOLUTION POLICY:
// - No real-time updates during resolution
// - All changes happen server-side first
// - Clients receive final results via 'turn-resolved' + loadGameState()
// Global turn resolution locks to prevent concurrent resolution
const turnResolutionLocks = new Set();

// - This ensures consistent game state and eliminates timing bugs
async function resolveTurn(gameId, turnNumber) {
    const lockKey = `${gameId}-${turnNumber}`;
    
    // Check if this turn is already being resolved
    if (turnResolutionLocks.has(lockKey)) {
        console.log(`⏳ Turn ${turnNumber} for game ${gameId} is already being resolved, skipping duplicate`);
        return;
    }
    
    // Acquire lock
    turnResolutionLocks.add(lockKey);
    
    console.log(`🎬 Resolving turn ${turnNumber} for game ${gameId} (Atomic Resolution)`);
    
    // Notify all players that resolution has started
    io.to(`game-${gameId}`).emit('turn-resolving', { 
        turnNumber,
        message: `Turn ${turnNumber} is now resolving...` 
    });
    
    try {
    // 1. Process movement orders
        await processMovementOrders(gameId, turnNumber);
        
        // 2. Update visibility for all players
        await updateAllPlayersVisibility(gameId, turnNumber);
        
        // 3. Clean up old completed movement orders (older than 2 turns)
        await cleanupOldMovementOrders(gameId, turnNumber);
        
        // 4. Process harvesting operations
        await HarvestingManager.processHarvestingForTurn(gameId, turnNumber);
        
        // 5. TODO: Handle combat, etc.
        
        // Create next turn
        const nextTurn = turnNumber + 1;
        
        await new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO turns (game_id, turn_number, status) VALUES (?, ?, ?)',
            [gameId, nextTurn, 'waiting'],
                (err) => {
                    if (err) return reject(err);
                    
                // Mark current turn as resolved
                db.run(
                    'UPDATE turns SET status = ?, resolved_at = ? WHERE game_id = ? AND turn_number = ?',
                    ['completed', new Date().toISOString(), gameId, turnNumber],
                        (err) => {
                            if (err) return reject(err);
                            resolve();
                        }
                    );
                }
            );
        });
        
                        console.log(`✅ Turn ${turnNumber} atomically resolved, starting turn ${nextTurn}`);
                        
                        // Notify all players - they will now loadGameState() to see all changes
                        io.to(`game-${gameId}`).emit('turn-resolved', { 
                            turnNumber: turnNumber,
                            nextTurn: nextTurn,
                            completedTurn: turnNumber,
                            newTurn: nextTurn,
                            message: `Turn ${turnNumber} resolved! All changes are now visible.`
                        });
        
    } catch (error) {
        console.error(`❌ Error resolving turn ${turnNumber}:`, error);
        
        // Notify players of error
        io.to(`game-${gameId}`).emit('turn-error', {
            turnNumber,
            error: 'Turn resolution failed'
        });
    } finally {
        // Always release the lock
        turnResolutionLocks.delete(lockKey);
    }
}

// Process all movement orders for a turn with collision detection
async function processMovementOrders(gameId, turnNumber) {
    return new Promise((resolve, reject) => {
        // Get all active movement AND warp orders for this game (only the most recent per ship)
        db.all(
            `SELECT mo.*, so.x as current_x, so.y as current_y, so.sector_id, so.meta 
             FROM movement_orders mo 
             JOIN sector_objects so ON mo.object_id = so.id 
             JOIN sectors s ON so.sector_id = s.id 
             WHERE s.game_id = ? AND mo.status IN ('active', 'warp_preparing')
             AND mo.created_at = (
                 SELECT MAX(mo2.created_at) 
                 FROM movement_orders mo2 
                 WHERE mo2.object_id = mo.object_id AND mo2.status IN ('active', 'warp_preparing')
             )`,
            [gameId],
            async (err, orders) => {
                if (err) return reject(err);
                
                console.log(`🚀 Processing ${orders.length} movement orders for turn ${turnNumber}`);
                
                // Clean up any duplicate movement orders (keep only the most recent per ship)
                db.run(
                    `DELETE FROM movement_orders 
                     WHERE status = 'active' 
                     AND created_at NOT IN (
                         SELECT MAX(created_at) 
                         FROM movement_orders mo2 
                         WHERE mo2.object_id = movement_orders.object_id 
                         AND mo2.status = 'active'
                     )`,
                    (err) => {
                        if (err) {
                            console.error('Error cleaning duplicate movement orders:', err);
                        } else if (this.changes > 0) {
                            console.log(`🧹 Cleaned up ${this.changes} duplicate movement orders`);
                        }
                    }
                );
                
                const movementResults = [];
                
                // Process each movement order
                for (const order of orders) {
                    try {
                        const result = await processSingleMovement(order, turnNumber, gameId);
                        movementResults.push(result);
                    } catch (error) {
                        console.error(`Error processing movement for object ${order.object_id}:`, error);
                        movementResults.push({
                            objectId: order.object_id,
                            status: 'error',
                            error: error.message
                        });
                    }
                }
                
                console.log(`📝 Movement processing complete: ${movementResults.length} orders processed`);
                resolve(movementResults);
            }
        );
    });
}

// Process a single ship's movement or warp with collision detection
async function processSingleMovement(order, turnNumber, gameId) {
    return new Promise((resolve, reject) => {
        // Handle warp orders separately
        if (order.status === 'warp_preparing') {
            return processWarpOrder(order, turnNumber, gameId, resolve, reject);
        }
        
        const movementPath = JSON.parse(order.movement_path || '[]');
        const currentStep = order.current_step || 0;
        const movementSpeed = order.movement_speed || 1;
        const meta = JSON.parse(order.meta || '{}');
        
        // Calculate how many steps to take this turn
        const stepsToTake = Math.min(movementSpeed, movementPath.length - 1 - currentStep);
        
        if (stepsToTake <= 0) {
            // Movement already complete
            db.run(
                'UPDATE movement_orders SET status = ? WHERE id = ?',
                ['completed', order.id],
                () => resolve({ objectId: order.object_id, status: 'completed' })
            );
            return;
        }
        
        const newStep = currentStep + stepsToTake;
        const targetTile = movementPath[newStep];
        
        if (!targetTile) {
            return reject(new Error('Invalid movement path'));
        }
        
        // Check for collision at target position
        db.get(
            'SELECT id, type, owner_id, meta FROM sector_objects WHERE sector_id = ? AND x = ? AND y = ? AND id != ?',
            [order.sector_id, targetTile.x, targetTile.y, order.object_id],
            (err, collision) => {
                if (err) return reject(err);
                
                if (collision) {
                    // Collision detected - stop movement
                    console.log(`🚧 Movement blocked: Ship ${order.object_id} blocked by ${collision.type} ${collision.id} at (${targetTile.x}, ${targetTile.y})`);
                    
                    const blockingInfo = {
                        blockingObjectId: collision.id,
                        blockingType: collision.type,
                        blockingOwner: collision.owner_id,
                        blockedAt: targetTile,
                        turn: turnNumber
                    };
                    
                    // Update movement order as blocked
                    db.run(
                        'UPDATE movement_orders SET status = ?, blocked_by = ? WHERE id = ?',
                        ['blocked', JSON.stringify(blockingInfo), order.id],
                        () => {
                                                                const result = {
                                        objectId: order.object_id,
                                        status: 'blocked',
                                        blockingInfo,
                                        finalPosition: { x: order.current_x, y: order.current_y }
                                    };
                                    
                                    // ✅ No real-time updates - clients will see results after turn resolves
                                    console.log(`🚫 Ship ${order.object_id} movement blocked at (${order.current_x}, ${order.current_y})`);
                                    
                                    resolve(result);
                        }
                    );
                } else {
                    // No collision - move ship
                    db.run(
                        'UPDATE sector_objects SET x = ?, y = ?, updated_at = ? WHERE id = ?',
                        [targetTile.x, targetTile.y, new Date().toISOString(), order.object_id],
                        (err) => {
                            if (err) return reject(err);
                            
                            // PHASE 1B: Record actual movement segment in history
                            // Get current position from movement path
                            const fromTile = movementPath[currentStep];
                            if (fromTile) {
                                db.run(
                                    `INSERT INTO movement_history 
                                     (object_id, game_id, turn_number, from_x, from_y, to_x, to_y, movement_speed) 
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                                    [
                                        order.object_id, 
                                        gameId, 
                                        turnNumber, 
                                        fromTile.x, 
                                        fromTile.y, 
                                        targetTile.x, 
                                        targetTile.y, 
                                        movementSpeed
                                    ],
                                    (historyErr) => {
                                        if (historyErr) {
                                            console.error(`❌ Failed to record movement history for ship ${order.object_id}:`, historyErr);
                                        } else {
                                            console.log(`📜 Recorded movement history: Ship ${order.object_id} from (${fromTile.x},${fromTile.y}) to (${targetTile.x},${targetTile.y}) on turn ${turnNumber}`);
                                        }
                                    }
                                );
                            } else {
                                console.error(`❌ Could not get current position for ship ${order.object_id} movement history - currentStep: ${currentStep}, pathLength: ${movementPath.length}`);
                            }
                            
                            // Update movement order progress
                            const isComplete = newStep >= movementPath.length - 1;
                            const newStatus = isComplete ? 'completed' : 'active';
                            
                            // STAGE A FIX: Calculate remaining ETA after movement
                            const remainingSteps = movementPath.length - 1 - newStep;
                            const newETA = Math.ceil(remainingSteps / movementSpeed);
                            
                            db.run(
                                'UPDATE movement_orders SET current_step = ?, status = ?, eta_turns = ? WHERE id = ?',
                                [newStep, newStatus, newETA, order.id],
                                () => {
                                    console.log(`🚢 Ship ${order.object_id} moved to (${targetTile.x}, ${targetTile.y}) - Step ${newStep}/${movementPath.length-1} - ETA: ${newETA}T`);
                                    
                                    const result = {
                                        objectId: order.object_id,
                                        status: newStatus,
                                        newPosition: targetTile,
                                        currentStep: newStep,
                                        totalSteps: movementPath.length - 1,
                                        eta: newETA
                                    };
                                    
                                    // ✅ No real-time updates - clients will see all results after turn resolves
                                    if (newStatus === 'completed') {
                                        console.log(`✅ Ship ${order.object_id} completed movement to (${targetTile.x}, ${targetTile.y})`);
                                    } else {
                                        console.log(`➡️ Ship ${order.object_id} continuing movement - step ${newStep}/${movementPath.length-1} - ETA: ${newETA}T`);
                                    }
                                    
                                    resolve(result);
                                }
                            );
                        }
                    );
                }
            }
        );
    });
}

// Process warp order (preparation and execution)
function processWarpOrder(order, turnNumber, gameId, resolve, reject) {
    const preparationTurns = order.warp_preparation_turns || 0;
    const warpPhase = order.warp_phase || 'preparing';
    const meta = JSON.parse(order.meta || '{}');
    
    console.log(`🌌 Processing warp order for ship ${order.object_id}: phase=${warpPhase}, prep=${preparationTurns}/2`);
    
    if (warpPhase === 'preparing') {
        const newPreparationTurns = preparationTurns + 1;
        
        if (newPreparationTurns >= 2) {
            // Preparation complete - execute warp jump
            console.log(`🚀 Warp preparation complete for ship ${order.object_id}, executing jump!`);
            
            // Move ship to destination instantly
            db.run(
                'UPDATE sector_objects SET x = ?, y = ? WHERE id = ?',
                [order.warp_destination_x, order.warp_destination_y, order.object_id],
                function(err) {
                    if (err) {
                        console.error('Error executing warp jump:', err);
                        return reject(err);
                    }
                    
                    console.log(`✨ Ship ${order.object_id} warped to (${order.warp_destination_x}, ${order.warp_destination_y})`);
                    
                    // Delete the warp order (completed)
                    db.run(
                        'DELETE FROM movement_orders WHERE id = ?',
                        [order.id],
                        (err) => {
                            if (err) {
                                console.error('Error cleaning up warp order:', err);
                            }
                            
                            resolve({
                                objectId: order.object_id,
                                status: 'warp_completed',
                                newX: order.warp_destination_x,
                                newY: order.warp_destination_y,
                                message: `Warp jump completed to (${order.warp_destination_x}, ${order.warp_destination_y})`
                            });
                        }
                    );
                }
            );
        } else {
            // Continue preparation - increment turn counter
            db.run(
                'UPDATE movement_orders SET warp_preparation_turns = ? WHERE id = ?',
                [newPreparationTurns, order.id],
                (err) => {
                    if (err) {
                        console.error('Error updating warp preparation:', err);
                        return reject(err);
                    }
                    
                    console.log(`⚡ Ship ${order.object_id} warp preparation: ${newPreparationTurns}/2 turns`);
                    
                    resolve({
                        objectId: order.object_id,
                        status: 'warp_preparing',
                        preparationTurns: newPreparationTurns,
                        message: `Warp drive charging: ${newPreparationTurns}/2 turns`
                    });
                }
            );
        }
    } else {
        // Shouldn't happen, but handle gracefully
        console.warn(`⚠️ Unknown warp phase: ${warpPhase} for ship ${order.object_id}`);
        resolve({
            objectId: order.object_id,
            status: 'warp_error',
            message: 'Unknown warp phase'
        });
    }
}

// STAGE 3 OPTIMIZATION: Parallel processing for all players visibility updates
async function updateAllPlayersVisibility(gameId, turnNumber) {
    return new Promise((resolve, reject) => {
        // Get all players in the game
        db.all(
            'SELECT DISTINCT user_id FROM game_players WHERE game_id = ?',
            [gameId],
            async (err, players) => {
                if (err) return reject(err);
                
                console.log(`👁️ Updating visibility for ${players.length} players (parallel processing)`);
                const startTime = Date.now();
                
                // PARALLEL PROCESSING: Update visibility for all players simultaneously
                const visibilityPromises = players.map(player => 
                    GameWorldManager.calculatePlayerVision(gameId, player.user_id, turnNumber)
                        .catch(error => {
                            console.error(`Error updating visibility for player ${player.user_id}:`, error);
                            return null; // Don't fail entire batch for one player error
                        })
                );
                
                try {
                    await Promise.all(visibilityPromises);
                    const endTime = Date.now();
                    console.log(`👁️ Completed visibility updates for ${players.length} players in ${endTime - startTime}ms (optimized)`);
                    resolve();
                } catch (error) {
                    console.error('Error in parallel visibility processing:', error);
                    reject(error);
                }
            }
        );
    });
}

// Clean up old completed movement orders to prevent database bloat
async function cleanupOldMovementOrders(gameId, currentTurn) {
    return new Promise((resolve, reject) => {
        // Delete movement orders that have been completed for more than 2 turns
        // This gives time for players to see the path completion before it disappears
        db.run(
            `DELETE FROM movement_orders 
             WHERE status = 'completed' 
             AND id IN (
                 SELECT mo.id FROM movement_orders mo
                 JOIN sector_objects so ON mo.object_id = so.id
                 JOIN sectors s ON so.sector_id = s.id
                 WHERE s.game_id = ? AND (? - COALESCE(mo.current_step, 0)) > 2
             )`,
            [gameId, currentTurn],
            function(err) {
                if (err) {
                    console.error('Error cleaning up movement orders:', err);
                    return reject(err);
                }
                
                if (this.changes > 0) {
                    console.log(`🧹 Cleaned up ${this.changes} old movement orders for game ${gameId}`);
                }
                resolve();
            }
        );
    });
}

// Helper function to calculate ETA for movement
function calculateETA(destX, destY, shipId) {
    // TODO: Get ship position and calculate actual distance/speed
    // For now, return a simple estimate
    return 3; // 3 turns
}

// Make io available to routes
app.set('io', io);

// Start server
server.listen(PORT, () => {
    console.log(`🌌 Starfront: Dominion server running on http://localhost:${PORT}`);
    console.log(`🎮 Game client available at http://localhost:${PORT}/`);
    console.log(`📊 Health check at http://localhost:${PORT}/health`);
    console.log(`🔌 Socket.IO enabled for real-time gameplay`);
}); 