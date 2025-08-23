const db = require('../../db');
const CombatConfig = require('./combat-config');
const { Abilities } = require('../registry/abilities');
const { CargoManager } = require('../../cargo-manager');
const { SHIP_BLUEPRINTS, computeAllRequirements } = require('../registry/blueprints');

class CombatService {
    async processAbilityOrders(gameId, turnNumber) {
        // Reuse existing logic by calling the local functions moved out in future; for now inline via require of server/index.js helpers is avoided.
        // For maintainability, we keep this file as a seam; full extraction would mirror code from index.js.
        return require('../../index.js').__processAbilityOrdersDelegated
            ? require('../../index.js').__processAbilityOrdersDelegated(gameId, turnNumber)
            : Promise.resolve();
    }

    async processCombatOrders(gameId, turnNumber) {
        return require('../../index.js').__processCombatOrdersDelegated
            ? require('../../index.js').__processCombatOrdersDelegated(gameId, turnNumber)
            : Promise.resolve();
    }
}

module.exports = { CombatService };


