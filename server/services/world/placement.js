const { randFloat } = require('./rng');

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function inBounds(point, bounds = { width: 5000, height: 5000 }, margin = 0) {
    return point.x >= margin && point.y >= margin && point.x <= bounds.width - 1 - margin && point.y <= bounds.height - 1 - margin;
}

function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function isAvailable(point, placed, minDistance) {
    return placed.every((other) => distance(point, other) >= minDistance);
}

function samplePolar(rng, center, radiusMin, radiusMax, angleMin = 0, angleMax = Math.PI * 2) {
    const radius = randFloat(rng, radiusMin, radiusMax);
    const angle = randFloat(rng, angleMin, angleMax);
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
}

function placeWithRetries({ rng, count, bounds, existing = [], minDistance = 0, sample, maxAttempts = 100 }) {
    const placed = [...existing];
    const created = [];
    for (let i = 0; i < count; i++) {
        let candidate = null;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const raw = sample(rng, i, attempt);
            const point = { x: Math.round(raw.x), y: Math.round(raw.y) };
            if (inBounds(point, bounds, 1) && isAvailable(point, placed, minDistance)) {
                candidate = point;
                break;
            }
        }
        if (!candidate) throw new Error(`Unable to place object ${i + 1} after ${maxAttempts} attempts`);
        placed.push(candidate);
        created.push(candidate);
    }
    return created;
}

module.exports = { clamp, distance, inBounds, isAvailable, samplePolar, placeWithRetries };
