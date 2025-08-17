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

// Class baselines (merged first; blueprints override)
const CLASS_BASELINES = {
  frigate:  { hp: 50,  maxHp: 50,  scanRange: 50, movementSpeed: 4, cargoCapacity: 10, harvestRate: 0, energy: 6,  maxEnergy: 6,  energyRegen: 3, pilotCost: 1 },
  battleship:{ hp: 140, maxHp: 140, scanRange: 50, movementSpeed: 3, cargoCapacity: 20, harvestRate: 0, energy: 8,  maxEnergy: 8,  energyRegen: 2, pilotCost: 2 },
  capital:  { hp: 300, maxHp: 300, scanRange: 50, movementSpeed: 2, cargoCapacity: 40, harvestRate: 0, energy: 12, maxEnergy: 12, energyRegen: 2, pilotCost: 3 }
};

// Default abilities if a blueprint doesn't specify any
const DEFAULT_ABILITIES_BY_CLASS = {
  frigate:    ['target_painter'],
  battleship: ['barrage','tractor_field'],
  capital:    ['aegis_pulse','tractor_field']
};

// Helper: finalize a blueprint with baselines, fallbacks, and computed flags
function resolveBlueprint(bp) {
  const base = CLASS_BASELINES[bp.class] || {};
  const merged = {
    ...base,
    ...bp
  };
  if (!Array.isArray(merged.abilities) || merged.abilities.length === 0) {
    merged.abilities = DEFAULT_ABILITIES_BY_CLASS[bp.class] || [];
  }
  if (typeof merged.canMine !== 'boolean') {
    merged.canMine = (merged.harvestRate || 0) > 0;
  }
  if (typeof merged.canActiveScan !== 'boolean') {
    merged.canActiveScan = false;
  }
  if (typeof merged.version !== 'number') merged.version = 1;
  return merged;
}

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
    movementSpeed: 4,
    scanRange: 55,
    cargoCapacity: 12,
    harvestRate: 1.0,
    abilities: ['dual_light_coilguns','boost_engines','jury_rig_repair','survey_scanner','duct_tape_resilience'],
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
    movementSpeed: 4,
    scanRange: 50,
    cargoCapacity: 6,
    harvestRate: 0.0,
    abilities: ['auralite_lance','quarzon_micro_missiles','phantom_burn','strike_vector'],
    tags: ['small','sniper'],
    buildTimeTurns: 2,
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
    movementSpeed: 5,
    cargoCapacity: 30,
    harvestRate: 0.0,
    canMine: false,
    abilities: [],
    buildTimeTurns: 1,
    upkeep: {},
    tier: 1,
    prereqs: [],
    version: 1
  }
];

// Optionally export a resolved view for callers that want merged stats
const RESOLVED_BLUEPRINTS = SHIP_BLUEPRINTS.map(resolveBlueprint);

module.exports = { SHIP_BLUEPRINTS, RESOLVED_BLUEPRINTS, CLASS_BASELINES, DEFAULT_ABILITIES_BY_CLASS, resolveBlueprint, computeAllRequirements };