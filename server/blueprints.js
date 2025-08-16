// Ship Blueprints: classes = 'frigate' | 'battleship' | 'capital'
// Roles include combat and logistics/industrial as roles, not classes

/** @typedef {{
 *  id:string,
 *  name:string,
 *  class:'frigate'|'battleship'|'capital',
 *  role:string,
 *  requirements: { core: Record<string, number>, specialized: Record<string, number> }
 * }} ShipBlueprint */

/** @type {ShipBlueprint[]} */
const SHIP_BLUEPRINTS = [
  // Frigates
  { id: 'explorer', name: 'Explorer', class: 'frigate', role: 'scout-recon', requirements: { core: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 }, specialized: { 'Spectrathene': 5, 'Auralite': 10 } } },
  { id: 'wraith-scout', name: 'Wraith Scout', class: 'frigate', role: 'scout-recon', requirements: { core: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 }, specialized: { 'Spectrathene': 5, 'Voidglass': 10 } } },
  { id: 'maul-brawler', name: 'Maul-Class Brawler Frigate', class: 'frigate', role: 'brawler', requirements: { core: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 }, specialized: { 'Starforged Carbon': 5, 'Oblivium': 5, 'Corvexite': 5 } } },
  { id: 'lance-sniper', name: 'Lance-Class Precision Sniper Frigate', class: 'frigate', role: 'sniper-siege', requirements: { core: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 }, specialized: { 'Auralite': 5, 'Quarzon': 5, 'Gravium': 5 } } },
  { id: 'viper-interceptor', name: 'Viper Interceptor', class: 'frigate', role: 'interceptor', requirements: { core: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 }, specialized: { 'Fluxium': 10, 'Tachytrium': 5 } } },
  { id: 'needle-gunship', name: 'Needle Gunship', class: 'frigate', role: 'sniper-siege', requirements: { core: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 }, specialized: { 'Auralite': 5, 'Quarzon': 5 } } },
  { id: 'drill-skiff', name: 'Drill Skiff', class: 'frigate', role: 'prospector-miner', requirements: { core: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 }, specialized: { 'Magnetrine': 15 } } },
  { id: 'shade-ecm', name: 'Shade ECM Frigate', class: 'frigate', role: 'ecm-disruption', requirements: { core: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 }, specialized: { 'Cryphos': 5, 'Nebryllium': 5 } } },
  { id: 'sting-torpedo', name: 'Sting Torpedo Boat', class: 'frigate', role: 'torpedo-missile', requirements: { core: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 }, specialized: { 'Quarzon': 5, 'Gravium': 5 } } },
  { id: 'swift-courier', name: 'Swift Courier', class: 'frigate', role: 'logistics', requirements: { core: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 }, specialized: { 'Tachytrium': 5, 'Fluxium': 5 } } },
  { id: 'raven-gunship-scout', name: 'Raven Gunship-Scout', class: 'frigate', role: 'scout-recon', requirements: { core: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 }, specialized: { 'Spectrathene': 5, 'Auralite': 5 } } },
  { id: 'mako-miner-raider', name: 'Mako Miner-Raider', class: 'frigate', role: 'prospector-miner', requirements: { core: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 }, specialized: { 'Magnetrine': 15, 'Nebryllium': 15 } } },
  { id: 'ghost-ecm-torpedo', name: 'Ghost ECM-Torpedo', class: 'frigate', role: 'ecm-disruption', requirements: { core: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 }, specialized: { 'Cryphos': 5, 'Gravium': 5 } } },
  { id: 'brute-frigate', name: 'Brute Frigate', class: 'frigate', role: 'brawler', requirements: { core: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 }, specialized: { 'Starforged Carbon': 5, 'Oblivium': 5, 'Corvexite': 5 } } },
  { id: 'longshot-sniper', name: 'Longshot Sniper Frigate', class: 'frigate', role: 'sniper-siege', requirements: { core: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 }, specialized: { 'Auralite': 5, 'Quarzon': 5, 'Gravium': 5 } } },

];

function computeAllRequirements(blueprint) {
  return (blueprint && blueprint.requirements) ? blueprint.requirements : { core: {}, specialized: {} };
}

module.exports = { SHIP_BLUEPRINTS, computeAllRequirements };

