const dbDefault = require('../../db');

const query = (db, method, sql, params = []) => new Promise((resolve, reject) => {
    if (method === 'run') {
        db.run(sql, params, function (err) { return err ? reject(err) : resolve(this); });
    } else {
        db[method](sql, params, (err, value) => err ? reject(err) : resolve(value));
    }
});

// Policy definitions are intentionally declarative. The policy service is the
// single authority for requirements, status derivation, and effect metadata;
// consumers decide how to present or apply the declared effects.
const POLICY_DEFINITIONS = [
    {
        key: 'centralized_command', title: 'Centralized Command',
        description: 'A stronger administrative chain improves coordination across the domain.',
        category: 'central_administration', requiredMandate: { Centralist: 7.5 },
        effect: { key: 'administration', modifiers: {}, metadata: { coordination: 0.05 } },
        tradeoff: { key: 'local_autonomy', value: 'reduced' }, duration: { type: 'indefinite' },
        invalidation: { behavior: 'suspend_effects_keep_selected' }
    },
    {
        key: 'industrial_charter', title: 'Industrial Charter',
        description: 'Grant productive stations a formal mandate to expand ship and infrastructure output.',
        category: 'industry', requiredMandate: { Industrialist: 10 },
        effect: { key: 'production', modifiers: { harvestYieldMultiplier: 0.10 }, metadata: {} },
        tradeoff: { key: 'environmental_pressure', value: 'increased' }, duration: { type: 'indefinite' },
        invalidation: { behavior: 'suspend_effects_keep_selected' }
    },
    {
        key: 'technocratic_works', title: 'Technocratic Works',
        description: 'Prioritize technical expertise in construction, logistics, and fleet operations.',
        category: 'technology', requiredMandate: { Technocrat: 10 },
        effect: { key: 'build_efficiency', modifiers: { shipBuildTimeReduction: 1 }, metadata: {} },
        tradeoff: { key: 'political_complexity', value: 'increased' }, duration: { type: 'indefinite' },
        invalidation: { behavior: 'suspend_effects_keep_selected' }
    },
    {
        key: 'frontier_network', title: 'Frontier Network',
        description: 'Recognize moon stations and forward operators as a unified frontier service.',
        category: 'frontier_security', requiredMandate: { Security: 10 },
        effect: { key: 'frontier_operations', modifiers: {}, metadata: { frontierSupport: 0.05 } },
        tradeoff: { key: 'central_cost', value: 'increased' }, duration: { type: 'indefinite' },
        invalidation: { behavior: 'suspend_effects_keep_selected' }
    },
    {
        key: 'open_exchange', title: 'Open Exchange',
        description: 'Protect trade routes and encourage commercial movement between regional stations.',
        category: 'trade', requiredMandate: { 'Trade Magnate': 10 },
        effect: { key: 'trade', modifiers: {}, metadata: { tradeAccess: 0.05 } },
        tradeoff: { key: 'security_exposure', value: 'increased' }, duration: { type: 'indefinite' },
        invalidation: { behavior: 'suspend_effects_keep_selected' }
    },
    {
        key: 'regional_compacts', title: 'Regional Compacts',
        description: 'Formalize cooperation between stations that share a regional interest.',
        category: 'regional_cooperation', requiredMandate: { Humanist: 10, Ecologist: 10 },
        effect: { key: 'regional_health', modifiers: {}, metadata: { cooperation: 0.05 } },
        tradeoff: { key: 'decision_latency', value: 'increased' }, duration: { type: 'indefinite' },
        invalidation: { behavior: 'suspend_effects_keep_selected' }
    }
];

function unmetRequirements(policy, mandate = {}) {
    const unmet = [];
    for (const [tag, minimum] of Object.entries(policy.requiredMandate || {})) {
        const actual = Number(mandate[tag] || 0);
        if (actual < Number(minimum)) unmet.push({ type: 'mandate', tag, required: Number(minimum), actual });
    }
    return unmet;
}

function evaluatePolicy(policy, { mandate = {}, selected = false, activatedTurn = null } = {}) {
    const unmet = unmetRequirements(policy, mandate);
    const eligible = unmet.length === 0;
    const status = selected ? (eligible ? 'active' : 'at_risk') : (eligible ? 'eligible' : 'locked');
    return {
        ...policy,
        selected,
        active: selected,
        status,
        eligible,
        effectsActive: status === 'active',
        activatedTurn: activatedTurn == null ? null : Number(activatedTurn),
        unmetRequirements: unmet
    };
}

async function getPolicyEvaluation(gameId, userId, db = dbDefault, suppliedMandate = null) {
    const mandateRows = suppliedMandate ? null : await query(db, 'all', 'SELECT tag,value FROM player_tag_mandate WHERE game_id=? AND user_id=?', [gameId, userId]);
    const mandate = suppliedMandate || Object.fromEntries(mandateRows.map(row => [row.tag, Number(row.value || 0)]));
    const selectedRows = await query(db, 'all', `
        SELECT active.policy_key,active.activated_turn,
               (SELECT MAX(history.id) FROM player_policy_history history
                WHERE history.game_id=active.game_id AND history.user_id=active.user_id
                  AND history.policy_key=active.policy_key AND history.event_type='activation') AS activation_order
        FROM player_active_policies active
        WHERE active.game_id=? AND active.user_id=? AND active.active=1`, [gameId, userId]);
    const capacityRow = await query(db, 'get', 'SELECT policy_slots FROM player_political_state WHERE game_id=? AND user_id=?', [gameId, userId]);
    const policySlots = Math.max(1, Number(capacityRow?.policy_slots || 1));
    const selected = new Map(selectedRows.map(row => [row.policy_key, row]));
    const definitionOrder = new Map(POLICY_DEFINITIONS.map((policy, index) => [policy.key, index]));
    const withinCapacity = new Set([...selectedRows]
        .sort((left, right) => Number(left.activated_turn) - Number(right.activated_turn)
            || Number(left.activation_order || Number.MAX_SAFE_INTEGER) - Number(right.activation_order || Number.MAX_SAFE_INTEGER)
            || Number(definitionOrder.get(left.policy_key) ?? Number.MAX_SAFE_INTEGER) - Number(definitionOrder.get(right.policy_key) ?? Number.MAX_SAFE_INTEGER))
        .slice(0, policySlots)
        .map(row => row.policy_key));
    return POLICY_DEFINITIONS.map(policy => {
        const evaluation = evaluatePolicy(policy, {
            mandate, selected: selected.has(policy.key), activatedTurn: selected.get(policy.key)?.activated_turn
        });
        if (!evaluation.selected || withinCapacity.has(policy.key)) return { ...evaluation, capacityEligible: true };
        return {
            ...evaluation,
            status: 'at_risk',
            effectsActive: false,
            capacityEligible: false,
            unmetRequirements: [...evaluation.unmetRequirements, { type: 'capacity', actual: policySlots, required: selectedRows.length }]
        };
    });
}

async function getActivePolicyModifiers(gameId, userId, db = dbDefault) {
    const evaluated = await getPolicyEvaluation(gameId, userId, db);
    return evaluated.filter(policy => policy.status === 'active').reduce((modifiers, policy) => {
        for (const [key, value] of Object.entries(policy.effect?.modifiers || {})) modifiers[key] = (modifiers[key] || 0) + Number(value || 0);
        return modifiers;
    }, {});
}

module.exports = { POLICY_DEFINITIONS, evaluatePolicy, getPolicyEvaluation, getActivePolicyModifiers, unmetRequirements };
