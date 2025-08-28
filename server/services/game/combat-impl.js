const db = require('../../db');
const CombatConfig = require('./combat-config');
const { Abilities } = require('../registry/abilities');
const { CargoManager } = require('./cargo-manager');
const { SHIP_BLUEPRINTS, computeAllRequirements } = require('../registry/blueprints');
const { CombatRepository } = require('../../repositories/combat.repo');
const { computePathBresenham } = require('../../utils/path');
const { HarvestingManager } = require('../world/harvesting-manager');

async function processAbilityOrders(gameId, turnNumber) {
    const combatRepo = new CombatRepository();
    const orders = await new Promise((resolve, reject) => {
        db.all(
            `SELECT ao.* FROM ability_orders ao
             JOIN sector_objects so ON so.id = ao.caster_id
             JOIN sectors s ON s.id = so.sector_id
             WHERE s.game_id = ? AND ao.turn_number = ?
             AND ao.created_at = (
               SELECT MAX(created_at) FROM ability_orders ao2 WHERE ao2.caster_id = ao.caster_id AND ao2.turn_number = ao.turn_number AND ao2.game_id = ao.game_id
             )`,
            [gameId, turnNumber],
            (err, rows) => err ? reject(err) : resolve(rows || [])
        );
    });
    const utilityOrders = [];
    const offenseOrders = [];
    for (const o of orders) {
        const ab = Abilities[o.ability_key];
        if (!ab) continue;
        if (ab.type === 'offense') offenseOrders.push(o); else utilityOrders.push(o);
    }
    // Utility phase
    for (const order of utilityOrders) {
        const ability = Abilities[order.ability_key];
        if (!ability) continue;
        const cdRow = await combatRepo.getAbilityCooldown(order.caster_id, order.ability_key);
        if (cdRow && Number(cdRow.available_turn) > Number(turnNumber)) continue;
        let target = null;
        if (order.target_object_id) {
            target = await new Promise((resolve) => db.get('SELECT id, sector_id, x, y FROM sector_objects WHERE id = ?', [order.target_object_id], (e, r) => resolve(r)));
        }
        const caster = await new Promise((resolve) => db.get('SELECT id, sector_id, x, y FROM sector_objects WHERE id = ?', [order.caster_id], (e, r) => resolve(r)));
        if (!caster) continue;
        if (target && caster.sector_id !== target.sector_id) continue;
        if (ability.range && target) {
            const dx = (caster.x || 0) - (target.x || 0);
            const dy = (caster.y || 0) - (target.y || 0);
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist > ability.range) continue;
        }
        if (ability.type !== 'passive' && ability.energyCost) {
            const casterMetaRow = await new Promise((resolve) => db.get('SELECT meta FROM sector_objects WHERE id = ?', [order.caster_id], (e, r) => resolve(r)));
            if (!casterMetaRow) continue;
            const metaObj = JSON.parse(casterMetaRow.meta || '{}');
            const currentEnergy = Number(metaObj.energy || 0);
            if (currentEnergy < ability.energyCost) {
                await combatRepo.appendCombatLog({
                    gameId,
                    turnNumber,
                    attackerId: order.caster_id,
                    eventType: 'ability',
                    summary: `Not enough energy for ${order.ability_key}`,
                    data: { needed: ability.energyCost, have: currentEnergy }
                });
                continue;
            }
            const cap = (typeof metaObj.maxEnergy === 'number') ? Number(metaObj.maxEnergy) : undefined;
            const post = Math.max(0, currentEnergy - ability.energyCost);
            metaObj.energy = cap != null ? Math.min(cap, post) : post;
            await new Promise((resolve) => db.run('UPDATE sector_objects SET meta = ?, updated_at = ? WHERE id = ?', [JSON.stringify(metaObj), new Date().toISOString(), order.caster_id], () => resolve()));
        }
        {
            // Mining toggle: start or stop
            if (ability.mining) {
                try {
                    // Is currently harvesting?
                    const activeTask = await new Promise((resolve) => db.get(
                        `SELECT id, resource_node_id FROM harvesting_tasks WHERE ship_id = ? AND status = 'active'`,
                        [order.caster_id],
                        (e, r) => resolve(r)
                    ));
                    const stopRequested = (() => { try { const p = order.params ? JSON.parse(order.params) : null; return p && p.stop === true; } catch { return false; } })();
                    if (activeTask && (stopRequested || !order.target_object_id)) {
                        await HarvestingManager.stopHarvesting(order.caster_id);
                        await new Promise((resolve) => db.run(`DELETE FROM ship_status_effects WHERE ship_id = ? AND effect_key = 'mining_active'`, [order.caster_id], () => resolve()));
                        const availableTurn = Number(turnNumber) + (ability.cooldown || 1);
                        await combatRepo.setAbilityCooldown(order.caster_id, order.ability_key, availableTurn);
                        await combatRepo.appendCombatLog({
                            gameId,
                            turnNumber,
                            attackerId: order.caster_id,
                            eventType: 'ability',
                            summary: `Stopped mining`
                        });
                        continue;
                    }

                    // Determine nodeId to mine
                    let nodeId = null;
                    try { const p = order.params ? JSON.parse(order.params) : null; if (p && p.nodeId) nodeId = Number(p.nodeId); } catch {}
                    if (!nodeId && order.target_object_id) nodeId = Number(order.target_object_id);

                    // If not specified, try to auto-select if exactly one in range
                    if (!nodeId) {
                        const nearby = await HarvestingManager.getNearbyResourceNodes(order.caster_id, ability.range || 3);
                        if (!Array.isArray(nearby) || nearby.length === 0) {
                            await combatRepo.appendCombatLog({ gameId, turnNumber, attackerId: order.caster_id, eventType: 'ability', summary: 'No resource nodes in range' });
                            continue;
                        }
                        if (nearby.length > 1) {
                            await combatRepo.appendCombatLog({ gameId, turnNumber, attackerId: order.caster_id, eventType: 'ability', summary: 'Multiple nodes in range — select one' });
                            continue;
                        }
                        nodeId = nearby[0].id;
                    }

                    // Validate distance
                    const casterPos = await new Promise((resolve) => db.get('SELECT sector_id, x, y FROM sector_objects WHERE id = ?', [order.caster_id], (e, r) => resolve(r)));
                    const nodePos = await new Promise((resolve) => db.get('SELECT sector_id, x, y, is_depleted FROM resource_nodes WHERE id = ?', [nodeId], (e, r) => resolve(r)));
                    if (!casterPos || !nodePos || casterPos.sector_id !== nodePos.sector_id || nodePos.is_depleted) continue;
                    const dx = Math.abs((casterPos.x||0) - (nodePos.x||0));
                    const dy = Math.abs((casterPos.y||0) - (nodePos.y||0));
                    const cheb = Math.max(dx, dy);
                    if ((ability.range || 1) < cheb) {
                        await combatRepo.appendCombatLog({ gameId, turnNumber, attackerId: order.caster_id, eventType: 'ability', summary: 'Target node out of range' });
                        continue;
                    }

                    // Start harvesting and apply persistent mining status
                    const cfg = ability.mining || {};
                    await HarvestingManager.startHarvesting(order.caster_id, nodeId, turnNumber, cfg.baseRate || 1);
                    const effectData = {
                        baseRate: Number(cfg.baseRate || 1),
                        incrementPerTurn: Number(cfg.incrementPerTurn || 0),
                        maxBonus: Number(cfg.maxBonus || 0),
                        energyPerTurn: Number(cfg.energyPerTurn || 0)
                    };
                    await combatRepo.applyStatusEffect({
                        shipId: order.caster_id,
                        effectKey: 'mining_active',
                        magnitude: null,
                        effectData,
                        sourceObjectId: order.caster_id,
                        appliedTurn: turnNumber,
                        expiresTurn: null
                    });
                    const availableTurn = Number(turnNumber) + (ability.cooldown || 1);
                    await combatRepo.setAbilityCooldown(order.caster_id, order.ability_key, availableTurn);
                    await combatRepo.appendCombatLog({
                        gameId,
                        turnNumber,
                        attackerId: order.caster_id,
                        eventType: 'ability',
                        summary: `Mining started`
                    });
                    continue;
                } catch {}
            }

            // Non-offense special cases and status effects (subset from index.js for now)
            if (order.ability_key === 'strike_vector') {
                const casterFull = await new Promise((resolve) => db.get('SELECT id, sector_id, x, y FROM sector_objects WHERE id = ?', [order.caster_id], (e, r) => resolve(r)));
                if (casterFull) {
                    const abilityRange = ability.range || 3;
                    const tx = Math.round(order.target_x || 0);
                    const ty = Math.round(order.target_y || 0);
                    const dx = (casterFull.x || 0) - tx;
                    const dy = (casterFull.y || 0) - ty;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    if (dist <= abilityRange) {
                        const blocked = await new Promise((resolve) => db.get(
                            `SELECT 1 FROM ship_status_effects WHERE ship_id = ? AND effect_key IN ('tractored','rooted') AND (expires_turn IS NULL OR expires_turn >= ?) LIMIT 1`,
                            [order.caster_id, turnNumber],
                            (e, r) => resolve(!!r)
                        ));
                        if (!blocked) {
                            const occupied = await new Promise((resolve) => db.get('SELECT 1 FROM sector_objects WHERE sector_id = ? AND x = ? AND y = ? LIMIT 1', [casterFull.sector_id, tx, ty], (e, r) => resolve(!!r)));
                            if (!occupied) {
                                await new Promise((resolve) => db.run('UPDATE sector_objects SET x = ?, y = ?, updated_at = ? WHERE id = ?', [tx, ty, new Date().toISOString(), order.caster_id], () => resolve()));
                                const move = await new Promise((resolve) => db.get(`SELECT * FROM movement_orders WHERE object_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`, [order.caster_id], (e, r) => resolve(r)));
                                if (move && typeof move.destination_x === 'number' && typeof move.destination_y === 'number') {
                                    const path = computePathBresenham(tx, ty, move.destination_x, move.destination_y);
                                    const movementSpeed = move.movement_speed || 1;
                                    const eta = Math.ceil(Math.max(0, path.length - 1) / Math.max(1, movementSpeed));
                                    await new Promise((resolve) => db.run('UPDATE movement_orders SET movement_path = ?, current_step = 0, eta_turns = ? WHERE id = ?', [JSON.stringify(path), eta, move.id], () => resolve()));
                                }
                                const availableTurn = Number(turnNumber) + (ability.cooldown || 3);
                                await combatRepo.setAbilityCooldown(order.caster_id, order.ability_key, availableTurn);
                                await combatRepo.appendCombatLog({
                                    gameId,
                                    turnNumber,
                                    attackerId: order.caster_id,
                                    eventType: 'ability',
                                    summary: `Strike Vector: repositioned to (${tx},${ty})`,
                                    data: { x: tx, y: ty }
                                });
                                continue;
                            }
                        }
                        const availableTurn = Number(turnNumber) + (ability.cooldown || 3);
                        await combatRepo.setAbilityCooldown(order.caster_id, order.ability_key, availableTurn);
                        await combatRepo.appendCombatLog({
                            gameId,
                            turnNumber,
                            attackerId: order.caster_id,
                            eventType: 'ability',
                            summary: 'Strike Vector failed (blocked/occupied/out-of-range)'
                        });
                        continue;
                    }
                }
            }
            // Default: apply status effects and set cooldown (subset)
            const effectTargetId = order.target_object_id || order.caster_id;
            const effectData = {};
            if (ability.penaltyReduction) effectData.penaltyReduction = ability.penaltyReduction;
            if (ability.selfPenaltyReduction) effectData.selfPenaltyReduction = ability.selfPenaltyReduction;
            if (ability.ignoreSizePenalty) effectData.ignoreSizePenalty = true;
            if (ability.damageReduction) effectData.damageReduction = ability.damageReduction;
            if (ability.auraRange) effectData.auraRange = ability.auraRange;
            if (ability.movementBonus) effectData.movementBonus = ability.movementBonus;
            if (ability.healPercentPerTurn) effectData.healPercentPerTurn = ability.healPercentPerTurn;
            if (ability.scanRangeMultiplier) effectData.scanRangeMultiplier = ability.scanRangeMultiplier;
            if (ability.effectKey) {
                await combatRepo.applyStatusEffect({
                    shipId: effectTargetId,
                    effectKey: ability.effectKey,
                    magnitude: 1,
                    effectData,
                    sourceObjectId: order.caster_id,
                    appliedTurn: turnNumber,
                    expiresTurn: turnNumber + (ability.duration || 1)
                });
            }
            const availableTurn = Number(turnNumber) + (ability.cooldown || 1);
            await combatRepo.setAbilityCooldown(order.caster_id, order.ability_key, availableTurn);
            await combatRepo.appendCombatLog({
                gameId,
                turnNumber,
                attackerId: order.caster_id,
                targetId: effectTargetId,
                eventType: 'ability',
                summary: `${order.ability_key} applied`,
                data: { abilityKey: order.ability_key }
            });
        }
    }
    // Offense phase
    for (const order of offenseOrders) {
        const ability = Abilities[order.ability_key];
        if (!ability) continue;
        const cdRow = await combatRepo.getAbilityCooldown(order.caster_id, order.ability_key);
        if (cdRow && Number(cdRow.available_turn) > Number(turnNumber)) continue;
        if (!order.target_object_id) continue;
        const target = await new Promise((resolve) => db.get('SELECT id, sector_id, x, y FROM sector_objects WHERE id = ?', [order.target_object_id], (e, r) => resolve(r)));
        const caster = await new Promise((resolve) => db.get('SELECT id, sector_id, x, y FROM sector_objects WHERE id = ?', [order.caster_id], (e, r) => resolve(r)));
        if (!caster || !target) continue;
        if (caster.sector_id !== target.sector_id) continue;
        if (ability.range) {
            const dx = (caster.x || 0) - (target.x || 0);
            const dy = (caster.y || 0) - (target.y || 0);
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist > ability.range) continue;
        }
        await combatRepo.upsertCombatOrder({
            gameId,
            turnNumber,
            attackerId: order.caster_id,
            targetId: order.target_object_id,
            weaponKey: order.ability_key,
            desiredRange: null
        });
        const availableTurn = Number(turnNumber) + (ability.cooldown || 1);
        await combatRepo.setAbilityCooldown(order.caster_id, order.ability_key, availableTurn);
        await combatRepo.appendCombatLog({
            gameId,
            turnNumber,
            attackerId: order.caster_id,
            targetId: order.target_object_id,
            eventType: 'attack',
            summary: `${order.ability_key} queued`,
            data: { weaponKey: order.ability_key }
        });
    }
}

