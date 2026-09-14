const db = require('../../db');
const { Abilities } = require('../registry/abilities');
const { isLiveShip } = require('./combat-rules');

class AbilitiesService {
    async queueAbility({ gameId, casterId, abilityKey, targetObjectId, targetX, targetY, params }) {
        if (!gameId || !casterId || !abilityKey) return { success: false, httpStatus: 400, error: 'Missing gameId/casterId/abilityKey' };
        const ability = Abilities[abilityKey];
        if (!ability) return { success: false, httpStatus: 400, error: 'Unknown ability' };
        // Current turn
        const currentTurn = await new Promise((resolve) => db.get('SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [gameId], (e, r) => resolve(r?.turn_number || 1)));
        // Validate caster ownership
        const caster = await new Promise((resolve) => db.get(
            `SELECT so.id, so.owner_id, so.sector_id, so.x, so.y, so.meta, so.type
             FROM sector_objects so JOIN sectors s ON s.id = so.sector_id
             WHERE so.id = ? AND so.type = 'ship' AND s.game_id = ?`,
            [casterId, gameId], (err, row) => resolve(row)
        ));
        if (!caster) return { success: false, httpStatus: 404, error: 'Caster not found' };
        if (!isLiveShip(caster)) return { success: false, httpStatus: 400, error: 'Ship is destroyed' };
        // Basic target validation
        if (ability.type === 'offense' && !targetObjectId) return { success: false, httpStatus: 400, error: 'Offensive abilities require a target object' };
        if (ability.target === 'position' && (typeof targetX !== 'number' || typeof targetY !== 'number')) return { success: false, httpStatus: 400, error: 'Position target required' };
        if ((ability.target === 'ally' || ability.target === 'enemy') && !targetObjectId) return { success: false, httpStatus: 400, error: 'Target object required' };
        if (targetObjectId) {
            const target = await new Promise((resolve) => db.get(
                `SELECT so.*, s.game_id FROM sector_objects so
                 JOIN sectors s ON s.id = so.sector_id WHERE so.id = ?`,
                [targetObjectId], (err, row) => resolve(row)
            ));
            if (!target) return { success: false, httpStatus: 404, error: 'Target not found' };
            if (Number(target.game_id) !== Number(gameId) || Number(target.sector_id) !== Number(caster.sector_id)) {
                return { success: false, httpStatus: 400, error: 'Target is not in the caster\'s sector' };
            }
            if (ability.type === 'offense' && !require('./combat-rules').isCombatTarget(target)) {
                return { success: false, httpStatus: 400, error: 'Invalid combat target' };
            }
        }
        // Cooldown check (soft)
        const cdRow = await new Promise((resolve) => db.get('SELECT available_turn FROM ability_cooldowns WHERE ship_id = ? AND ability_key = ?', [casterId, abilityKey], (err, row) => resolve(row)));
        if (cdRow && Number(cdRow.available_turn) > Number(currentTurn)) {
            return { success: false, httpStatus: 400, error: 'Ability on cooldown' };
        }
        // Latest wins for turn
        await new Promise((resolve) => db.run('DELETE FROM ability_orders WHERE caster_id = ? AND game_id = ? AND turn_number = ?', [casterId, gameId, currentTurn], () => resolve()));
        await new Promise((resolve, reject) => db.run(
            `INSERT INTO ability_orders (game_id, turn_number, caster_id, ability_key, target_object_id, target_x, target_y, params, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [gameId, currentTurn, casterId, abilityKey, targetObjectId || null, targetX || null, targetY || null, params ? JSON.stringify(params) : null, new Date().toISOString()],
            (err) => err ? reject(err) : resolve()
        ));
        return { success: true, turnNumber: currentTurn };
    }
}

module.exports = { AbilitiesService };
