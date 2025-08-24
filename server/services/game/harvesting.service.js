const { HarvestingManager } = require('../world/harvesting-manager');
const db = require('../../db');

class HarvestingService {
    async getNearbyResourceNodes(shipId, range) {
        const nodes = await HarvestingManager.getNearbyResourceNodes(shipId, range);
        return { success: true, resourceNodes: nodes };
    }

    async startHarvesting({ gameId, shipId, resourceNodeId, baseRate }) {
        const currentTurn = await new Promise((resolve) => db.get('SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [gameId], (e, r) => resolve(r?.turn_number || 1)));
        const result = await HarvestingManager.startHarvesting(shipId, resourceNodeId, currentTurn, baseRate);
        return result;
    }

    async stopHarvesting({ shipId }) {
        const result = await HarvestingManager.stopHarvesting(shipId);
        return result;
    }
}

module.exports = { HarvestingService };


