const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const db = require('./db');
const authRoutes = require('./routes/auth');
const lobbyRoutes = require('./routes/lobby');
const gameRoutes = require('./routes/game');

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
        const { gameId, shipId, destinationX, destinationY } = data;
        console.log(`🚢 Ship ${shipId} ordered to move to (${destinationX}, ${destinationY}) in game ${gameId}`);
        
        // Store movement order in database
        db.run(
            'INSERT OR REPLACE INTO movement_orders (object_id, destination_x, destination_y, movement_speed, eta_turns) VALUES (?, ?, ?, ?, ?)',
            [shipId, destinationX, destinationY, 4, calculateETA(destinationX, destinationY, shipId)],
            (err) => {
                if (err) {
                    console.error('Error storing movement order:', err);
                    socket.emit('error', { message: 'Failed to store movement order' });
                } else {
                    // Confirm order received
                    socket.emit('movement-confirmed', { 
                        shipId, 
                        destinationX, 
                        destinationY,
                        message: 'Movement order confirmed' 
                    });
                    
                    // Notify other players (if online) about the movement
                    socket.to(`game-${gameId}`).emit('ship-movement-ordered', {
                        shipId,
                        destinationX,
                        destinationY,
                        userId: socket.userId
                    });
                }
            }
        );
    });
    
    socket.on('disconnect', () => {
        console.log(`👋 Player ${socket.userId} disconnected from game ${socket.gameId}`);
    });
});

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
function resolveTurn(gameId, turnNumber) {
    console.log(`🎬 Resolving turn ${turnNumber} for game ${gameId}`);
    
    // Notify all players (online and offline will see this when they reconnect)
    io.to(`game-${gameId}`).emit('turn-resolving', { 
        turnNumber,
        message: `Turn ${turnNumber} is now resolving...` 
    });
    
    // TODO: Implement actual turn resolution logic
    // 1. Process movement orders
    // 2. Handle combat
    // 3. Update visibility
    // 4. Process resource generation
    
    // For now, just simulate processing time
    setTimeout(() => {
        const nextTurn = turnNumber + 1;
        
        // Create next turn in database
        db.run(
            'INSERT INTO turns (game_id, turn_number, status) VALUES (?, ?, ?)',
            [gameId, nextTurn, 'waiting'],
            () => {
                // Mark current turn as resolved
                db.run(
                    'UPDATE turns SET status = ?, resolved_at = ? WHERE game_id = ? AND turn_number = ?',
                    ['completed', new Date().toISOString(), gameId, turnNumber],
                    () => {
                        console.log(`✅ Turn ${turnNumber} resolved, starting turn ${nextTurn}`);
                        
                        // Notify all players
                        io.to(`game-${gameId}`).emit('turn-resolved', { 
                            completedTurn: turnNumber,
                            newTurn: nextTurn,
                            message: `Turn ${turnNumber} complete! Turn ${nextTurn} has begun.`
                        });
                    }
                );
            }
        );
    }, 3000); // 3 second processing simulation
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