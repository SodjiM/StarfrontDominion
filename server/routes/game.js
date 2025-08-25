const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { GameWorldManager, getCurrentTurnNumberServer, computePilotStats } = require('../services/game/game-world.service');
const router = express.Router();


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


router.get('/blueprints', (req, res) => {
    try {
        const { BlueprintsService } = require('../services/registry/blueprints.service');
        const svc = new BlueprintsService();
        const blueprints = svc.listBlueprints();
        res.json({ blueprints });
    } catch (e) {
        console.error('Error returning blueprints', e);
        res.status(500).json({ error: 'Failed to load blueprints' });
    }
});

// Abilities registry (for client UI)
router.get('/abilities', (req, res) => {
    try {
        const { AbilitiesService } = require('../services/registry/abilities.service');
        const svc = new AbilitiesService();
        const abilities = svc.listAbilities();
        res.json({ abilities });
    } catch (e) {
        console.error('Error returning abilities', e);
        res.status(500).json({ error: 'Failed to load abilities' });
    }
});

// System archetypes registry
router.get('/archetypes', (req, res) => {
    try {
        const { ArchetypesService } = require('../services/registry/archetypes.service');
        const svc = new ArchetypesService();
        res.json({ archetypes: svc.listArchetypes() });
    } catch (e) {
        console.error('Error returning archetypes', e);
        res.status(500).json({ error: 'Failed to load archetypes' });
    }
});

// moved to state.routes.js

// Player setup route
router.post('/setup/:gameId', async (req, res) => {
    const { gameId } = req.params;
    const schema = require('zod').z.object({
        userId: require('zod').z.coerce.number().int().positive(),
        avatar: require('zod').z.string().min(1),
        colorPrimary: require('zod').z.string().min(1),
        colorSecondary: require('zod').z.string().min(1),
        systemName: require('zod').z.string().min(1),
        archetypeKey: require('zod').z.string().optional()
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
    const { userId, avatar, colorPrimary, colorSecondary, systemName, archetypeKey } = parsed.data;
    
    console.log(`🎨 Setup request for game ${gameId}, user ${userId}:`, {
        avatar, colorPrimary, colorSecondary, systemName
    });

    try {
        const { PlayerSetupService } = require('../services/game/player-setup.service');
        const svc = new PlayerSetupService();
        await svc.completeSetup({ gameId, userId, avatar, colorPrimary, colorSecondary, systemName, archetypeKey });
        console.log(`✅ Player ${userId} completed setup for game ${gameId}`);
        res.json({ 
            success: true,
            message: 'Setup completed successfully'
        });
    } catch (err) {
        console.error('Error completing player setup:', err);
        return res.status(500).json({ error: 'Failed to update player' });
    }
});

// Active scan route - temporary extended vision
router.post('/scan/:gameId', (req, res) => {
    return res.status(410).json({ error: 'Active scan has been removed. Use abilities like survey_scanner.' });
});

// PHASE 1C: Get movement history for accurate trail rendering
// GET /game/:gameId/movement-history/:userId
// moved to movement.routes.js

// Get resource nodes near a ship
router.get('/resource-nodes/:gameId/:shipId', async (req, res) => {
    const { gameId, shipId } = req.params;
    const { userId } = req.query;
    const range = req.query?.range ? Number(req.query.range) : undefined;
    try {
        const owned = await new Promise((resolve) => db.get(`SELECT 1 FROM sector_objects so JOIN sectors s ON so.sector_id = s.id WHERE so.id = ? AND so.owner_id = ? AND s.game_id = ?`, [shipId, userId, gameId], (e, r) => resolve(!!r)));
        if (!owned) return res.status(404).json({ error: 'Ship not found or not owned by player' });
        const { HarvestingService } = require('../services/game/harvesting.service');
        const svc = new HarvestingService();
        const out = await svc.getNearbyResourceNodes(shipId, range);
        res.json({ resourceNodes: out.resourceNodes });
    } catch (e) {
        console.error('Error getting resource nodes:', e);
        res.status(500).json({ error: 'Failed to get resource nodes' });
    }
});

// Get object cargo (ships, structures, etc.)
// moved to cargo.routes.js

// Transfer resources between objects
// moved to cargo.routes.js

// Ship type definitions
// Legacy SHIP_TYPES removed; use blueprint-driven stats

const { STRUCTURE_TYPES } = require('../domain/structures');

// Build ship endpoint
// moved to build.routes.js

// Build structure endpoint (creates cargo item)
// moved to build.routes.js

// Deploy structure endpoint
// moved to build.routes.js

// Build a basic Explorer for testing (1 rock)
// moved to build.routes.js

// Get all sectors in a game
router.get('/sectors', async (req, res) => {
    const { gameId, userId } = req.query;
    if (!gameId || !userId) {
        return res.status(400).json({ error: 'Game ID and User ID required' });
    }
    try {
        const { SectorsRepository } = require('../repositories/sectors.repo');
        const sectorsRepo = new SectorsRepository();
        const sectors = await sectorsRepo.listForGame(gameId);
        res.json({ sectors });
    } catch (e) {
        console.error('Error fetching sectors:', e);
        return res.status(500).json({ error: 'Database error' });
    }
});

// Get all player objects across all sectors
router.get('/player-fleet', async (req, res) => {
    const { gameId, userId } = req.query;
    if (!gameId || !userId) {
        return res.status(400).json({ error: 'Game ID and User ID required' });
    }
    try {
        const { FleetRepository } = require('../repositories/fleet.repo');
        const fleetRepo = new FleetRepository();
        const objects = await fleetRepo.listPlayerFleet(gameId, userId);
        res.json({ fleet: objects });
    } catch (e) {
        console.error('Error fetching player fleet:', e);
        return res.status(500).json({ error: 'Database error' });
    }
});

// Switch player's view to a different sector
// moved to players.routes.js

// Deploy interstellar gate with destination sector
router.post('/deploy-interstellar-gate', async (req, res) => {
    const { shipId, destinationSectorId, userId } = req.body;
    try {
        const { BuildService } = require('../services/game/build.service');
        const svc = new BuildService();
        const result = await svc.deployInterstellarGate({ shipId, destinationSectorId, userId });
        if (!result.success) return res.status(result.httpStatus || 400).json({ error: result.error });
        const { originGateId, destGateId, gatePairId } = result;
        res.json({ success: true, structureName: 'Interstellar Gate', originGateId, destGateId, gatePairId });
    } catch (e) {
        console.error('Error deploying interstellar gate:', e);
        res.status(500).json({ error: 'Failed to deploy interstellar gate' });
    }
});

// Interstellar travel via HTTP has been removed in favor of sockets

module.exports = { router, GameWorldManager }; 