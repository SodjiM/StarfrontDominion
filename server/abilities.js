// Ability definitions (Phase 2/3): all combat, weapons, and utilities are abilities
// Types: 'offense' (does damage), 'active' (buff/debuff/move), 'passive' (no activation)

/**
 * Ability schema:
 * key: string
 * name: string
 * description: string               // legacy/compat
 * shortDescription?: string         // concise UI string
 * longDescription?: string          // detailed UI string
 * cooldown: number (turns)
 * range: number (tiles) or null for self
 * target: 'self' | 'ally' | 'enemy' | 'position'
 * apply(context) -> { effects: [], cdOverride?, notes? }
 *   where effects are high-level intents: { type, targetId?, magnitude?, duration?, data? }
 */

const Abilities = {
  // Utilities to counter small-ship evasion
  target_painter: {
    key: 'target_painter',
    name: 'Target Painter',
    description: 'Paint a target to reduce large-weapon size penalty against it.',
    shortDescription: 'Mark target to reduce size penalty.',
    longDescription: 'Paints an enemy target, reducing large-weapon size penalty against it by 40% for 2 turns.',
    type: 'active',
    cooldown: 3,
    range: 10,
    target: 'enemy',
    effectKey: 'painted',
    penaltyReduction: 0.4, // 40% reduction applied before size penalty
    duration: 2
  },
  tractor_field: {
    key: 'tractor_field',
    name: 'Tractor Field',
    description: 'Hold a target in place and negate size penalty for one turn at close range.',
    shortDescription: 'Hold target; ignore size penalty.',
    longDescription: 'Projects a tractor field that holds an enemy at close range and ignores large→small size penalty for 1 turn.',
    type: 'active',
    cooldown: 5,
    range: 4,
    target: 'enemy',
    effectKey: 'tractored',
    ignoreSizePenalty: true,
    duration: 1
  },
  // Offense
  barrage: {
    key: 'barrage',
    name: 'Barrage',
    description: 'Medium-range barrage; briefly lowers size penalty for your main guns.',
    shortDescription: 'Brief window of improved accuracy.',
    longDescription: 'Activates a firing pattern that reduces large-weapon size penalty (self) for 1 turn, improving hit chance.',
    type: 'active',
    cooldown: 4,
    range: 0,
    target: 'self',
    effectKey: 'barrage_window',
    selfPenaltyReduction: 0.25,
    duration: 1
  },
  // Defense / sustain
  aegis_pulse: {
    key: 'aegis_pulse',
    name: 'Aegis Pulse',
    description: 'Emit a protective pulse to reduce incoming damage for nearby allies.',
    shortDescription: 'Defensive pulse reduces damage.',
    longDescription: 'Emits a protective pulse that reduces incoming damage for self and nearby allies for 2 turns.',
    type: 'active',
    cooldown: 5,
    range: 0,
    target: 'self',
    effectKey: 'aegis_shield',
    damageReduction: 0.25,
    auraRange: 5,
    duration: 2
  },

  // Example offensive weapons as abilities (unique per blueprint when needed)
  auralite_lance: {
    key: 'auralite_lance',
    name: 'Auralite Lance',
    description: 'Ultra-high velocity lance; massive single-target burst. Overpenetrates on kill (50%).',
    shortDescription: 'Heavy single-target burst.',
    longDescription: 'Fires a high-velocity energy lance that deals massive burst to a single target. 50% chance to overpenetrate on kill.',
    type: 'offense',
    target: 'enemy',
    range: 15, // long
    optimal: 12,
    falloff: 0.10, // low falloff
    cooldown: 3,
    energyCost: 4,
    sizeTag: 'frigate',
    baseDamage: 20,
    tags: ['volley']
  },
  quarzon_micro_missiles: {
    key: 'quarzon_micro_missiles',
    name: 'Quarzon Micro-Missiles',
    description: 'Tracking micro-missiles; moderate damage and accuracy debuff on hit.',
    shortDescription: 'Tracking missiles with debuff.',
    longDescription: 'Launches tracking micro-missiles for moderate damage. On hit, applies an accuracy debuff (20%) for 2 turns.',
    type: 'offense',
    target: 'enemy',
    range: 10,
    optimal: 8,
    falloff: 0.18,
    cooldown: 1,
    energyCost: 2,
    sizeTag: 'frigate',
    baseDamage: 10,
    tags: ['small'],
    onHitStatus: { effectKey: 'accuracy_debuff', duration: 2, magnitude: 0.2 }
  },
  phantom_burn: {
    key: 'phantom_burn',
    name: 'Phantom Burn',
    description: 'Evasion and cloak shimmer for a short duration.',
    shortDescription: 'Brief evasion/stealth boost.',
    longDescription: 'Self-buff that grants significant evasion and a cloak shimmer effect for 2 turns.',
    type: 'active',
    target: 'self',
    cooldown: 4,
    energyCost: 3,
    effectKey: 'evasion_boost',
    duration: 2,
    evasionBonus: 0.8
  },
  strike_vector: {
    key: 'strike_vector',
    name: 'Strike Vector Insertion',
    description: 'Micro-warp reposition a short distance.',
    shortDescription: 'Short-range reposition.',
    longDescription: 'Micro-warp to a nearby tile up to range 3 for rapid repositioning.',
    type: 'active',
    target: 'position',
    range: 3,
    cooldown: 3,
    energyCost: 3
  },
  target_lock_override: {
    key: 'target_lock_override',
    name: 'Target Lock Override',
    description: 'Passive: Tracking the same target increases next lance damage.',
    shortDescription: 'Passive damage ramp on lock.',
    longDescription: 'While maintaining target lock, the next lance attack deals increased damage.',
    type: 'passive'
  },

  // Explorer starting ship abilities
  dual_light_coilguns: {
    key: 'dual_light_coilguns',
    name: 'Dual Light Coilguns',
    description: 'Low-caliber kinetic repeaters with small spread. Low sustained DPS.',
    shortDescription: 'Low-caliber kinetic repeaters.',
    longDescription: 'Short-ranged, small-caliber coilguns with modest spread and low sustained DPS.',
    type: 'offense',
    target: 'enemy',
    sizeTag: 'small',
    range: 6,
    optimal: 4,
    falloff: 0.22,
    cooldown: 1,
    energyCost: 0,
    baseDamage: 6,
    tags: ['small']
  },
  boost_engines: {
    key: 'boost_engines',
    name: 'Boost Engines',
    description: 'Increase travel speed by 100% for 3 turns.',
    shortDescription: 'Double travel speed (3 turns).',
    longDescription: 'Temporarily doubles travel speed for 3 turns. Consumes energy on activation.',
    type: 'active',
    target: 'self',
    cooldown: 20,
    energyCost: 2,
    effectKey: 'engine_boost',
    duration: 3,
    movementBonus: 1.0
  },
  jury_rig_repair: {
    key: 'jury_rig_repair',
    name: 'Jury-Rig Repair',
    description: 'Restore 5% hull per turn for 3 turns.',
    shortDescription: 'Regenerate hull over time.',
    longDescription: 'Restores 5% hull per turn for 3 turns as an emergency self-repair.',
    type: 'active',
    target: 'self',
    cooldown: 20,
    energyCost: 3,
    effectKey: 'repair_over_time',
    duration: 3,
    healPercentPerTurn: 0.05
  },
  survey_scanner: {
    key: 'survey_scanner',
    name: 'Survey Scanner',
    description: 'Double scan range for 3 turns.',
    shortDescription: 'Double scan range (3 turns).',
    longDescription: 'Doubles scan range for 3 turns, improving reconnaissance and prospecting.',
    type: 'active',
    target: 'self',
    cooldown: 6,
    energyCost: 2,
    effectKey: 'survey_scanner',
    duration: 3,
    scanRangeMultiplier: 2
  },
  duct_tape_resilience: {
    key: 'duct_tape_resilience',
    name: 'Duct Tape Resilience',
    description: 'Passive: first hit after full repairs does 25% less damage.',
    shortDescription: 'Passive: reduced first-hit damage.',
    longDescription: 'After a full repair, the next incoming hit deals 25% less damage.',
    type: 'passive'
  }
};

/** Default per-class ability sets (can be refined per blueprint later) */
const DEFAULT_ABILITIES = {
  frigate: ['target_painter'],
  battleship: ['barrage', 'tractor_field'],
  capital: ['aegis_pulse', 'tractor_field'],
  explorer: ['dual_light_coilguns','boost_engines','jury_rig_repair','survey_scanner','duct_tape_resilience']
};

// Blueprint-specific overrides (example)
const BLUEPRINT_ABILITIES = {
  'needle-gunship': ['auralite_lance', 'quarzon_micro_missiles', 'phantom_burn', 'strike_vector']
};

module.exports = { Abilities, DEFAULT_ABILITIES, BLUEPRINT_ABILITIES };


