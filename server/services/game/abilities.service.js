const db = require('../../db');
const { Abilities } = require('../registry/abilities');

class AbilitiesService {
    async queueAbility({ gameId, casterId, abilityKey, targetObjectId, targetX, targetY, params }) {
        if (!gameId || !casterId || !abilityKey) return { success: false, httpStatus: 400, error: 'Missing gameId/casterId/abilityKey' };
        const ability = Abilities[abilityKey];
        if (!ability) return { success: false, httpStatus: 400, error: 'Unknown ability' };
        // Current turn
        const currentTurn = await new Promise((resolve) => db.get('SELECT turn_number FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [gameId], (e, r) => resolve(r?.turn_number || 1)));
        // Validate caster ownership
        const caster = await new Promise((resolve) => db.get('SELECT id, owner_id, sector_id, x, y, meta FROM sector_objects WHERE id = ?', [casterId], (err, row) => resolve(row)));
        if (!caster) return { success: false, httpStatus: 404, error: 'Caster not found' };
        // Basic target validation
        if (ability.type === 'offense' && !targetObjectId) return { success: false, httpStatus: 400, error: 'Offensive abilities require a target object' };
        if (ability.target === 'position' && (typeof targetX !== 'number' || typeof targetY !== 'number')) return { success: false, httpStatus: 400, error: 'Position target required' };
        if ((ability.target === 'ally' || ability.target === 'enemy') && !targetObjectId) return { success: false, httpStatus: 400, error: 'Target object required' };
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


