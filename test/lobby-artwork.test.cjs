const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Keep this coverage in-process: the route's artwork contract is backed by the
// repository and schema, so no HTTP listener (which is unavailable in some CI
// sandboxes) is needed to verify persistence and assignment.
process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const { GamesRepository, GAME_ARTWORK_KEYS } = require('../server/repositories/games.repo');

const repo = new GamesRepository();

before(async () => {
  await db.ready;
});

test('artwork catalog is a unique, finite whitelist and route validates it', () => {
  assert.equal(GAME_ARTWORK_KEYS.length, 5);
  assert.equal(new Set(GAME_ARTWORK_KEYS).size, GAME_ARTWORK_KEYS.length);
  assert.ok(GAME_ARTWORK_KEYS.every(key => /^[a-z0-9-]+$/.test(key)));

  const source = fs.readFileSync('server/routes/lobby.js', 'utf8');
  assert.match(source, /artworkKey\s*!=\s*null\s*&&\s*!GAME_ARTWORK_KEYS\.includes\(artworkKey\)/);
});

test('selected artwork is persisted and returned by list/detail repository reads', async () => {
  const selected = 'twin-dawn';
  const created = await repo.createGame({ name: 'Artwork persistence', mode: 'campaign', artworkKey: selected });
  assert.equal(created.artworkKey, selected);

  const listed = (await repo.listAllGames()).find(game => game.id === created.id);
  assert.equal(listed.artwork_key, selected);
  const detail = await repo.getGameById(created.id);
  assert.equal(detail.artwork_key, selected);
});

test('omitted artwork receives a valid catalog key and each assignment survives reread', async () => {
  const created = await repo.createGame({ name: 'Artwork default', mode: 'campaign' });
  assert.ok(GAME_ARTWORK_KEYS.includes(created.artworkKey));
  const reread = await repo.getGameById(created.id);
  assert.equal(reread.artwork_key, created.artworkKey);
});

test('repository rejects artwork keys outside the catalog', async () => {
  await assert.rejects(
    () => repo.createGame({ name: 'Invalid artwork', mode: 'campaign', artworkKey: 'not-a-real-frontier' }),
    error => error?.status === 400 && error.message === 'Invalid artwork key'
  );
});
