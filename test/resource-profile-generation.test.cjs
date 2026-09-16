const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const { SectorGenerationPipeline } = require('../server/services/world/generation-pipeline');

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(error) { error ? reject(error) : resolve(this); }));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));

let userId;
let gameId;

before(async () => {
    await db.ready;
    userId = (await run("INSERT INTO users(username,password) VALUES('profile-test','hash')")).lastID;
    gameId = (await run("INSERT INTO games(name,status) VALUES('profile-test','active')")).lastID;
});

after(() => new Promise((resolve) => db.close(resolve)));

test('non-belt, fallback, and legacy archetypes persist their complete resource profiles', async () => {
    for (const archetype of ['dark-nebula', 'standard', 'forgeyard']) {
        const sectorId = (await run(
            'INSERT INTO sectors(game_id,owner_id,name,archetype) VALUES(?,?,?,?)',
            [gameId, userId, archetype, archetype]
        )).lastID;
        await new SectorGenerationPipeline(sectorId, {
            archetypeKey: archetype,
            seedBase: 73001,
            gameId,
            player: { user_id: userId, username: 'profile-test' },
            createStartingObjects: false
        }).execute();

        const manifestRow = await get('SELECT manifest_json FROM generation_manifests WHERE sector_id = ?', [sectorId]);
        const manifest = JSON.parse(manifestRow.manifest_json);
        assert.equal(manifest.resourceProfileVersion, 'resource-profile-v2');
        assert.equal(manifest.resourceProfile.signatureMinerals.length, 2);
        assert.equal(manifest.resourceProfile.randomSpecialties.length, 5);

        const nodeRows = await all(
            `SELECT DISTINCT rt.resource_name
               FROM resource_nodes rn
               JOIN resource_types rt ON rt.id = rn.resource_type_id
              WHERE rn.sector_id = ? AND rn.is_depleted = 0`,
            [sectorId]
        );
        const nodeMinerals = new Set(nodeRows.map((row) => row.resource_name));
        assert.ok(
            manifest.resourceProfile.availableMinerals.every((mineral) => nodeMinerals.has(mineral)),
            `${archetype} omitted a generated profile mineral`
        );
    }
});
