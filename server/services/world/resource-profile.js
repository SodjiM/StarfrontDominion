const { CORE_MINERALS, SPECIALTY_MINERALS } = require('./mineral-catalog');

const RESOURCE_PROFILE_VERSION = 'resource-profile-v2';

function uniqueKnownSpecialties(values) {
    const known = new Set(SPECIALTY_MINERALS);
    return [...new Set((values || []).filter((value) => known.has(value)))];
}

function shuffled(values, rng) {
    const result = values.slice();
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function createResourceProfile({ archetypeKey, signatureMinerals, rng, randomSpecialtyCount = 5 }) {
    if (typeof rng !== 'function') throw new TypeError('A deterministic RNG is required');

    const signatures = uniqueKnownSpecialties(signatureMinerals).slice(0, 2);
    if (signatures.length !== 2) {
        throw new Error(`Archetype ${archetypeKey || 'unknown'} must define exactly two known signature minerals`);
    }

    const available = SPECIALTY_MINERALS.filter((mineral) => !signatures.includes(mineral));
    const count = Math.max(0, Math.min(Number(randomSpecialtyCount) || 0, available.length));
    const randomSpecialties = shuffled(available, rng).slice(0, count);

    return Object.freeze({
        version: RESOURCE_PROFILE_VERSION,
        archetypeKey,
        coreMinerals: CORE_MINERALS.slice(),
        signatureMinerals: signatures,
        randomSpecialties,
        availableMinerals: [...CORE_MINERALS, ...signatures, ...randomSpecialties]
    });
}

module.exports = { RESOURCE_PROFILE_VERSION, createResourceProfile };
