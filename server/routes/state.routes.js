const express = require('express');
const db = require('../db');
const { GameWorldManager, getCurrentTurnNumberServer, computePilotStats } = require('../services/game/game-world.service');
const router = express.Router();

// Get game state for player
router.get('/:gameId/state/:userId', async (req, res) => {
    const { gameId, userId } = req.params;
    try {
        const membership = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM game_players WHERE game_id = ? AND user_id = ?', [gameId, userId], (err, result) => err ? reject(err) : resolve(result));
        });
        if (!membership) return res.status(403).json({ error: 'Not authorized to view this game' });
        const gameState = await GameWorldManager.getPlayerGameState(gameId, parseInt(userId));
        try {
            const currentTurn = gameState?.currentTurn?.turn_number || await getCurrentTurnNumberServer(gameId);
            gameState.pilotStats = await computePilotStats(gameId, parseInt(userId), currentTurn);
        } catch (e) { console.warn('pilotStats error:', e?.message || e); }
        res.json(gameState);
    } catch (error) {
        console.error('❌ Get game state error:', error);
        res.status(500).json({ error: 'Failed to get game state', details: error.message });
    }
});

// Sector-specific state
router.get('/:gameId/state/:userId/sector/:sectorId', async (req, res) => {
    const { gameId, userId, sectorId } = req.params;
    try {
        const membership = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM game_players WHERE game_id = ? AND user_id = ?', [gameId, userId], (err, result) => err ? reject(err) : resolve(result));
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

// Visible map window for a user around a position
router.get('/:gameId/map/:userId/:sectorId/:x/:y', (req, res) => {
    const { gameId, userId, sectorId, x, y } = req.params;
    const centerX = parseInt(x);
    const centerY = parseInt(y);
    const viewRange = parseInt(req.query.range) || 15;
    const sector = parseInt(sectorId);
    GameWorldManager.computeCurrentVisibility(gameId, parseInt(userId), sector)
        .then(visibleMap => {
            db.all(
                `SELECT id, type, x, y, owner_id, meta FROM sector_objects
                 WHERE sector_id = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?`,
                [sector, centerX - viewRange, centerX + viewRange, centerY - viewRange, centerY + viewRange],
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

module.exports = router;

// Itineraries listing for a player's ships in a game (optional sector filter)
// GET /game/:gameId/itineraries/:userId?sectorId=123
router.get('/:gameId/itineraries/:userId', async (req, res) => {
    const { gameId, userId } = req.params;
    const sectorId = req.query?.sectorId ? Number(req.query.sectorId) : null;
    try {
        const membership = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM game_players WHERE game_id = ? AND user_id = ?', [gameId, userId], (err, result) => err ? reject(err) : resolve(result));
        });
        if (!membership) return res.status(403).json({ error: 'Not authorized to view this game' });
        const rows = await new Promise((resolve, reject) => {
            const params = [gameId, userId];
            let sql = `
                SELECT li.id, li.ship_id as shipId, li.sector_id as sectorId, li.created_turn as createdTurn,
                       li.freshness_turns as freshnessTurns, li.status as status, li.itinerary_json as itineraryJson
                FROM lane_itineraries li
                JOIN sectors s ON s.id = li.sector_id
                JOIN sector_objects so ON so.id = li.ship_id
                WHERE s.game_id = ? AND so.owner_id = ?
            `;
            // Default: only show active itineraries unless client passes ?includeAll=1
            const includeAll = String(req.query?.includeAll || '0') === '1';
            if (!includeAll) { sql += " AND li.status = 'active'"; }
            if (sectorId) { sql += ' AND li.sector_id = ?'; params.push(sectorId); }
            sql += ' ORDER BY li.id DESC';
            db.all(sql, params, (e, r) => e ? reject(e) : resolve(r || []));
        });
        const itineraries = rows.map(r => {
            let legs = []; try { legs = JSON.parse(r.itineraryJson || '[]'); } catch {}
            return { id: r.id, shipId: r.shipId, sectorId: r.sectorId, createdTurn: r.createdTurn, freshnessTurns: r.freshnessTurns, status: r.status, legs };
        });
        res.json({ success: true, itineraries });
    } catch (error) {
        console.error('❌ Get itineraries error:', error);
        res.status(500).json({ error: 'Failed to get itineraries' });
    }
});


