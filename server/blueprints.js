// Ship Blueprints: classes = 'frigate' | 'battleship' | 'capital'
// Roles include combat and logistics/industrial as roles, not classes

/** @typedef {{id:string,name:string,class:'frigate'|'battleship'|'capital',role:string,specialized:string[]}} ShipBlueprint */

/** @type {ShipBlueprint[]} */
const SHIP_BLUEPRINTS = [
  // Frigates
  { id: 'wraith-scout', name: 'Wraith Scout', class: 'frigate', role: 'stealth-scout', specialized: ['Spectrathene','Voidglass'] },
  { id: 'maul-brawler', name: 'Maul-Class Brawler Frigate', class: 'frigate', role: 'brawler', specialized: ['Starforged Carbon','Oblivium','Corvexite'] },
  { id: 'lance-sniper', name: 'Lance-Class Precision Sniper Frigate', class: 'frigate', role: 'sniper', specialized: ['Auralite','Quarzon','Gravium'] },
  { id: 'viper-interceptor', name: 'Viper Interceptor', class: 'frigate', role: 'interceptor', specialized: ['Fluxium','Tachytrium'] },
  { id: 'needle-gunship', name: 'Needle Gunship', class: 'frigate', role: 'assassin', specialized: ['Auralite','Quarzon'] },
  { id: 'drill-skiff', name: 'Drill Skiff', class: 'frigate', role: 'miner', specialized: ['Magnetrine'] },
  { id: 'shade-ecm', name: 'Shade ECM Frigate', class: 'frigate', role: 'ecm', specialized: ['Cryphos','Nebryllium'] },
  { id: 'sting-torpedo', name: 'Sting Torpedo Boat', class: 'frigate', role: 'torpedo', specialized: ['Quarzon','Gravium'] },
  { id: 'swift-courier', name: 'Swift Courier', class: 'frigate', role: 'courier', specialized: ['Tachytrium','Fluxium'] },
  { id: 'raven-gunship-scout', name: 'Raven Gunship-Scout', class: 'frigate', role: 'stealth-strike', specialized: ['Spectrathene','Auralite'] },
  { id: 'jackal-boarder', name: 'Jackal Interceptor-Boarder', class: 'frigate', role: 'boarding', specialized: ['Fluxium','Magnetrine'] },
  { id: 'mako-miner-raider', name: 'Mako Miner-Raider', class: 'frigate', role: 'miner-raider', specialized: ['Magnetrine','Nebryllium'] },
  { id: 'ghost-ecm-torpedo', name: 'Ghost ECM-Torpedo', class: 'frigate', role: 'ecm-torpedo', specialized: ['Cryphos','Gravium'] },
  { id: 'kite-patrol', name: 'Kite Patrol Frigate', class: 'frigate', role: 'escort', specialized: ['Luminite','Magnetrine'] },

  // Battleships
  { id: 'warhammer-siege', name: 'Warhammer Gunline-Siege', class: 'battleship', role: 'siege', specialized: ['Gravium','Drakonium'] },
  { id: 'bulwark-fortress', name: 'Bulwark Fortress', class: 'battleship', role: 'fortress', specialized: ['Oblivium','Luminite'] },
  { id: 'tempest-gunline', name: 'Tempest Gunline', class: 'battleship', role: 'gunline', specialized: ['Quarzon','Drakonium'] },
  { id: 'cerberus-carrier', name: 'Cerberus Carrier-Battleship', class: 'battleship', role: 'carrier', specialized: ['Luminite','Heliox Ore'] },
  { id: 'leviathan-beam', name: 'Leviathan Beam Destroyer', class: 'battleship', role: 'beam-destroyer', specialized: ['Auralite','Gravium'] },
  { id: 'tidebreaker-dreadnought', name: 'Tidebreaker Torpedo Dreadnought', class: 'battleship', role: 'torpedo-siege', specialized: ['Gravium','Tachytrium'] },
  { id: 'sentinel-ecm', name: 'Sentinel ECM Fortress', class: 'battleship', role: 'ecm-fortress', specialized: ['Cryphos','Nebryllium'] },
  { id: 'harbormaster-logistics', name: 'Harbormaster Logistics Command', class: 'battleship', role: 'logistics', specialized: ['Heliox Ore','Magnetrine'] },
  { id: 'atlas-tender', name: 'Atlas Fleet Tender', class: 'battleship', role: 'repair-tender', specialized: ['Heliox Ore','Luminite'] },
  { id: 'aegis-defensive-carrier', name: 'Aegis Defensive Carrier', class: 'battleship', role: 'defensive-carrier', specialized: ['Luminite','Heliox Ore'] },
  { id: 'star-marshal', name: 'Star Marshal', class: 'battleship', role: 'command-artillery', specialized: ['Auralite','Quarzon'] },
  { id: 'specter-siege', name: 'Specter Siege', class: 'battleship', role: 'siege-ecm', specialized: ['Gravium','Nebryllium'] },
  { id: 'iron-anchor', name: 'Iron Anchor', class: 'battleship', role: 'logistics-fortress', specialized: ['Oblivium','Heliox Ore'] },

  // Logistics & Mining (as roles on battleship class per instruction)
  { id: 'atlas-heavy-freighter', name: 'Atlas Heavy Freighter', class: 'battleship', role: 'freighter', specialized: ['Starforged Carbon','Aurivex','Oblivium'] },
  { id: 'pioneer-colony-ship', name: 'Pioneer Colony Ship', class: 'battleship', role: 'colony', specialized: ['Heliox Ore','Aurivex','Aetherium'] },
  { id: 'hermes-fleet-transport', name: 'Hermes Fleet Transport', class: 'battleship', role: 'transport', specialized: ['Mythrion','Tachytrium','Aurivex'] },
  { id: 'bastion-medical-carrier', name: 'Bastion Medical & Crew Carrier', class: 'battleship', role: 'medical', specialized: ['Heliox Ore'] },
  { id: 'goliath-deepcore-miner', name: 'Goliath Deepcore Miner', class: 'battleship', role: 'deepcore-miner', specialized: ['Magnetrine'] },
  { id: 'leviathan-gas-harvester', name: 'Leviathan Gas Harvester', class: 'battleship', role: 'gas-harvester', specialized: ['Heliox Ore','Tachytrium'] },
  { id: 'colossus-strip-miner', name: 'Colossus Strip Miner', class: 'battleship', role: 'strip-miner', specialized: ['Magnetrine','Drakonium'] },
  { id: 'prospector-command-ship', name: 'Prospector Command Ship', class: 'battleship', role: 'mining-command', specialized: ['Magnetrine','Auralite'] },
  { id: 'scarab-salvage-barge', name: 'Scarab Salvage Barge', class: 'battleship', role: 'salvage', specialized: ['Magnetrine','Oblivium'] },

  // Capitals (combat)
  { id: 'eclipse-supercarrier', name: 'Eclipse Supercarrier', class: 'capital', role: 'supercarrier', specialized: ['Luminite','Heliox Ore'] },
  { id: 'leviathan-dreadnought', name: 'Leviathan Dreadnought', class: 'capital', role: 'dreadnought', specialized: ['Gravium','Oblivium'] },
  { id: 'aurora-flagship', name: 'Aurora Flagship', class: 'capital', role: 'flagship-command', specialized: ['Auralite','Quarzon'] },
  { id: 'nemesis-siege-platform', name: 'Nemesis Siege Platform', class: 'capital', role: 'siege', specialized: ['Gravium','Drakonium'] },
  { id: 'phalanx-heavy-shield', name: 'Phalanx Heavy Shield Ship', class: 'capital', role: 'heavy-shield', specialized: ['Luminite','Oblivium'] },
  { id: 'eclipse-marauder', name: 'Eclipse Marauder', class: 'capital', role: 'stealth-battleship', specialized: ['Spectrathene','Voidglass'] },

  // Capitals (logistics & industrial roles)
  { id: 'colossus-mobile-shipyard', name: 'Colossus Mobile Shipyard', class: 'capital', role: 'mobile-shipyard', specialized: ['Magnetrine','Heliox Ore'] },
  { id: 'oasis-worldship', name: 'Oasis Worldship', class: 'capital', role: 'worldship', specialized: ['Heliox Ore','Quarzon'] },
  { id: 'atlas-prime-megafreighter', name: 'Atlas Prime Megafreighter', class: 'capital', role: 'megafreighter', specialized: ['Heliox Ore','Tachytrium'] },
  { id: 'artemis-exploration-carrier', name: 'Artemis Exploration Carrier', class: 'capital', role: 'exploration', specialized: ['Auralite','Heliox Ore'] },
  { id: 'bastion-fleet-anchor', name: 'Bastion Fleet Anchor', class: 'capital', role: 'fleet-anchor', specialized: ['Oblivium','Luminite'] },
  { id: 'behemoth-planet-cracker', name: 'Behemoth Planet-Cracker', class: 'capital', role: 'planet-cracker', specialized: ['Magnetrine','Drakonium'] },
  { id: 'aether-gas-refinery', name: 'Aether Gas Refinery', class: 'capital', role: 'gas-refinery', specialized: ['Heliox Ore','Tachytrium'] },
  { id: 'auric-prospecting-ark', name: 'Auric Prospecting Ark', class: 'capital', role: 'prospecting-ark', specialized: ['Auralite','Quarzon'] }
];

