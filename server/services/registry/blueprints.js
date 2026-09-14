// Ship blueprints registry and requirements calculator
/**
 * @typedef {Object} ShipBlueprint
 * // Identity
 * @property {string} id
 * @property {string} name
 * @property {'frigate'|'battleship'|'capital'} class
 * @property {string} role
 * @property {string} [refinedRole]
 * @property {number} [uiOrder]
 * @property {string} [shortDescription]
 * @property {string} [longDescription]
 * // Construction/Economy
 * @property {{ core: Record<string, number>, specialized: Record<string, number> }} requirements Resource slugs, not display names
 * @property {number} [buildTimeTurns]
 * @property {number} [pilotCost]
 * @property {Record<string, number>} [upkeep]
 * @property {string[]} [prereqs]
 * @property {string[]} [stationClasses]
 * // Core stats (overrides class baselines)
 * @property {number} [maxHp]
 * @property {number} [movementSpeed]
 * @property {number} [warpSpeed]
 * @property {number} [scanRange]
 * @property {number} [cargoCapacity]
 * @property {number} [harvestRate]
 * // Energy
 * @property {number} [maxEnergy]
 * @property {number} [energyRegen]
 * // Combat/Loadout
 * @property {string[]} [abilities]
 */

/** @type {ShipBlueprint[]} */
const SHIP_BLUEPRINTS = [
    {
        id: 'explorer',
        name: 'Explorer',
        class: 'frigate',
        role: 'scout',
        refinedRole: 'pathfinder',
        uiOrder: 1,
        shortDescription: 'Fast scout with great sensors and light mining.',
        longDescription: 'A nimble exploration ship equipped with survey scanners and light microlasers. Ideal for early mapping and resource prospecting.',
        requirements: {
            core: { 'ferrite-alloy': 30, crytite: 20, vornite: 10 },
            specialized: { fluxium: 10, auralite: 6 }
        },
        buildTimeTurns: 2,
        pilotCost: 1,
        upkeep: { 'ferrite-alloy': 0, crytite: 0 },
        prereqs: [],
        stationClasses: ['sun-station', 'planet-station', 'moon-station'],
        maxHp: 40,
        movementSpeed: 4,
        warpSpeed: 3,
        scanRange: 50,
        cargoCapacity: 10,
        harvestRate: 1.0,
        maxEnergy: 10,
        energyRegen: 2,
        abilities: ['dual_light_coilguns','boost_engines','jury_rig_repair','survey_scanner','duct_tape_resilience','prospector_microlasers']
    },
    {
        id: 'needle-gunship',
        name: 'Needler Gunship',
        class: 'frigate',
        role: 'brawler',
        refinedRole: 'interceptor',
        uiOrder: 2,
        shortDescription: 'Close-range brawler with strike reposition.',
        longDescription: 'A compact gunship sporting dual coilguns and a short-hop strike vector for rapid engagements and flanking.',
        requirements: {
            core: { 'ferrite-alloy': 36, crytite: 18, vornite: 12 },
            specialized: { corvexite: 12, magnetrine: 8 }
        },
        buildTimeTurns: 2,
        pilotCost: 1,
        upkeep: { 'ferrite-alloy': 0, crytite: 0 },
        prereqs: [],
        stationClasses: ['sun-station', 'planet-station', 'moon-station'],
        maxHp: 55,
        movementSpeed: 3,
        warpSpeed: 3,
        scanRange: 40,
        cargoCapacity: 6,
        harvestRate: 0,
        maxEnergy: 8,
        energyRegen: 1,
        abilities: ['dual_light_coilguns', 'strike_vector']
    },
    {
        id: 'drill-skiff',
        name: 'Drill Skiff',
        class: 'frigate',
        role: 'miner',
        refinedRole: 'industrial',
        uiOrder: 3,
        shortDescription: 'Bulk miner with strong cargo and ramping lasers.',
        longDescription: 'Specialized harvesting craft using rotary mining lasers. Slower in combat but highly efficient at extracting resources.',
        requirements: {
            core: { 'ferrite-alloy': 28, crytite: 16, vornite: 8 },
            specialized: { gravium: 10, solarite: 6 }
        },
        buildTimeTurns: 2,
        pilotCost: 1,
        upkeep: { 'ferrite-alloy': 0, crytite: 0 },
        prereqs: [],
        stationClasses: ['sun-station', 'planet-station', 'moon-station'],
        maxHp: 50,
        movementSpeed: 3,
        warpSpeed: 3,
        scanRange: 35,
        cargoCapacity: 20,
        harvestRate: 2.0,
        maxEnergy: 16,
        energyRegen: 3,
        abilities: ['survey_scanner','duct_tape_resilience','rotary_mining_lasers']
    },
    {
        id: 'swift-courier',
        name: 'Swift Courier',
        class: 'frigate',
        role: 'courier',
        refinedRole: 'runner',
        uiOrder: 4,
        shortDescription: 'High-speed courier for rapid deliveries.',
        longDescription: 'An ultra-light frame tuned for speed and evasive maneuvers. Excellent for scouting and delivering small cargos quickly.',
        requirements: {
            core: { 'ferrite-alloy': 24, crytite: 20, vornite: 8 },
            specialized: { fluxium: 12, auralite: 4 }
        },
        buildTimeTurns: 2,
        pilotCost: 1,
        upkeep: { 'ferrite-alloy': 0, crytite: 0 },
        prereqs: [],
        stationClasses: ['sun-station', 'planet-station', 'moon-station'],
        maxHp: 35,
        movementSpeed: 6,
        warpSpeed: 5.0,
        scanRange: 45,
        cargoCapacity: 8,
        harvestRate: 0,
        maxEnergy: 12,
        energyRegen: 3,
        abilities: ['boost_engines','microthruster_shift']
    }
];

