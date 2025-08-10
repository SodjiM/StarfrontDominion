// Ship Blueprints: classes = 'frigate' | 'battleship' | 'capital'
// Roles include combat and logistics/industrial as roles, not classes

/** @typedef {{id:string,name:string,class:'frigate'|'battleship'|'capital',role:string,specialized:string[]}} ShipBlueprint */

/** @type {ShipBlueprint[]} */
const SHIP_BLUEPRINTS = [
  // Frigates
  { id: 'wraith-scout', name: 'Wraith Scout', class: 'frigate', role: 'scout-recon', specialized: ['Spectrathene','Voidglass'] },
  { id: 'maul-brawler', name: 'Maul-Class Brawler Frigate', class: 'frigate', role: 'brawler', specialized: ['Starforged Carbon','Oblivium','Corvexite'] },
  { id: 'lance-sniper', name: 'Lance-Class Precision Sniper Frigate', class: 'frigate', role: 'sniper-siege', specialized: ['Auralite','Quarzon','Gravium'] },
  { id: 'viper-interceptor', name: 'Viper Interceptor', class: 'frigate', role: 'interceptor', specialized: ['Fluxium','Tachytrium'] },
  { id: 'needle-gunship', name: 'Needle Gunship', class: 'frigate', role: 'sniper-siege', specialized: ['Auralite','Quarzon'] },
  { id: 'drill-skiff', name: 'Drill Skiff', class: 'frigate', role: 'prospector-miner', specialized: ['Magnetrine'] },
  { id: 'shade-ecm', name: 'Shade ECM Frigate', class: 'frigate', role: 'ecm-disruption', specialized: ['Cryphos','Nebryllium'] },
  { id: 'sting-torpedo', name: 'Sting Torpedo Boat', class: 'frigate', role: 'torpedo-missile', specialized: ['Quarzon','Gravium'] },
  { id: 'swift-courier', name: 'Swift Courier', class: 'frigate', role: 'logistics', specialized: ['Tachytrium','Fluxium'] },
  { id: 'raven-gunship-scout', name: 'Raven Gunship-Scout', class: 'frigate', role: 'scout-recon', specialized: ['Spectrathene','Auralite'] },
  { id: 'jackal-boarder', name: 'Jackal Interceptor-Boarder', class: 'frigate', role: 'interceptor', specialized: ['Fluxium','Magnetrine'] },
  { id: 'mako-miner-raider', name: 'Mako Miner-Raider', class: 'frigate', role: 'prospector-miner', specialized: ['Magnetrine','Nebryllium'] },
  { id: 'ghost-ecm-torpedo', name: 'Ghost ECM-Torpedo', class: 'frigate', role: 'ecm-disruption', specialized: ['Cryphos','Gravium'] },
  { id: 'kite-patrol', name: 'Kite Patrol Frigate', class: 'frigate', role: 'escort', specialized: ['Luminite','Magnetrine'] },
  { id: 'brute-frigate', name: 'Brute Frigate', class: 'frigate', role: 'brawler', specialized: ['Starforged Carbon','Oblivium','Corvexite'] },
  { id: 'longshot-sniper', name: 'Longshot Sniper Frigate', class: 'frigate', role: 'sniper-siege', specialized: ['Auralite','Quarzon','Gravium'] },

  // Battleships
  { id: 'warhammer-siege', name: 'Warhammer Gunline-Siege', class: 'battleship', role: 'sniper-siege', specialized: ['Gravium','Drakonium'] },
  { id: 'bulwark-fortress', name: 'Bulwark Fortress', class: 'battleship', role: 'fortress', specialized: ['Oblivium','Luminite'] },
  { id: 'tempest-gunline', name: 'Tempest Gunline', class: 'battleship', role: 'heavy-assault', specialized: ['Quarzon','Drakonium'] },
  { id: 'cerberus-carrier', name: 'Cerberus Carrier-Battleship', class: 'battleship', role: 'carrier', specialized: ['Luminite','Heliox Ore'] },
  { id: 'leviathan-beam', name: 'Leviathan Beam Destroyer', class: 'battleship', role: 'sniper-siege', specialized: ['Auralite','Gravium'] },
  { id: 'tidebreaker-dreadnought', name: 'Tidebreaker Torpedo Dreadnought', class: 'battleship', role: 'torpedo-missile', specialized: ['Gravium','Tachytrium'] },
  { id: 'sentinel-ecm', name: 'Sentinel ECM Fortress', class: 'battleship', role: 'ecm-disruption', specialized: ['Cryphos','Nebryllium'] },
  { id: 'harbormaster-logistics', name: 'Harbormaster Logistics Command', class: 'battleship', role: 'logistics', specialized: ['Heliox Ore','Magnetrine'] },
  { id: 'atlas-tender', name: 'Atlas Fleet Tender', class: 'battleship', role: 'medical-repair', specialized: ['Heliox Ore','Luminite'] },
  { id: 'aegis-defensive-carrier', name: 'Aegis Defensive Carrier', class: 'battleship', role: 'escort', specialized: ['Luminite','Heliox Ore'] },
  { id: 'star-marshal', name: 'Star Marshal', class: 'battleship', role: 'command', specialized: ['Auralite','Quarzon'] },
  { id: 'specter-siege', name: 'Specter Siege', class: 'battleship', role: 'sniper-siege', specialized: ['Gravium','Nebryllium'] },
  { id: 'iron-anchor', name: 'Iron Anchor', class: 'battleship', role: 'fortress', specialized: ['Oblivium','Heliox Ore'] },
  { id: 'prometheus-beam-ecm', name: 'Prometheus Beam-ECM Hybrid', class: 'battleship', role: 'sniper-siege', specialized: ['Auralite','Gravium','Nebryllium'] },
  { id: 'olympus-mobile-shipyard', name: 'Olympus Mobile Shipyard', class: 'battleship', role: 'logistics', specialized: ['Magnetrine','Heliox Ore'] },

  // Logistics & Mining (as roles on battleship class per instruction)
  { id: 'atlas-heavy-freighter', name: 'Atlas Heavy Freighter', class: 'battleship', role: 'logistics', specialized: ['Starforged Carbon','Aurivex','Oblivium'] },
  { id: 'pioneer-colony-ship', name: 'Pioneer Colony Ship', class: 'battleship', role: 'colony-ship', specialized: ['Heliox Ore','Aurivex','Aetherium'] },
  { id: 'hermes-fleet-transport', name: 'Hermes Fleet Transport', class: 'battleship', role: 'logistics', specialized: ['Mythrion','Tachytrium','Aurivex'] },
  { id: 'bastion-medical-carrier', name: 'Bastion Medical & Crew Carrier', class: 'battleship', role: 'medical-repair', specialized: ['Heliox Ore'] },
  { id: 'goliath-deepcore-miner', name: 'Goliath Deepcore Miner', class: 'battleship', role: 'prospector-miner', specialized: ['Magnetrine'] },
  { id: 'leviathan-gas-harvester', name: 'Leviathan Gas Harvester', class: 'battleship', role: 'gas-harvester', specialized: ['Heliox Ore','Tachytrium'] },
  { id: 'colossus-strip-miner', name: 'Colossus Strip Miner', class: 'battleship', role: 'prospector-miner', specialized: ['Magnetrine','Drakonium'] },
  { id: 'prospector-command-ship', name: 'Prospector Command Ship', class: 'battleship', role: 'prospector-miner', specialized: ['Magnetrine','Auralite'] },
  { id: 'scarab-salvage-barge', name: 'Scarab Salvage Barge', class: 'battleship', role: 'salvage', specialized: ['Magnetrine','Oblivium'] },

  // Capitals (combat)
  { id: 'eclipse-supercarrier', name: 'Eclipse Supercarrier', class: 'capital', role: 'carrier', specialized: ['Luminite','Heliox Ore'] },
  { id: 'leviathan-dreadnought', name: 'Leviathan Dreadnought', class: 'capital', role: 'heavy-assault', specialized: ['Gravium','Oblivium'] },
  { id: 'aurora-flagship', name: 'Aurora Flagship', class: 'capital', role: 'flagship', specialized: ['Auralite','Quarzon'] },
  { id: 'nemesis-siege-platform', name: 'Nemesis Siege Platform', class: 'capital', role: 'sniper-siege', specialized: ['Gravium','Drakonium'] },
  { id: 'phalanx-heavy-shield', name: 'Phalanx Heavy Shield Ship', class: 'capital', role: 'fortress', specialized: ['Luminite','Oblivium'] },
  { id: 'eclipse-marauder', name: 'Phantom Dreadnought', class: 'capital', role: 'stealth-strike', specialized: ['Spectrathene','Voidglass'] },

  // Capitals (logistics & industrial roles)
  { id: 'colossus-mobile-shipyard', name: 'Colossus Mobile Shipyard', class: 'capital', role: 'logistics', specialized: ['Magnetrine','Heliox Ore'] },
  { id: 'oasis-worldship', name: 'Oasis Worldship', class: 'capital', role: 'logistics', specialized: ['Heliox Ore','Quarzon'] },
  { id: 'atlas-prime-megafreighter', name: 'Atlas Prime Megafreighter', class: 'capital', role: 'logistics', specialized: ['Heliox Ore','Tachytrium'] },
  { id: 'artemis-exploration-carrier', name: 'Artemis Exploration Carrier', class: 'capital', role: 'exploration', specialized: ['Auralite','Heliox Ore'] },
  { id: 'bastion-fleet-anchor', name: 'Bastion Fleet Anchor', class: 'capital', role: 'fortress', specialized: ['Oblivium','Luminite'] },
  { id: 'behemoth-planet-cracker', name: 'Behemoth Planet-Cracker', class: 'capital', role: 'prospector-miner', specialized: ['Magnetrine','Drakonium'] },
  { id: 'aether-gas-refinery', name: 'Aether Gas Refinery', class: 'capital', role: 'gas-harvester', specialized: ['Heliox Ore','Tachytrium'] },
  { id: 'auric-prospecting-ark', name: 'Auric Prospecting Ark', class: 'capital', role: 'prospector-miner', specialized: ['Auralite','Quarzon'] }
];