// Map detailed roles to simplified/refined categories (UI filter)
const REFINED_ROLE_MAP = {
  'stealth-scout': 'scout-recon',
  'brawler': 'brawler',
  'sniper': 'sniper-siege',
  'interceptor': 'interceptor',
  'assassin': 'stealth-strike',
  'miner': 'prospector-miner',
  'ecm': 'ecm-disruption',
  'torpedo': 'torpedo-missile',
  'courier': 'logistics',
  'stealth-strike': 'stealth-strike',
  'boarding': 'heavy-assault',
  'miner-raider': 'prospector-miner',
  'ecm-torpedo': 'torpedo-missile',
  'escort': 'escort',
  'siege': 'sniper-siege',
  'fortress': 'fortress',
  'gunline': 'sniper-siege',
  'carrier': 'carrier',
  'beam-destroyer': 'sniper-siege',
  'torpedo-siege': 'torpedo-missile',
  'ecm-fortress': 'ecm-disruption',
  'logistics': 'logistics',
  'repair-tender': 'medical-repair',
  'defensive-carrier': 'carrier',
  'command-artillery': 'command',
  'siege-ecm': 'sniper-siege',
  'logistics-fortress': 'logistics',
  'freighter': 'logistics',
  'colony': 'colony-ship',
  'transport': 'logistics',
  'medical': 'medical-repair',
  'deepcore-miner': 'prospector-miner',
  'gas-harvester': 'gas-harvester',
  'strip-miner': 'prospector-miner',
  'mining-command': 'prospector-miner',
  'salvage': 'salvage',
  'supercarrier': 'carrier',
  'dreadnought': 'heavy-assault',
  'flagship-command': 'flagship',
  'heavy-shield': 'fortress',
  'stealth-battleship': 'stealth-strike',
  'mobile-shipyard': 'logistics',
  'worldship': 'fortress',
  'megafreighter': 'logistics',
  'exploration': 'scout-recon',
  'fleet-anchor': 'fortress',
  'planet-cracker': 'sniper-siege',
  'gas-refinery': 'gas-harvester',
  'prospecting-ark': 'prospector-miner'
};

