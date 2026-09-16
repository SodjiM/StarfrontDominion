const CORE_MINERALS = Object.freeze([
    'Ferrite Alloy',
    'Crytite',
    'Ardanium',
    'Vornite',
    'Zerothium'
]);

// This is the current design asset, not a promise that the final game will
// retain all twenty-five specialties. Keeping the roster in one module makes
// the later role review independent from world-generation code.
const SPECIALTY_MINERALS = Object.freeze([
    'Spectrathene',
    'Auralite',
    'Gravium',
    'Fluxium',
    'Corvexite',
    'Voidglass',
    'Heliox Ore',
    'Neurogel',
    'Phasegold',
    'Kryon Dust',
    'Riftstone',
    'Solarite',
    'Mythrion',
    'Drakonium',
    'Aetherium',
    'Tachytrium',
    'Oblivium',
    'Luminite',
    'Cryphos',
    'Pyronex',
    'Nebryllium',
    'Magnetrine',
    'Quarzon',
    'Starforged Carbon',
    'Aurivex'
]);

module.exports = { CORE_MINERALS, SPECIALTY_MINERALS };
