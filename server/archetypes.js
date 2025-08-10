// Sector Archetype Registry (30 variants)
// Each archetype defines: key, name, coreBias (Ferrite Alloy, Crytite, Ardanium, Vornite, Zerothium),
// fixedSpecialized (2 themed minerals), and description.

/** @typedef {{key:string,name:string,coreBias:Record<string,number>,fixedSpecialized:[string,string],description:string}} SectorArchetype */

const A = (key, name, coreBias, fixedSpecialized, description) => ({ key, name, coreBias, fixedSpecialized, description });

const CORE = (opts) => ({
  'Ferrite Alloy': opts.ferrite ?? 1.0,
  'Crytite': opts.crytite ?? 1.0,
  'Ardanium': opts.ardanium ?? 1.0,
  'Vornite': opts.vornite ?? 1.0,
  'Zerothium': opts.zerothium ?? 1.0
});

/** @type {SectorArchetype[]} */
const SECTOR_ARCHETYPES = [
  A('pulsar-forge', 'Pulsar Forge', CORE({ crytite: 1.6, vornite: 0.8 }), ['Auralite','Solarite'], 'Neutron star radiation powers rare crystal growth and energy deposits.'),
  A('nebula-shroud', 'Nebula Shroud', CORE({ vornite: 1.6, ferrite: 0.8 }), ['Spectrathene','Nebryllium'], 'Dense ionized gas disrupts sensors; stealth and jamming thrive.'),
  A('black-hole-fringe', 'Black Hole Fringe', CORE({ zerothium: 1.6, crytite: 0.85 }), ['Voidglass','Oblivium'], 'Gravity-warped asteroids yield stealth coatings and anti-energy armor.'),
  A('magnetar-reach', 'Magnetar Reach', CORE({ ferrite: 1.5, zerothium: 0.85 }), ['Magnetrine','Gravium'], 'Hypermagnetized star favors railguns and gravity tech; warp unstable.'),
  A('twin-sun-crucible', 'Twin Sun Crucible', CORE({ ardanium: 1.5, ferrite: 0.85 }), ['Luminite','Solarite'], 'Relentless energy from twin giants yields shield and energy crystals.'),
  A('wormhole-nexus', 'Wormhole Nexus', CORE({ zerothium: 1.6, vornite: 0.85 }), ['Riftstone','Tachytrium'], 'Unstable wormholes rich in stabilizers and FTL boosters.'),
  A('ice-comet-drift', 'Ice Comet Drift', CORE({ crytite: 1.6, ardanium: 0.85 }), ['Kryon Dust','Cryphos'], 'Frozen comet belts support stasis and EM weapon materials.'),
  A('volcanic-moon-chain', 'Volcanic Moon Chain', CORE({ ferrite: 1.5, vornite: 0.85 }), ['Drakonium','Pyronex'], 'Volcanic moons vent plasma and heavy artillery minerals.'),
  A('gas-giant-harvest', 'Gas Giant Harvest Grounds', CORE({ vornite: 1.5, ferrite: 0.85 }), ['Heliox Ore','Aetherium'], 'Massive giants enable large-scale scooping for fuel and life support.'),
  A('crystal-shard-belt', 'Crystal Shard Belt', CORE({ ardanium: 1.5, zerothium: 0.85 }), ['Quarzon','Auralite'], 'Refractive belts ideal for targeting arrays and sensor amplification.'),
  A('dead-star-graveyard', 'Dead Star Graveyard', CORE({ ferrite: 1.6, crytite: 0.85 }), ['Oblivium','Starforged Carbon'], 'Shattered worlds rich in armor-grade materials.'),
  A('nebula-relay-hub', 'Nebula Relay Hub', CORE({ vornite: 1.5, ardanium: 0.85 }), ['Aetherium','Spectrathene'], 'Hidden comm relays combine stealth and long-range crystals.'),
  A('binary-microgravity', 'Binary Microgravity Belt', CORE({ ardanium: 1.5, crytite: 0.85 }), ['Mythrion','Fluxium'], 'Unusual pockets yield speed alloys and warp agility boosts.'),
  A('pirate-haven-cluster', 'Pirate Haven Cluster', CORE({ ferrite: 1.5, zerothium: 0.85 }), ['Nebryllium','Corvexite'], 'Lawless space for deception crystals and high-damage munitions.'),
  A('supernova-remnant', 'Supernova Remnant', CORE({ zerothium: 1.5, vornite: 0.85 }), ['Starforged Carbon','Aurivex'], 'Volatile debris yielding prestige and elite command materials.'),
  A('ice-ring-colonies', 'Ice Ring Colonies', CORE({ crytite: 1.5, ferrite: 0.85 }), ['Kryon Dust','Heliox Ore'], 'Habitable icy rings produce cryogenic and life-support minerals.'),
  A('war-torn-wreckfields', 'War-Torn Wreckfields', CORE({ ferrite: 1.5, crytite: 0.85 }), ['Magnetrine','Drakonium'], 'Battle graveyards ripe for salvage and heavy weapons components.'),
  A('pulsar-weapon-range', 'Pulsar Weapon Range', CORE({ crytite: 1.5, ardanium: 0.85 }), ['Quarzon','Gravium'], 'Artillery testing grounds producing targeting and gravity tech.'),
  A('lava-world-core', 'Lava World Core', CORE({ ardanium: 1.5, crytite: 0.85 }), ['Pyronex','Drakonium'], 'Molten planets rich in plasma/thermal weapon minerals.'),
  A('riftstorm-veil', 'Riftstorm Veil', CORE({ zerothium: 1.5, vornite: 0.85 }), ['Phasegold','Riftstone'], 'Turbulent riftspace with unstable cloaking and wormhole tech.'),
  A('stellar-garden', 'Stellar Garden', CORE({ vornite: 1.5, ardanium: 0.85 }), ['Aurivex','Aetherium'], 'Lush worlds with prestige metals and comm materials.'),
  A('hyperlane-junction', 'Hyperlane Junction', CORE({ zerothium: 1.5, crytite: 0.85 }), ['Tachytrium','Fluxium'], 'Critical FTL node for rapid warp and agility crystals.'),
  A('dark-nebula-run', "Dark Nebula Smugglers' Run", CORE({ ferrite: 1.5, crytite: 0.85 }), ['Nebryllium','Voidglass'], 'Stealth paradise with cloaking and deception resources.'),
  A('exotic-matter-forge', 'Exotic Matter Forge', CORE({ ardanium: 1.5, vornite: 0.85 }), ['Phasegold','Spectrathene'], 'Anomaly-fed rare matter for cloaks and phase tech.'),
  A('crystal-lighthouse', 'Crystal Lighthouse', CORE({ crytite: 1.5, ferrite: 0.85 }), ['Luminite','Quarzon'], 'Beacon world of massive refractive crystals.'),
  A('magnetron-fields', 'Magnetron Fields', CORE({ ferrite: 1.5, vornite: 0.85 }), ['Magnetrine','Corvexite'], 'Magnetic storm belts for railgun and armor-piercing ordnance.'),
  A('aurora-veil', 'Aurora Veil System', CORE({ vornite: 1.5, zerothium: 0.85 }), ['Auralite','Luminite'], 'Brilliant belts feeding shield and sensor tech.'),
  A('hollow-planet-core', 'Hollow Planet Core', CORE({ ferrite: 1.5, ardanium: 0.85 }), ['Starforged Carbon','Gravium'], 'Mining inside hollow worlds yields reinforced armor and gravity tech.'),
  A('nebula-pirate-forge', 'Nebula Pirate Forge', CORE({ vornite: 1.5, crytite: 0.85 }), ['Nebryllium','Corvexite'], 'Nebula shipyards with jamming and piercing munitions.'),
  A('deep-rift-observatory', 'Deep Rift Observatory', CORE({ zerothium: 1.5, crytite: 0.85 }), ['Riftstone','Aetherium'], 'Deep riftspace anomalies for wormhole stability and relay tech.')
];

const ALL_ARCHETYPES_KEYS = SECTOR_ARCHETYPES.map(a => a.key);

function getArchetype(key) {
  return SECTOR_ARCHETYPES.find(a => a.key === key) || null;
}

module.exports = { SECTOR_ARCHETYPES, ALL_ARCHETYPES_KEYS, getArchetype };