// Group each refined role under a high-level category for UI grouping
const REFINED_ROLE_GROUP = {
  'brawler': 'combat',
  'sniper-siege': 'combat',
  'interceptor': 'combat',
  'heavy-assault': 'combat',
  'stealth-strike': 'combat',
  'carrier': 'combat',

  'escort': 'support-utility',
  'command': 'support-utility',
  'medical-repair': 'support-utility',
  'logistics': 'support-utility',

  'scout-recon': 'exploration-expansion',
  'colony-ship': 'exploration-expansion',
  'prospector-miner': 'exploration-expansion',
  'gas-harvester': 'exploration-expansion',
  'salvage': 'exploration-expansion',

  'ecm-disruption': 'specialist',
  'torpedo-missile': 'specialist',
  'fortress': 'specialist',
  'flagship': 'specialist'
};

function getRefinedRole(originalRole) {
  return REFINED_ROLE_MAP[originalRole] || originalRole;
}

function getRefinedGroup(refinedRole) {
  return REFINED_ROLE_GROUP[refinedRole] || null;
}

// Core baseline by class
const CORE_BASELINES = {
  frigate: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 },
  battleship: { 'Ferrite Alloy': 120, 'Crytite': 80, 'Ardanium': 60, 'Vornite': 50, 'Zerothium': 40 },
  capital: { 'Ferrite Alloy': 300, 'Crytite': 200, 'Ardanium': 160, 'Vornite': 140, 'Zerothium': 120 }
};

