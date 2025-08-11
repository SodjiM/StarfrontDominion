// Combat configuration (Phase 1 scaffolding)
// Bands and base multipliers reflect user feedback

/** Size index mapping */
const SIZE_INDEX = { frigate: 1, battleship: 2, capital: 3 };

/** Range bands in tiles */
const RANGE_BANDS = {
  adjacency: { min: 1, max: 1 },
  close: { min: 3, max: 6 },
  mid: { min: 7, max: 10 },
  long: { min: 10, max: 15 }
};

/** Default size penalty when attacker is larger (applied after status effects adjustments) */
function computeSizePenalty(attackerClass, defenderClass, context) {
  const a = SIZE_INDEX[attackerClass] || 1;
  const d = SIZE_INDEX[defenderClass] || 1;
  const diff = Math.max(0, a - d);
  if (diff <= 0) return 1.0;

  // Status effects hooks (applied before penalty): context may set overrides
  // context = { ignoreSizePenalty: boolean, penaltyReduction: number in [0,1], weaponTags: Set<string> }
  if (context?.ignoreSizePenalty) return 1.0;

  // Baseline penalty for large→small
  let basePenalty = Math.pow(0.4, diff);

  // Point-defense/flak/fighter-style weapons are less penalized
  if (context?.weaponTags && (context.weaponTags.has('pd') || context.weaponTags.has('flak') || context.weaponTags.has('fighter'))) {
    const alt = Math.pow(0.85, diff);
    // Cap to be not worse than 0.6 vs much smaller
    basePenalty = Math.max(alt, 0.6);
  }

  if (context?.penaltyReduction && context.penaltyReduction > 0) {
    basePenalty = basePenalty + (1 - basePenalty) * Math.min(1, Math.max(0, context.penaltyReduction));
  }
  return basePenalty;
}

/** Range falloff around optimal distance; works on both sides */
function computeRangeMultiplier(distance, optimalRange, falloffRate) {
  const penalty = Math.abs((distance || 0) - (optimalRange || 1)) * (falloffRate || 0.15);
  return Math.max(0, 1 - penalty);
}

// Deprecated weapon profiles: keep as defaults for ships that use class-based attacks without explicit abilities
const WEAPON_PROFILES = {
  small_sustained: { baseDamage: 10, cooldown: 1, optimal: 4, falloff: 0.2, tags: ['small'] },
  battleship_main: { baseDamage: 32, cooldown: 2, optimal: 9, falloff: 0.15, tags: ['medium','main'] },
  capital_volley: { baseDamage: 80, cooldown: 4, optimal: 12, falloff: 0.1, tags: ['large','volley'] },
  point_defense: { baseDamage: 6, cooldown: 1, optimal: 4, falloff: 0.18, tags: ['pd','anti-small'] }
};

/** Suggested default loadouts by class (multiple weapon sizes per ship) */
const DEFAULT_LOADOUTS = {
  frigate: ['small_sustained'],
  battleship: ['battleship_main', 'point_defense'],
  capital: ['capital_volley', 'point_defense']
};

module.exports = {
  SIZE_INDEX,
  RANGE_BANDS,
  WEAPON_PROFILES,
  DEFAULT_LOADOUTS,
  computeSizePenalty,
  computeRangeMultiplier
};


