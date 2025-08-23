const db = require('../db');

class CombatRepository {
    async getAbilityCooldown(shipId, abilityKey) {
        return new Promise((resolve) => {
            db.get(
                'SELECT available_turn FROM ability_cooldowns WHERE ship_id = ? AND ability_key = ?',
                [shipId, abilityKey],
                (e, row) => resolve(row || null)
            );
        });
    }

    async setAbilityCooldown(shipId, abilityKey, availableTurn) {
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO ability_cooldowns (ship_id, ability_key, available_turn) VALUES (?, ?, ?)
                 ON CONFLICT(ship_id, ability_key) DO UPDATE SET available_turn = excluded.available_turn`,
                [shipId, abilityKey, availableTurn],
                (err) => err ? reject(err) : resolve()
            );
        });
    }

    async upsertCombatOrder({ gameId, turnNumber, attackerId, targetId, weaponKey, desiredRange = null }) {
        await new Promise((resolve) => db.run(
            'DELETE FROM combat_orders WHERE attacker_id = ? AND game_id = ? AND turn_number = ?',
            [attackerId, gameId, turnNumber],
            () => resolve()
        ));
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO combat_orders (game_id, turn_number, attacker_id, target_id, weapon_key, desired_range, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [gameId, turnNumber, attackerId, targetId, weaponKey, desiredRange, new Date().toISOString()],
                (err) => err ? reject(err) : resolve()
            );
        });
    }

    async appendCombatLog({ gameId, turnNumber, attackerId = null, targetId = null, eventType, summary, data = null }) {
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO combat_logs (game_id, turn_number, attacker_id, target_id, event_type, summary, data)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [gameId, turnNumber, attackerId, targetId, eventType, summary, data ? JSON.stringify(data) : null],
                (err) => err ? reject(err) : resolve()
            );
        });
    }

    async applyStatusEffect({ shipId, effectKey, magnitude = null, effectData = {}, sourceObjectId = null, appliedTurn, expiresTurn }) {
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO ship_status_effects (ship_id, effect_key, magnitude, effect_data, source_object_id, applied_turn, expires_turn)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [shipId, effectKey, magnitude, JSON.stringify(effectData || {}), sourceObjectId, appliedTurn, expiresTurn],
                (err) => err ? reject(err) : resolve()
            );
        });
    }

    async clearStatusEffectsForShip(shipId) {
        return new Promise((resolve) => db.run('DELETE FROM ship_status_effects WHERE ship_id = ?', [shipId], () => resolve()));
    }

    async removeExpiredStatusEffects(beforeTurn) {
        return new Promise((resolve) => db.run('DELETE FROM ship_status_effects WHERE expires_turn IS NOT NULL AND expires_turn < ?', [beforeTurn], () => resolve()));
    }
}

module.exports = { CombatRepository };