async function processCombatOrders(gameId, turnNumber) {
    const combatRepo = new CombatRepository();
    const orders = await new Promise((resolve, reject) => {
        db.all(
            `SELECT co.* FROM combat_orders co
             JOIN sector_objects a ON a.id = co.attacker_id
             JOIN sector_objects t ON t.id = co.target_id
             JOIN sectors s ON s.id = a.sector_id
             WHERE s.game_id = ? AND co.turn_number = ?
             AND co.created_at = (
               SELECT MAX(created_at) FROM combat_orders co2 WHERE co2.attacker_id = co.attacker_id AND co2.turn_number = co.turn_number AND co2.game_id = co.game_id
             )`,
            [gameId, turnNumber],
            (err, rows) => err ? reject(err) : resolve(rows || [])
        );
    });
    for (const order of orders) {
        const attacker = await new Promise((resolve) => db.get('SELECT id, x, y, meta FROM sector_objects WHERE id = ?', [order.attacker_id], (e, r) => resolve(r)));
        const target = await new Promise((resolve) => db.get('SELECT id, x, y, meta FROM sector_objects WHERE id = ?', [order.target_id], (e, r) => resolve(r)));
        if (!attacker || !target) continue;
        const aMeta = JSON.parse(attacker.meta || '{}');
        const tMeta = JSON.parse(target.meta || '{}');
        const distance = Math.hypot((attacker.x||0)-(target.x||0), (attacker.y||0)-(target.y||0));
        const AB = Abilities;
        let weapon = null;
        let weaponKey = null;
        if (order.weapon_key && AB[order.weapon_key] && AB[order.weapon_key].type === 'offense') {
            weaponKey = order.weapon_key;
            weapon = AB[weaponKey];
        } else {
            await combatRepo.appendCombatLog({
                gameId,
                turnNumber,
                attackerId: attacker.id,
                targetId: target.id,
                eventType: 'attack',
                summary: 'No offensive ability queued'
            });
            continue;
        }
        if (weapon.range && distance > weapon.range) {
            await combatRepo.appendCombatLog({
                gameId,
                turnNumber,
                attackerId: attacker.id,
                targetId: target.id,
                eventType: 'attack',
                summary: `Target out of range for ${weaponKey}`,
                data: { weaponKey, distance, maxRange: weapon.range }
            });
            continue;
        }
        const rangeMult = CombatConfig.computeRangeMultiplier(distance, weapon.optimal || 1, weapon.falloff || 0.15);
        const effects = await new Promise((resolve) => db.all('SELECT * FROM ship_status_effects WHERE ship_id IN (?, ?) AND (expires_turn IS NULL OR expires_turn >= ?)', [target.id, attacker.id, turnNumber], (e, rows) => resolve(rows || [])));
        const effectCtx = { weaponTags: new Set(weapon.tags || []) };
        for (const eff of effects) {
            try {
                const data = eff.effect_data ? JSON.parse(eff.effect_data) : {};
                if (eff.ship_id === target.id) {
                    if (data.ignoreSizePenalty) effectCtx.ignoreSizePenalty = true;
                    if (typeof data.penaltyReduction === 'number') effectCtx.penaltyReduction = Math.max(effectCtx.penaltyReduction || 0, data.penaltyReduction);
                }
                if (eff.ship_id === attacker.id) {
                    if (typeof data.selfPenaltyReduction === 'number') effectCtx.penaltyReduction = Math.max(effectCtx.penaltyReduction || 0, data.selfPenaltyReduction);
                }
            } catch {}
        }
        const sizeMult = CombatConfig.computeSizePenalty(aMeta.class, tMeta.class, effectCtx);
        let evasionTotal = 0;
        for (const eff of effects) {
            try {
                const data = eff.effect_data ? JSON.parse(eff.effect_data) : {};
                if (eff.ship_id === target.id && typeof data.evasionBonus === 'number') {
                    evasionTotal += data.evasionBonus;
                }
            } catch {}
        }
        if (typeof tMeta.evasionBonus === 'number') {
            evasionTotal += tMeta.evasionBonus;
        }
        evasionTotal = Math.max(0, Math.min(0.9, evasionTotal));
        const targetAbilities = Array.isArray(tMeta.abilities) ? tMeta.abilities : [];
        let baseDamage = weapon.baseDamage || 0;
        const isPD = (weapon.tags || []).includes('pd');
        const targetIsSmall = (tMeta.class === 'frigate');
        if (isPD && !targetIsSmall) {
            baseDamage = Math.floor(baseDamage * 0.2);
        }
        const hitMultiplier = Math.max(0, 1 - evasionTotal);
        let damage = Math.max(0, Math.round(baseDamage * rangeMult * sizeMult * hitMultiplier));
        if (targetAbilities.includes('duct_tape_resilience') && tMeta.hp === tMeta.maxHp && !tMeta._resilienceConsumed) {
            damage = Math.floor(damage * 0.75);
            tMeta._resilienceConsumed = true;
        }
        if (damage <= 0) {
            await combatRepo.appendCombatLog({
                gameId,
                turnNumber,
                attackerId: attacker.id,
                targetId: target.id,
                eventType: 'attack',
                summary: `Attack with ${weaponKey} missed/ineffective`,
                data: { weaponKey, distance, rangeMult, sizeMult, evasionTotal, hitMultiplier }
            });
            continue;
        }
        const targetHp = typeof tMeta.hp === 'number' ? tMeta.hp : 1;
        const newHp = targetHp - damage;
        tMeta.hp = newHp;
        await new Promise((resolve) => db.run('UPDATE sector_objects SET meta = ?, updated_at = ? WHERE id = ?', [JSON.stringify(tMeta), new Date().toISOString(), target.id], () => resolve()));
        try {
            const weap = Abilities[weaponKey];
            if (weap && weap.onHitStatus && damage > 0) {
                const status = weap.onHitStatus;
                const effData = {};
                if (typeof status.magnitude === 'number') effData.magnitude = status.magnitude;
                await combatRepo.applyStatusEffect({
                    shipId: target.id,
                    effectKey: status.effectKey,
                    magnitude: status.magnitude || null,
                    effectData: effData,
                    sourceObjectId: attacker.id,
                    appliedTurn: turnNumber,
                    expiresTurn: Number(turnNumber) + (status.duration || 1)
                });
                await combatRepo.appendCombatLog({
                    gameId,
                    turnNumber,
                    attackerId: attacker.id,
                    targetId: target.id,
                    eventType: 'status',
                    summary: `Applied ${status.effectKey}`,
                    data: { duration: status.duration || 1, magnitude: status.magnitude }
                });
            }
        } catch {}
        await combatRepo.appendCombatLog({
            gameId,
            turnNumber,
            attackerId: attacker.id,
            targetId: target.id,
            eventType: 'attack',
            summary: `Hit for ${damage}`,
            data: { weaponKey, distance, rangeMult, sizeMult, evasionTotal, hitMultiplier }
        });
        if (newHp <= 0) {
            await combatRepo.clearStatusEffectsForShip(target.id);
            const wreckMeta = { name: (tMeta.name || 'Wreck'), type: 'wreck', decayTurn: Number(turnNumber) + 7 };
            await new Promise((resolve) => db.run('UPDATE sector_objects SET type = ?, meta = ?, updated_at = ? WHERE id = ?', ['wreck', JSON.stringify(wreckMeta), new Date().toISOString(), target.id], () => resolve()));
            try {
                const pilotCost = Number(tMeta.pilotCost || 1);
                const gameIdRow = await new Promise((resolve) => db.get('SELECT game_id FROM sectors WHERE id = (SELECT sector_id FROM sector_objects WHERE id = ?)', [target.id], (e, r) => resolve(r)));
                const gid = gameIdRow?.game_id;
                if (gid && target.owner_id) {
                    await new Promise((resolve) => db.run('INSERT INTO dead_pilots_queue (game_id, user_id, count, respawn_turn) VALUES (?, ?, ?, ?)', [gid, target.owner_id, Math.max(1, pilotCost), Number(turnNumber) + 10], () => resolve()));
                }
            } catch {}
            try {
                const shipCargo = await CargoManager.getShipCargo(target.id);
                for (const item of shipCargo.items) {
                    const roll = 0.6 + Math.random() * 0.2;
                    const dropQty = Math.max(0, Math.floor(item.quantity * roll));
                    if (dropQty > 0) {
                        const resourceName = item.resource_name;
                        await CargoManager.removeResourceFromCargo(target.id, resourceName, dropQty, true);
                        await CargoManager.addResourceToCargo(target.id, resourceName, dropQty, false);
                    }
                }
            } catch {}
            try {
                if (tMeta?.blueprintId) {
                    const bp = (SHIP_BLUEPRINTS || []).find(b => b.id === tMeta.blueprintId) || { id: tMeta.blueprintId, class: tMeta.class, role: tMeta.role, specialized: [] };
                    const reqs = computeAllRequirements(bp);
                    const salvageMap = {};
                    for (const [name, qty] of Object.entries(reqs.core || {})) salvageMap[name] = Math.max(1, Math.floor(qty * 0.3));
                    for (const [name, qty] of Object.entries(reqs.specialized || {})) salvageMap[name] = (salvageMap[name] || 0) + Math.max(1, Math.floor(qty * 0.2));
                    for (const [resName, qty] of Object.entries(salvageMap)) await CargoManager.addResourceToCargo(target.id, resName, qty, false);
                }
            } catch {}
            await combatRepo.appendCombatLog({
                gameId,
                turnNumber,
                attackerId: attacker.id,
                targetId: target.id,
                eventType: 'kill',
                summary: 'Destroyed',
                data: { weaponKey }
            });
        }
    }
}

