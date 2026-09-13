const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mulberry32, createRngStreams } = require('../server/services/world/rng');
const { plan } = require('../server/services/world/seeders/archetype-asteroid-heavy');
const { plan: binaryPlan } = require('../server/services/world/seeders/archetype-binary');
const { placeWithRetries, inBounds } = require('../server/services/world/placement');
const { applyOrbitalScaffold } = require('../server/services/world/orbital-scaffold');

function snapshot(seed) {
    const streams = createRngStreams(seed);
    const raw = plan({ sectorId: 1, seed, rng: streams.layout, streams });
    return applyOrbitalScaffold(raw, { archetypeKey: 'asteroid-heavy', streams });
}

test('named RNG streams are repeatable and independent', () => {
    const a = createRngStreams(42), b = createRngStreams(42);
    assert.equal(a.planets(), b.planets());
    assert.equal(a.resources(), b.resources());
    assert.notEqual(a.planets(), a.resources());
});

test('asteroid-heavy plans are deterministic but vary across seeds', () => {
    assert.deepEqual(snapshot(1234), snapshot(1234));
    const a = snapshot(1234), b = snapshot(5678);
    assert.notDeepEqual(a.planets, b.planets);
    assert.notDeepEqual(a.belts, b.belts);
    assert.ok(a.planets.length >= 5 && a.planets.length <= 7);
    assert.ok(a.belts.length >= 2 && a.belts.length <= 4);
    assert.ok(a.planets.every((p) => inBounds(p, undefined, 1)));
    assert.equal(a.orbitalRings.length, a.planets.length);
    a.planets.forEach((planet, index) => {
        const ring = a.orbitalRings[index];
        assert.ok(Math.abs(Math.hypot(planet.x - ring.centerX, planet.y - ring.centerY) - ring.radius) < 0.001);
    });
    assert.ok(a.orbitalRings.slice(1).every((ring, index) => ring.radius - a.orbitalRings[index].radius >= 260));
});

test('the universal orbital scaffold handles multi-star archetypes', () => {
    const streams = createRngStreams(8801);
    const raw = binaryPlan({ sectorId: 1, seed: 8801, rng: streams.layout, streams });
    const result = applyOrbitalScaffold(raw, { archetypeKey: 'binary', streams });

    assert.equal(result.orbitalRings.length, result.planets.length);
    assert.ok(result.orbitalRings.every((ring) => ring.centerX === 2500 && ring.centerY === 2500));
    result.planets.forEach((planet, index) => {
        const ring = result.orbitalRings[index];
        assert.equal(planet.orbitRingIndex, ring.ringIndex);
        assert.ok(Math.abs(Math.hypot(planet.x - ring.centerX, planet.y - ring.centerY) - ring.radius) < 0.001);
    });
});

test('placement retries enforce bounds and spacing', () => {
    const points = placeWithRetries({ rng: mulberry32(9), count: 6, minDistance: 10, sample: (rng) => ({ x: 100 + rng() * 300, y: 100 + rng() * 300 }) });
    assert.equal(points.length, 6);
    for (const point of points) assert.ok(inBounds(point));
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
        assert.ok(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) >= 10);
    }
});
