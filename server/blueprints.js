// Single Source of Truth: Ship Blueprints
// - Pure data: behavior (ability effects) remains in server/abilities.js, referenced by key
// - Use resolveBlueprint(bp) to merge class defaults with per-blueprint overrides

/**
 * @typedef {{
 *   // Identity
 *   id: string
 *   name: string
 *   class: 'frigate'|'battleship'|'capital'
 *   role: string
 *   refinedRole?: string
 *   refinedGroup?: 'combat'|'support-utility'|'exploration-expansion'|'specialist'|'flagship'|string
 *   emoji?: string
 *   uiOrder?: number
 *   shortDescription?: string
 *   longDescription?: string
 *   faction?: string
 *
 *   // Construction/Economy
 *   requirements: { core: Record<string, number>, specialized: Record<string, number> }
 *   buildTimeTurns?: number
 *   pilotCost?: number
 *   crewSize?: number
 *   upkeep?: Record<string, number>
 *   currencyCost?: number
 *   tier?: number
 *   prereqs?: string[]
 *   blueprintRarity?: 'common'|'uncommon'|'rare'|'epic'|'legendary'|string
 *
 *   // Core stats (overrides class baselines)
 *   hp?: number
 *   maxHp?: number
 *   shields?: number
 *   maxShields?: number
 *   movementSpeed?: number
 *   scanRange?: number
 *   cargoCapacity?: number
 *   harvestRate?: number
 *   canMine?: boolean
 *   canActiveScan?: boolean
 *
 *   // Energy
 *   energy?: number
 *   maxEnergy?: number
 *   energyRegen?: number
 *
 *   // Combat/Loadout
 *   abilities?: string[]
 *   weapons?: (string|{
 *     key?: string,
 *     baseDamage?: number,
 *     cooldown?: number,
 *     optimal?: number,
 *     falloff?: number,
 *     tags?: string[]
 *   })[]
 *   tags?: string[]
 *
 *   // Meta
 *   version?: number
 *   notes?: string
 * }} ShipBlueprint
 */

// NOTE: Class baselines and resolver are deprecated; blueprints are now full data objects.
// For compatibility, compute simple defaults where needed downstream rather than merging baselines here.

function computeAllRequirements(blueprint) {
  return (blueprint && blueprint.requirements) ? blueprint.requirements : { core: {}, specialized: {} };
}

/** @type {ShipBlueprint[]} */
const SHIP_BLUEPRINTS = [
  // Frigates (examples; extend freely)

  {
    id: 'explorer',
    name: 'Explorer',
    class: 'frigate',
    role: 'scout-recon',
    refinedRole: 'scout-recon',
    refinedGroup: 'exploration-expansion',
    emoji: '🔭',
    uiOrder: 10,
    shortDescription: 'Light scout with survey tools and basic self-sustain.',
    longDescription: 'Designed for reconnaissance and prospecting. Strong sensors, modest speed, and utility abilities for early exploration and survival.',
    requirements: {
      core:        { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 },
      specialized: { }
    },
    hp: 50,
    maxHp: 50,
    energy: 6,
    maxEnergy: 6,
    energyRegen: 3,
    movementSpeed: 4,
    scanRange: 55,
    cargoCapacity: 12,
    harvestRate: 1.0,
    abilities: ['dual_light_coilguns','boost_engines','jury_rig_repair','survey_scanner','duct_tape_resilience'],
    canMine: true,
    pilotCost: 1,
    warpPreparationTurns: 2,
    buildTimeTurns: 1,
    upkeep: {},
    tier: 1,
    prereqs: [],
    version: 1
  },

  {
    id: 'needle-gunship',
    name: 'Needle Gunship',
    class: 'frigate',
    role: 'sniper-siege',
    refinedRole: 'sniper-siege',
    refinedGroup: 'combat',
    emoji: '🎯',
    uiOrder: 20,
    shortDescription: 'Precision micro-lance platform with strike utilities.',
    longDescription: 'A glass-cannon frigate mounting an Auralite micro-lance and missile rack. Excels at surgical strikes from standoff ranges.',
    requirements: {
      core:        { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 },
      specialized: { 'Auralite': 5, 'Quarzon': 5 }
    },
    hp: 45,
    maxHp: 45,
    energy: 6,
    maxEnergy: 6,
    energyRegen: 3,
    movementSpeed: 4,
    scanRange: 50,
    cargoCapacity: 6,
    harvestRate: 0.0,
    abilities: ['auralite_lance','quarzon_micro_missiles','phantom_burn','strike_vector'],
    tags: ['small','sniper'],
    warpPreparationTurns: 2,
    pilotCost: 1,
    upkeep: {},
    tier: 1,
    prereqs: [],
    version: 1
  },

  {
    id: 'swift-courier',
    name: 'Swift Courier',
    class: 'frigate',
    role: 'logistics',
    refinedRole: 'logistics',
    refinedGroup: 'support-utility',
    emoji: '📦',
    uiOrder: 30,
    shortDescription: 'Fast hauler for early logistics.',
    longDescription: 'Trade-tuned engines and expanded holds for rapid supply runs and mission logistics.',
    requirements: {
      core:        { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 },
      specialized: { 'Tachytrium': 5, 'Fluxium': 5 }
    },
    hp: 35,
    maxHp: 35,
    energy: 6,
    maxEnergy: 6,
    energyRegen: 3,
    movementSpeed: 5,
    cargoCapacity: 30,
    harvestRate: 0.0,
    canMine: false,
    abilities: [],
    warpPreparationTurns: 1,
    pilotCost: 1,
    upkeep: {},
    tier: 1,
    prereqs: [],
    version: 1
  }
  ,
  {
    id: 'drill-skiff',
    name: 'Drill Skiff',
    class: 'frigate',
    role: 'prospector-miner',
    refinedRole: 'prospector-miner',
    refinedGroup: 'exploration-expansion',
    emoji: '⛏️',
    uiOrder: 40,
    shortDescription: 'Agile early-game asteroid harvester.',
    longDescription: 'The Drill Skiff excels at rapid prospecting runs: zip into belts, dig fast, and slip away if threatened. Most profitable miner early, but fragile and prefers to work alone.',
    requirements: {
      core:        { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 },
      specialized: { 'Magnetrine': 15 }
    },
    hp: 35,
    maxHp: 35,
    energy: 6,
    maxEnergy: 6,
    energyRegen: 3,
    movementSpeed: 5,
    scanRange: 45,
    cargoCapacity: 25,
    harvestRate: 1.0,
    abilities: ['rotary_mining_lasers','microthruster_shift','emergency_discharge_vent','solo_miners_instinct'],
    canMine: true,
    tags: ['miner','agile'],
    warpPreparationTurns: 2,
    pilotCost: 1,
    upkeep: {},
    tier: 1,
    prereqs: [],
    version: 1
  }
];

module.exports = { SHIP_BLUEPRINTS, computeAllRequirements };