const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRngStreams } = require('../server/services/world/rng');
const { CORE_MINERALS, SPECIALTY_MINERALS } = require('../server/services/world/mineral-catalog');
const { createResourceProfile, RESOURCE_PROFILE_VERSION } = require('../server/services/world/resource-profile');
const { getArchetypeContract, getArchetypeInfo } = require('../server/services/world/unified-archetype-registry');

function profile(seed, key = 'asteroid-heavy') {
    const contract = getArchetypeContract(key);
    return createResourceProfile({
        archetypeKey: contract.key,
        signatureMinerals: contract.signatureMinerals,
        randomSpecialtyCount: contract.randomSpecialtyCount,
        rng: createRngStreams(seed).resourceProfile
    });
}

test('resource profile contains all cores, two signatures, and five distinct random specialties', () => {
    const result = profile(99173);
    assert.equal(result.version, RESOURCE_PROFILE_VERSION);
    assert.deepEqual(result.coreMinerals, CORE_MINERALS);
    assert.equal(result.signatureMinerals.length, 2);
    assert.equal(result.randomSpecialties.length, 5);
    assert.equal(new Set(result.randomSpecialties).size, 5);
    assert.ok(result.randomSpecialties.every((mineral) => SPECIALTY_MINERALS.includes(mineral)));
    assert.ok(result.randomSpecialties.every((mineral) => !result.signatureMinerals.includes(mineral)));
    assert.equal(result.availableMinerals.length, 12);
});

test('resource profile is deterministic without coupling to placement RNG', () => {
    const firstStreams = createRngStreams(4401);
    firstStreams.resources();
    firstStreams.resources();
    const first = createResourceProfile({
        archetypeKey: 'wormhole',
        signatureMinerals: ['Riftstone', 'Phasegold'],
        rng: firstStreams.resourceProfile
    });
    const second = profile(4401, 'wormhole');
    assert.deepEqual(first, second);
    assert.notDeepEqual(profile(4402, 'wormhole').randomSpecialties, second.randomSpecialties);
});

test('archetype contract exposes lifecycle and resource-generation metadata', () => {
    const asteroid = getArchetypeInfo('ASTBELT');
    const forgeyard = getArchetypeInfo('forgeyard');
    assert.equal(asteroid.lifecycle, 'prototype');
    assert.equal(asteroid.recommendedForPrototype, true);
    assert.equal(asteroid.signatureMinerals.length, 2);
    assert.equal(asteroid.randomSpecialtyCount, 5);
    assert.equal(forgeyard.lifecycle, 'legacy');
});

test('resource profiles reject incomplete or unknown signature definitions', () => {
    assert.throws(() => createResourceProfile({ archetypeKey: 'broken', signatureMinerals: ['Fluxium'], rng: () => 0.5 }), /exactly two/);
    assert.throws(() => createResourceProfile({ archetypeKey: 'broken', signatureMinerals: ['Fluxium', 'Not A Mineral'], rng: () => 0.5 }), /exactly two/);
});
