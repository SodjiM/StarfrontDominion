const physicalScale = require('../../../client/utils/physical-scale');
const { z } = require('zod');
const { NavigationService } = require('./navigation.service');
const { LaneTravelService } = require('./lane-travel.service');
const { HarvestingManager } = require('../world/harvesting-manager');
const { Abilities } = require('../registry/abilities');
const { SHIP_BLUEPRINTS } = require('../registry/blueprints');

function json(value) {
    try { return value ? JSON.parse(value) : {}; } catch { return {}; }
}

function makeActionRegistry({ db }) {
    const actions = new Map();
    const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (e, r) => e ? reject(e) : resolve(r || null)));
    const all = (sql, args = []) => new Promise((resolve, reject) => db.all(sql, args, (e, r) => e ? reject(e) : resolve(r || [])));

    const register = definition => {
        if (!definition?.type || typeof definition.execute !== 'function') throw new Error('Invalid action definition');
        actions.set(definition.type, definition);
        return definition;
    };

    const movePayload = z.object({
        destination: z.object({ x: z.number().int(), y: z.number().int() })
    });
    const harvestStartPayload = z.object({ nodeId: z.number().int().positive() });
    const abilityPayload = z.object({
        abilityKey: z.string().min(1),
        targetObjectId: z.number().int().positive().optional(),
        target: z.object({ x: z.number(), y: z.number() }).optional(),
        params: z.record(z.any()).optional()
    }).superRefine((value, ctx) => {
        if (!Abilities[value.abilityKey]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['abilityKey'], message: 'unknown ability' });
    });

    register({
        type: 'movement.move',
        version: 1,
        label: 'Move',
        requiredCapabilities: ['movement'],
        locks: ['locomotion'],
        payloadSchema: movePayload,
        summarize: payload => `Move to (${payload.destination.x}, ${payload.destination.y})`,
        async preview(ctx, payload) {
            const path = await new NavigationService(db).route(ctx.ship, payload.destination);
            if (!path || path.length <= 1) return { valid: false, reason: 'no_route_to_destination' };
            const speed = Math.max(1, Number(json(ctx.ship.meta).movementSpeed) || 1);
            return { valid: true, path, estimatedTurns: Math.ceil((path.length - 1) / speed) };
        },
        async execute(ctx, payload) {
            const result = await new NavigationService(db).order(ctx.ship.id, payload.destination, { gameId: ctx.gameId });
            return { outcome: 'completed', result };
        }
    });

    register({
        type: 'harvest.start',
        version: 1,
        label: 'Start mining',
        requiredCapabilities: ['harvesting'],
        locks: ['harvesting'],
        payloadSchema: harvestStartPayload,
        summarize: payload => `Start mining node ${payload.nodeId}`,
        async execute(ctx, payload) {
            const result = await HarvestingManager.startHarvesting(ctx.ship.id, payload.nodeId, ctx.turnNumber);
            return result?.success
                ? { outcome: 'completed', result }
                : { outcome: 'failed', reason: result?.error || 'harvest_start_failed' };
        }
    });

    register({
        type: 'harvest.stop',
        version: 1,
        label: 'Stop mining',
        requiredCapabilities: ['harvesting'],
        interrupts: ['harvesting'],
        payloadSchema: z.object({}),
        summarize: () => 'Stop mining',
        async execute(ctx) {
            await HarvestingManager.stopHarvesting(ctx.ship.id);
            return { outcome: 'completed' };
        }
    });

    register({
        type: 'combat.ability',
        version: 1,
        label: 'Use ability',
        requiredCapabilities: ['abilities'],
        locks: ['weapons'],
        payloadSchema: abilityPayload,
        summarize: payload => `Use ${payload.abilityKey}`,
        async execute(ctx, payload) {
            const ability = Abilities[payload.abilityKey];
            if (!ability) return { outcome: 'failed', reason: 'unknown_ability' };

            let target = null;
            if (payload.targetObjectId) {
                target = await get('SELECT * FROM sector_objects WHERE id = ?', [payload.targetObjectId]);
                if (!target || Number(target.sector_id) !== Number(ctx.ship.sector_id)) {
                    return { outcome: 'failed', reason: 'target_not_in_sector', cancelFollowing: true };
                }
                if (ability.range) {
                    const distance = physicalScale.gap(ctx.ship,target);
                    if (distance > Number(ability.range)) return { outcome: 'waiting', reason: 'target_out_of_range', retryTurn: ctx.turnNumber + 1 };
                }
            }

            await new Promise((resolve, reject) => db.run(
                `INSERT INTO ability_orders (game_id, turn_number, caster_id, ability_key, target_object_id, target_x, target_y, params, source_queue_order_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [ctx.gameId, ctx.turnNumber, ctx.ship.id, payload.abilityKey, payload.targetObjectId || null,
                    payload.target?.x ?? null, payload.target?.y ?? null, payload.params ? JSON.stringify(payload.params) : null,
                    ctx.order.id, new Date().toISOString()],
                e => e ? reject(e) : resolve()
            ));
            return { outcome: 'completed' };
        }
    });

    register({
        type: 'warp.lane',
        version: 1,
        label: 'Warp lane travel',
        requiredCapabilities: ['warp'],
        locks: ['locomotion', 'warp'],
        payloadSchema: z.object({
            sectorId: z.number().int().positive(),
            legs: z.array(z.record(z.any())).min(1).max(64),
            destination: z.object({ x: z.number().int(), y: z.number().int() })
        }),
        summarize: payload => `Warp to (${payload.destination.x}, ${payload.destination.y})`,
        async execute(ctx, payload) {
            try {
                const result = await new LaneTravelService(db).confirm(ctx.ship.id, payload.sectorId, payload.legs, payload.destination, ctx.turnNumber);
                return result?.success ? { outcome: 'completed', result } : { outcome: 'failed', reason: 'warp_route_rejected' };
            } catch (e) {
                return { outcome: 'failed', reason: e?.message || 'warp_route_rejected' };
            }
        }
    });

    // Legacy rows are deliberately handled as visible failures instead of being silently discarded.
    for (const type of ['warp', 'travel_start']) register({
        type,
        version: 1,
        label: type === 'warp' ? 'Warp' : 'Start travel',
        payloadSchema: z.record(z.any()),
        async execute() { return { outcome: 'failed', reason: 'legacy_action_requires_lane_travel' }; }
    });

    return {
        register,
        get: type => actions.get({ move: 'movement.move', harvest_start: 'harvest.start', harvest_stop: 'harvest.stop', ability: 'combat.ability' }[type] || type),
        list: () => [...actions.values()].map(({ payloadSchema, execute, ...publicDefinition }) => publicDefinition),
        validate(definition, payload) {
            if (!definition?.payloadSchema) return { success: true, data: payload || {} };
            return definition.payloadSchema.safeParse(payload || {});
        },
        async getShipCapabilities(ship) {
            const meta = json(ship.meta);
            const blueprint = meta.blueprintId ? SHIP_BLUEPRINTS.find(bp => bp.id === meta.blueprintId) : null;
            const abilities = Array.isArray(meta.abilities) ? meta.abilities : (blueprint?.abilities || []);
            const capabilities = new Set();
            if (Number(meta.movementSpeed ?? blueprint?.movementSpeed ?? 0) > 0) capabilities.add('movement');
            if (Number(meta.warpSpeed ?? meta.warpSpeedMultiplier ?? blueprint?.warpSpeed ?? 0) > 0) capabilities.add('warp');
            if (meta.canHarvest === true || Number(meta.harvestRate ?? blueprint?.harvestRate ?? 0) > 0 || abilities.some(key => ['rotary_mining_lasers', 'prospector_microlasers'].includes(key))) capabilities.add('harvesting');
            if (abilities.some(key => Abilities[key])) capabilities.add('abilities');
            if (abilities.some(key => Abilities[key]?.type === 'offense')) capabilities.add('combat');
            return capabilities;
        },
        async listForShip(ship) {
            const capabilities = await this.getShipCapabilities(ship);
            return this.list().filter(action => (action.requiredCapabilities || []).every(cap => capabilities.has(cap)));
        }
    };
}

module.exports = { makeActionRegistry };
