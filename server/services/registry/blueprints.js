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
 * @property {{ core: Record<string, number>, specialized: Record<string, number> }} requirements
 * @property {number} [buildTimeTurns]
 * @property {number} [pilotCost]
 * @property {Record<string, number>} [upkeep]
 * @property {string[]} [prereqs]
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
            core: { 'Ferrite Alloy': 30, 'Crytite': 20, 'Vornite': 10 },
            specialized: { Fluxium: 10, Auralite: 6 }
        },
        buildTimeTurns: 1,
        pilotCost: 1,
        upkeep: { 'Ferrite Alloy': 0, 'Crytite': 0 },
        prereqs: [],
        maxHp: 40,
        movementSpeed: 4,
        warpSpeed: 1.5,
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
            core: { 'Ferrite Alloy': 36, 'Crytite': 18, 'Vornite': 12 },
            specialized: { Corvexite: 12, Magnetrine: 8 }
        },
        buildTimeTurns: 2,
        pilotCost: 1,
        upkeep: { 'Ferrite Alloy': 0, 'Crytite': 0 },
        prereqs: [],
        maxHp: 55,
        movementSpeed: 3,
        warpSpeed: 1.5,
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
            core: { 'Ferrite Alloy': 28, 'Crytite': 16, 'Vornite': 8 },
            specialized: { Gravium: 10, Solarite: 6 }
        },
        buildTimeTurns: 2,
        pilotCost: 1,
        upkeep: { 'Ferrite Alloy': 0, 'Crytite': 0 },
        prereqs: [],
        maxHp: 50,
        movementSpeed: 3,
        warpSpeed: 1.5,
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
            core: { 'Ferrite Alloy': 24, 'Crytite': 20, 'Vornite': 8 },
            specialized: { Fluxium: 12, Auralite: 4 }
        },
        buildTimeTurns: 1,
        pilotCost: 1,
        upkeep: { 'Ferrite Alloy': 0, 'Crytite': 0 },
        prereqs: [],
        maxHp: 35,
        movementSpeed: 6,
        warpSpeed: 2.0,
        scanRange: 45,
        cargoCapacity: 8,
        harvestRate: 0,
        maxEnergy: 12,
        energyRegen: 3,
        abilities: ['boost_engines','microthruster_shift']
    }
];

function computeAllRequirements(blueprint) {
    return blueprint && blueprint.requirements ? blueprint.requirements : { core: {}, specialized: {} };
}

module.exports = { SHIP_BLUEPRINTS, computeAllRequirements };