// Core baseline by class
const CORE_BASELINES = {
  frigate: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 },
  battleship: { 'Ferrite Alloy': 120, 'Crytite': 80, 'Ardanium': 60, 'Vornite': 50, 'Zerothium': 40 },
  capital: { 'Ferrite Alloy': 300, 'Crytite': 200, 'Ardanium': 160, 'Vornite': 140, 'Zerothium': 120 }
};

// Role modifiers (multiplicative factors applied to core amounts)
const ROLE_CORE_MODIFIERS = {
  // Refined roles
  'scout-recon': { 'Ferrite Alloy': 0.8, 'Vornite': 1.2, 'Zerothium': 1.15, 'Crytite': 1.1, 'Ardanium': 0.9 }, // was stealth-scout
  'brawler': { 'Ferrite Alloy': 1.2, 'Ardanium': 1.15, 'Zerothium': 0.9, 'Vornite': 0.9 },
  'sniper-siege': { 'Vornite': 1.2, 'Crytite': 1.1, 'Ardanium': 0.9 }, // was sniper
  'interceptor': { 'Ferrite Alloy': 0.85, 'Crytite': 1.15, 'Zerothium': 1.15 },
  'stealth-strike': { 'Ferrite Alloy': 0.9, 'Vornite': 1.15, 'Zerothium': 1.1 }, // was assassin/stealth-battleship
  'prospector-miner': { 'Ferrite Alloy': 1.1, 'Crytite': 1.0, 'Vornite': 1.1 }, // was miner
  'ecm-disruption': { 'Vornite': 1.25, 'Crytite': 1.15, 'Ferrite Alloy': 0.85 }, // was ecm
  'torpedo-missile': { 'Ferrite Alloy': 1.05, 'Crytite': 1.1 }, // was torpedo
  'logistics': { 'Ferrite Alloy': 1.1, 'Crytite': 1.1, 'Vornite': 1.1 },
  'escort': { 'Ferrite Alloy': 1.1, 'Ardanium': 1.05 },
  'command': { 'Vornite': 1.15 }, // was command-artillery
  'medical-repair': { 'Ferrite Alloy': 1.1 }, // was medical/repair-tender
  'colony-ship': { 'Ferrite Alloy': 1.1 }, // was colony
  'gas-harvester': { 'Ferrite Alloy': 1.1 }, // was gas-refinery
  'salvage': { 'Ferrite Alloy': 1.15 },
  'carrier': { 'Ferrite Alloy': 1.05, 'Crytite': 1.15 },
  'heavy-assault': { 'Ferrite Alloy': 1.3, 'Ardanium': 1.2 }, // was dreadnought
  'flagship': { 'Vornite': 1.2 }, // was flagship-command
  'fortress': { 'Ferrite Alloy': 1.25, 'Ardanium': 1.2, 'Zerothium': 0.9 },
  'exploration': { 'Vornite': 1.15 }
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

module.exports = { SHIP_BLUEPRINTS, computeAllRequirements };


