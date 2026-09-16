const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const { SectorGenerationPipeline } = require('../server/services/world/generation-pipeline');

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(error) { error ? reject(error) : resolve(this); }));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
let sectorId;

before(async () => {
    await db.ready;
    const userId = (await run("INSERT INTO users(username,password) VALUES('orbit-test','hash')")).lastID;
    const gameId = (await run("INSERT INTO games(name,status) VALUES('orbit-test','active')")).lastID;
    sectorId = (await run("INSERT INTO sectors(game_id,owner_id,name,archetype) VALUES(?,?,?,'asteroid-heavy')", [gameId, userId, 'Orbit Test'])).lastID;
    await new SectorGenerationPipeline(sectorId, {
        archetypeKey: 'asteroid-heavy', seedBase: 99173, gameId,
        player: { user_id: userId, username: 'orbit-test' }, createStartingObjects: true
    }).execute();
});

after(() => new Promise(resolve => db.close(resolve)));

test('pipeline persists authoritative rings with one planet on each ring', async () => {
    const rings = await all('SELECT * FROM orbital_rings WHERE sector_id = ? ORDER BY ring_index', [sectorId]);
    const planets = await all("SELECT id,x,y,meta FROM sector_objects WHERE sector_id = ? AND celestial_type='planet' ORDER BY id", [sectorId]);
    assert.equal(rings.length, planets.length);
    assert.ok(rings.length >= 5 && rings.length <= 7);
    rings.forEach((ring, index) => {
        assert.equal(ring.planet_object_id, planets[index].id);
        const actual = Math.hypot(planets[index].x - ring.center_x, planets[index].y - ring.center_y);
        assert.ok(Math.abs(actual - ring.radius) <= 1.5);
        const meta = JSON.parse(planets[index].meta);
        assert.equal(meta.orbitalRing, ring.ring_index);
        assert.equal(meta.orbitRadius, ring.radius);
    });
});

test('asteroid-heavy resources include dense hubs and diffuse pockets', async () => {
    const nodes = await all('SELECT parent_object_id,meta FROM resource_nodes WHERE sector_id = ?', [sectorId]);
    const types = nodes.map(node => JSON.parse(node.meta || '{}').fieldType);
    assert.ok(types.includes('asteroid-hub'));
    assert.ok(types.includes('diffuse-pocket'));
    assert.ok(nodes.some(node => node.parent_object_id != null));
    assert.ok(nodes.some(node => node.parent_object_id == null));
});

test('generation manifest records orbital geometry and version', async () => {
    const rows = await all('SELECT generator_version,manifest_json FROM generation_manifests WHERE sector_id = ?', [sectorId]);
    assert.equal(rows[0].generator_version, 'physical-scale-v1');
    const manifest = JSON.parse(rows[0].manifest_json);
    assert.equal(manifest.orbitalRings.length, (await all('SELECT 1 FROM orbital_rings WHERE sector_id = ?', [sectorId])).length);
    assert.equal(manifest.resourceProfileVersion, 'resource-profile-v2');
    assert.equal(manifest.resourceProfile.version, 'resource-profile-v2');
    assert.equal(manifest.resourceProfile.signatureMinerals.length, 2);
    assert.equal(manifest.resourceProfile.randomSpecialties.length, 5);
    assert.equal(manifest.resourceProfile.availableMinerals.length, 12);
    const generatedMinerals = await all(
        `SELECT DISTINCT rt.resource_name
           FROM resource_nodes rn
           JOIN resource_types rt ON rt.id = rn.resource_type_id
          WHERE rn.sector_id = ?`,
        [sectorId]
    );
    const generatedNames = new Set(generatedMinerals.map((row) => row.resource_name));
    assert.ok(manifest.resourceProfile.availableMinerals.every((mineral) => generatedNames.has(mineral)));
});