// Role modifiers (multiplicative factors applied to core amounts)
const ROLE_CORE_MODIFIERS = {
  'stealth-scout': { 'Ferrite Alloy': 0.8, 'Vornite': 1.2, 'Zerothium': 1.15, 'Crytite': 1.1, 'Ardanium': 0.9 },
  'brawler': { 'Ferrite Alloy': 1.2, 'Ardanium': 1.15, 'Zerothium': 0.9, 'Vornite': 0.9 },
  'sniper': { 'Vornite': 1.2, 'Crytite': 1.1, 'Ardanium': 0.9 },
  'interceptor': { 'Ferrite Alloy': 0.85, 'Crytite': 1.15, 'Zerothium': 1.15 },
  'assassin': { 'Vornite': 1.15, 'Crytite': 1.1, 'Ferrite Alloy': 0.9 },
  'miner': { 'Ferrite Alloy': 1.1, 'Crytite': 1.0, 'Vornite': 1.1 },
  'ecm': { 'Vornite': 1.25, 'Crytite': 1.15, 'Ferrite Alloy': 0.85 },
  'torpedo': { 'Ferrite Alloy': 1.05, 'Crytite': 1.1 },
  'courier': { 'Ferrite Alloy': 0.85, 'Crytite': 1.15, 'Zerothium': 1.15 },
  'stealth-strike': { 'Ferrite Alloy': 0.9, 'Vornite': 1.15, 'Zerothium': 1.1 },
  'boarding': { 'Ferrite Alloy': 1.0 },
  'miner-raider': { 'Ferrite Alloy': 1.05, 'Vornite': 1.05 },
  'ecm-torpedo': { 'Vornite': 1.2, 'Crytite': 1.1 },
  'escort': { 'Ferrite Alloy': 1.1, 'Ardanium': 1.05 },

  'siege': { 'Ferrite Alloy': 1.15, 'Crytite': 1.1 },
  'fortress': { 'Ferrite Alloy': 1.25, 'Ardanium': 1.2, 'Zerothium': 0.9 },
  'gunline': { 'Ferrite Alloy': 1.15 },
  'carrier': { 'Ferrite Alloy': 1.05, 'Crytite': 1.15 },
  'beam-destroyer': { 'Vornite': 1.15, 'Crytite': 1.1 },
  'torpedo-siege': { 'Ferrite Alloy': 1.1, 'Crytite': 1.1 },
  'ecm-fortress': { 'Vornite': 1.25, 'Crytite': 1.15 },
  'logistics': { 'Ferrite Alloy': 1.1, 'Crytite': 1.1, 'Vornite': 1.1 },
  'repair-tender': { 'Ferrite Alloy': 1.1 },
  'defensive-carrier': { 'Ferrite Alloy': 1.05 },
  'command-artillery': { 'Vornite': 1.15 },
  'siege-ecm': { 'Vornite': 1.2, 'Crytite': 1.1 },
  'logistics-fortress': { 'Ferrite Alloy': 1.2 },

  'freighter': { 'Ferrite Alloy': 1.2, 'Ardanium': 1.1 },
  'colony': { 'Ferrite Alloy': 1.1 },
  'transport': { 'Ferrite Alloy': 1.0 },
  'medical': { 'Ferrite Alloy': 1.0 },
  'deepcore-miner': { 'Ferrite Alloy': 1.2 },
  'gas-harvester': { 'Ferrite Alloy': 1.1 },
  'strip-miner': { 'Ferrite Alloy': 1.25 },
  'mining-command': { 'Ferrite Alloy': 1.1 },
  'salvage': { 'Ferrite Alloy': 1.15 },

  'supercarrier': { 'Ferrite Alloy': 1.2, 'Crytite': 1.2 },
  'dreadnought': { 'Ferrite Alloy': 1.3, 'Ardanium': 1.2 },
  'flagship-command': { 'Vornite': 1.2 },
  'heavy-shield': { 'Crytite': 1.2 },
  'stealth-battleship': { 'Vornite': 1.2, 'Zerothium': 1.15 },
  'mobile-shipyard': { 'Ferrite Alloy': 1.2 },
  'worldship': { 'Ferrite Alloy': 1.25 },
  'megafreighter': { 'Ferrite Alloy': 1.25 },
  'exploration': { 'Vornite': 1.15 },
  'fleet-anchor': { 'Ferrite Alloy': 1.25 },
  'planet-cracker': { 'Ferrite Alloy': 1.3 },
  'gas-refinery': { 'Ferrite Alloy': 1.15 },
  'prospecting-ark': { 'Vornite': 1.2 }
};

// Specialized total by class; distribute evenly across 1-3 required minerals
const SPECIALIZED_TOTAL = { frigate: 20, battleship: 100, capital: 300 };

function roundAndEnsurePositive(n) { return Math.max(1, Math.round(n)); }

function computeCoreRequirements(blueprint) {
  const base = CORE_BASELINES[blueprint.class];
  const mod = ROLE_CORE_MODIFIERS[blueprint.role] || {};
  const result = {};
  for (const [k, v] of Object.entries(base)) {
    const factor = mod[k] || 1.0;
    result[k] = roundAndEnsurePositive(v * factor);
  }
  return result;
}

function computeSpecializedRequirements(blueprint) {
  const total = SPECIALIZED_TOTAL[blueprint.class] || 0;
  const n = Math.max(1, blueprint.specialized.length);
  const per = Math.max(1, Math.floor(total / n));
  const req = {};
  blueprint.specialized.forEach((name, i) => {
    // Distribute remainder to first entries
    const extra = i < (total - per * n) ? 1 : 0;
    req[name] = per + extra;
  });
  return req;
}

function computeAllRequirements(blueprint) {
  return { core: computeCoreRequirements(blueprint), specialized: computeSpecializedRequirements(blueprint) };
}

module.exports = { SHIP_BLUEPRINTS, computeAllRequirements, getRefinedRole, getRefinedGroup };