function computeAllRequirements(blueprint) {
    const requirements = blueprint && blueprint.requirements ? blueprint.requirements : {};
    return {
        core: { ...(requirements.core || {}) },
        specialized: { ...(requirements.specialized || {}) },
    };
}

function validateBlueprintRegistry({ resourceKeys, abilities } = {}) {
    const seen = new Set();
    const errors = [];
    const knownResources = resourceKeys ? new Set(resourceKeys) : null;
    for (const bp of SHIP_BLUEPRINTS) {
        if (!bp.id || seen.has(bp.id)) errors.push(`duplicate or missing blueprint id: ${bp.id || '<missing>'}`);
        seen.add(bp.id);
        if (!['frigate', 'battleship', 'capital'].includes(bp.class)) errors.push(`${bp.id}: invalid class`);
        if (!Number.isInteger(bp.buildTimeTurns) || bp.buildTimeTurns < 1) errors.push(`${bp.id}: buildTimeTurns must be a positive integer`);
        if (!Array.isArray(bp.stationClasses) || bp.stationClasses.length === 0) errors.push(`${bp.id}: stationClasses must not be empty`);
        for (const [group, costs] of Object.entries(computeAllRequirements(bp))) {
            for (const [resourceKey, quantity] of Object.entries(costs)) {
                if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(resourceKey)) errors.push(`${bp.id}: invalid resource slug ${resourceKey}`);
                if (!Number.isSafeInteger(quantity) || quantity < 0) errors.push(`${bp.id}: invalid ${group} quantity for ${resourceKey}`);
                if (knownResources && !knownResources.has(resourceKey)) errors.push(`${bp.id}: unknown resource slug ${resourceKey}`);
            }
        }
        for (const [resourceKey, quantity] of Object.entries(bp.upkeep || {})) {
            if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(resourceKey)) errors.push(`${bp.id}: invalid upkeep resource slug ${resourceKey}`);
            if (!Number.isSafeInteger(quantity) || quantity < 0) errors.push(`${bp.id}: invalid upkeep quantity for ${resourceKey}`);
            if (knownResources && !knownResources.has(resourceKey)) errors.push(`${bp.id}: unknown upkeep resource slug ${resourceKey}`);
        }
        for (const key of bp.abilities || []) if (abilities && !abilities[key]) errors.push(`${bp.id}: unknown ability ${key}`);
        for (const stationClass of bp.stationClasses || []) if (!['sun-station', 'planet-station', 'moon-station'].includes(stationClass)) errors.push(`${bp.id}: invalid station class ${stationClass}`);
    }
    if (errors.length) throw new Error(`Invalid ship blueprint registry:\n- ${errors.join('\n- ')}`);
    return true;
}

module.exports = { SHIP_BLUEPRINTS, computeAllRequirements, validateBlueprintRegistry };
