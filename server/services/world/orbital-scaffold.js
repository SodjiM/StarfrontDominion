const { randFloat, randInt, choice } = require('./rng');

const DEFAULT_BIAS = { inner: [480, 760], spacing: [250, 560], outerMax: 2380 };
const ARCHETYPE_BIASES = {
    'asteroid-heavy': { inner: [520, 820], spacing: [260, 610], outerMax: 2380 },
    wormhole: { inner: [430, 680], spacing: [220, 500], outerMax: 2300 },
    binary: { inner: [720, 980], spacing: [300, 620], outerMax: 2350 },
    solar: { inner: [390, 620], spacing: [220, 470], outerMax: 2250 },
    'dark-nebula': { inner: [560, 900], spacing: [280, 650], outerMax: 2380 }
};

function systemCenter(plan) {
    if (Array.isArray(plan.suns) && plan.suns.length) {
        return {
            x: plan.suns.reduce((sum, sun) => sum + Number(sun.x || 0), 0) / plan.suns.length,
            y: plan.suns.reduce((sum, sun) => sum + Number(sun.y || 0), 0) / plan.suns.length
        };
    }
    return { x: Number(plan.sun?.x ?? 2500), y: Number(plan.sun?.y ?? 2500) };
}

function generateRadii(rng, count, bias) {
    const firstMax = Math.max(bias.inner[0], Math.min(bias.inner[1], bias.outerMax - (count - 1) * bias.spacing[0]));
    const radii = [randInt(rng, bias.inner[0], firstMax)];
    for (let i = 1; i < count; i++) {
        const ringsLeft = count - i - 1;
        const room = bias.outerMax - radii[i - 1] - ringsLeft * bias.spacing[0];
        const maxSpacing = Math.max(bias.spacing[0], Math.min(bias.spacing[1], room));
        radii.push(radii[i - 1] + randInt(rng, bias.spacing[0], maxSpacing));
    }
    return radii;
}

function planetType(rng, radius, outerMax) {
    const ratio = radius / outerMax;
    if (ratio < 0.38) return choice(rng, ['rocky', 'rocky', 'superEarth']);
    if (ratio > 0.76) return choice(rng, ['gasGiant', 'iceWorld', 'iceWorld']);
    return choice(rng, ['rocky', 'superEarth', 'gasGiant', 'iceWorld']);
}

function applyOrbitalScaffold(plan, { archetypeKey = 'standard', streams }) {
    const layoutRng = streams.orbits || streams.layout;
    const planetRng = streams.planets;
    const moonRng = streams.moons;
    const bias = { ...DEFAULT_BIAS, ...(ARCHETYPE_BIASES[archetypeKey] || {}) };
    const center = systemCenter(plan);
    const count = Math.max(3, Math.min(8, Number(plan.planets?.length || randInt(layoutRng, 4, 7))));
    const radii = generateRadii(layoutRng, count, bias);
    const rings = radii.map((radius, index) => ({
        index,
        centerX: Math.round(center.x),
        centerY: Math.round(center.y),
        radius,
        width: randInt(layoutRng, 24, 58)
    }));
    const sourcePlanets = Array.from({ length: count }, (_, index) => plan.planets?.[index] || { id: `P${index}` });
    const planets = sourcePlanets.map((source, index) => {
        const ring = rings[index];
        const angle = randFloat(planetRng, 0, Math.PI * 2);
        const type = source.type || planetType(planetRng, ring.radius, bias.outerMax);
        const moonCount = type === 'gasGiant' ? randInt(moonRng, 2, 4) : randInt(moonRng, 0, 2);
        const moons = Array.from({ length: moonCount }, (_, moonIndex) => ({
            id: `${source.id || `P${index}`}-M${moonIndex}`,
            distance: randInt(moonRng, type === 'gasGiant' ? 34 : 24, type === 'gasGiant' ? 62 : 46),
            angle: randFloat(moonRng, 0, Math.PI * 2)
        }));
        return {
            ...source,
            x: ring.centerX + Math.cos(angle) * ring.radius,
            y: ring.centerY + Math.sin(angle) * ring.radius,
            type,
            ringIndex: ring.index,
            orbitRadius: ring.radius,
            orbitAngle: angle,
            moons
        };
    });
    return { ...plan, orbitalRings: rings, planets };
}

async function persistOrbitalScaffold({ db, sectorId, plan }) {
    if (!Array.isArray(plan.orbitalRings)) return;
    await new Promise((resolve, reject) => db.run('DELETE FROM orbital_rings WHERE sector_id = ?', [sectorId], (e) => e ? reject(e) : resolve()));
    const planetRows = await new Promise((resolve, reject) => db.all(
        `SELECT id, meta FROM sector_objects WHERE sector_id = ? AND celestial_type = 'planet' ORDER BY id`,
        [sectorId], (e, rows) => e ? reject(e) : resolve(rows || [])
    ));
    for (let i = 0; i < plan.orbitalRings.length; i++) {
        const ring = plan.orbitalRings[i];
        const planet = plan.planets[i];
        const row = planetRows[i] || null;
        if (row && planet) {
            let meta = {}; try { meta = JSON.parse(row.meta || '{}'); } catch {}
            Object.assign(meta, { planetType: planet.type, orbitalRing: ring.index, orbitRadius: ring.radius, orbitAngle: planet.orbitAngle });
            await new Promise((resolve, reject) => db.run('UPDATE sector_objects SET meta = ? WHERE id = ?', [JSON.stringify(meta), row.id], (e) => e ? reject(e) : resolve()));
            const children = await new Promise((resolve, reject) => db.get('SELECT COUNT(1) AS c FROM sector_objects WHERE parent_object_id = ? AND celestial_type = "moon"', [row.id], (e, value) => e ? reject(e) : resolve(Number(value?.c || 0))));
            if (children === 0) {
                for (const moon of planet.moons || []) {
                    const x = Math.round(planet.x + Math.cos(moon.angle) * moon.distance);
                    const y = Math.round(planet.y + Math.sin(moon.angle) * moon.distance);
                    const metaMoon = JSON.stringify({ name: moon.id, celestial: true, scannable: true, alwaysKnown: 1, orbitRadius: moon.distance, orbitAngle: moon.angle });
                    await new Promise((resolve, reject) => db.run(
                        `INSERT INTO sector_objects (sector_id, type, celestial_type, x, y, owner_id, meta, radius, parent_object_id)
                         VALUES (?, 'moon', 'moon', ?, ?, NULL, ?, 6, ?)`,
                        [sectorId, x, y, metaMoon, row.id], (e) => e ? reject(e) : resolve()
                    ));
                }
            }
        }
        await new Promise((resolve, reject) => db.run(
            `INSERT INTO orbital_rings (sector_id, ring_index, center_x, center_y, radius, width, planet_object_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [sectorId, ring.index, ring.centerX, ring.centerY, ring.radius, ring.width, row?.id || null], (e) => e ? reject(e) : resolve()
        ));
    }
}

module.exports = { applyOrbitalScaffold, persistOrbitalScaffold, generateRadii };