async function cleanupExpiredEffectsAndWrecks(gameId, turnNumber) {
    const combatRepo = new CombatRepository();
    // Remove expired effects
    await combatRepo.removeExpiredStatusEffects(turnNumber);
    // Decay wrecks
    const wrecks = await new Promise((resolve) => {
        db.all(
            `SELECT so.id, so.meta FROM sector_objects so
             JOIN sectors s ON s.id = so.sector_id
             WHERE s.game_id = ? AND so.type = 'wreck'`,
            [gameId],
            (e, rows) => resolve(rows || [])
        );
    });
    for (const w of wrecks) {
        try {
            const meta = JSON.parse(w.meta || '{}');
            if (meta.decayTurn !== undefined && Number(meta.decayTurn) <= Number(turnNumber)) {
                await new Promise((resolve) => db.run('DELETE FROM object_cargo WHERE object_id = ?', [w.id], () => resolve()));
                await new Promise((resolve) => db.run('DELETE FROM sector_objects WHERE id = ?', [w.id], () => resolve()));
                await combatRepo.appendCombatLog({
                    gameId,
                    turnNumber,
                    eventType: 'effect',
                    summary: 'Wreck decayed',
                    data: { objectId: w.id }
                });
            }
        } catch {}
    }
    // Remove empty, expired cargo cans
    const cans = await new Promise((resolve) => {
        db.all(
            `SELECT so.id, so.meta FROM sector_objects so
             JOIN sectors s ON s.id = so.sector_id
             WHERE s.game_id = ? AND so.type = 'cargo_can'`,
            [gameId],
            (e, rows) => resolve(rows || [])
        );
    });
    for (const c of cans) {
        try {
            const meta = JSON.parse(c.meta || '{}');
            const emptiesAt = Number(meta.emptiesAtTurn || 0);
            if (emptiesAt && emptiesAt <= Number(turnNumber)) {
                const cargo = await new Promise((resolve) => db.get('SELECT SUM(quantity) as q FROM object_cargo WHERE object_id = ?', [c.id], (e, r) => resolve(r?.q || 0)));
                if (!cargo || Number(cargo) === 0) {
                    await new Promise((resolve) => db.run('DELETE FROM sector_objects WHERE id = ?', [c.id], () => resolve()));
                    await combatRepo.appendCombatLog({
                        gameId,
                        turnNumber,
                        eventType: 'effect',
                        summary: 'Empty cargo can despawned',
                        data: { objectId: c.id }
                    });
                }
            }
        } catch {}
    }
}

module.exports = { processAbilityOrders, processCombatOrders, cleanupExpiredEffectsAndWrecks };


