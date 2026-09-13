const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const catalog = require('../client/render/celestial-types');
const { pathToFileURL } = require('node:url');

test('celestial LOD chooses stable texture tiers from projected diameter', async () => {
    const lod = await import(pathToFileURL(require('node:path').resolve('client/render/celestial-lod.mjs')).href);
    assert.equal(lod.celestialLodForDiameter(0), 'thumbnail');
    assert.equal(lod.celestialLodForDiameter(56), 'thumbnail');
    assert.equal(lod.celestialLodForDiameter(57), 'tactical');
    assert.equal(lod.celestialLodForDiameter(220), 'tactical');
    assert.equal(lod.celestialLodForDiameter(221), 'close');
    assert.match(lod.atlasPathForLod('close'), /atlas-close\.png$/);
});

test('celestial classes preserve legacy metadata and remain stable across redraws', () => {
    assert.equal(catalog.resolve({ type: 'planet', meta: { planetType: 'superEarth' } }).key, 'ocean');
    assert.equal(catalog.resolve({ type: 'planet', meta: '{"type":"gas-giant"}' }).key, 'gasGiant');
    assert.equal(catalog.resolve({ type: 'sun', meta: { starType: 'redDwarf' } }).key, 'redDwarf');
    for (const family of ['planet', 'moon', 'star']) {
        const found = new Set();
        for (let id = 0; id < 100; id++) {
            const body = { id, type: family, x: id * 7, y: 5, meta: '{bad' };
            const a = catalog.resolve(body);
            assert.deepEqual(a, catalog.resolve(body));
            found.add(a.key);
        }
        assert.equal(found.size, catalog.families[family].length);
    }
    assert.equal(catalog.resolve({ type: 'ship' }), null);
});

test('ambient animation advances without input, pauses hidden/reduced, and disposes', () => {
    const listeners = new Map(), pending = new Map();
    let next = 0, renders = 0;
    const target = prefix => ({ addEventListener: (name, fn) => listeners.set(prefix + name, fn), removeEventListener: name => listeners.delete(prefix + name) });
    const doc = { ...target('doc:'), hidden: false };
    const media = { ...target('media:'), matches: false };
    const env = { ...target('win:'), document: doc, matchMedia: () => media,
        requestAnimationFrame: fn => { pending.set(++next, fn); return next; }, cancelAnimationFrame: id => pending.delete(id) };
    const game = { canvas: { isConnected: true }, render: () => renders++ };
    const context = { window: env };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('client/render/ambient-loop.js', 'utf8').replace('export function', 'function'), context);
    const stop = context.startAmbientLoop(game, env);
    const step = now => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(fn => fn(now)); };
    step(0); step(40); step(80);
    assert.equal(game.animationTime, 0.08); assert(renders >= 3);
    context.startAmbientLoop(game, env); assert.equal(pending.size, 1);
    doc.hidden = true; listeners.get('doc:visibilitychange')(); assert.equal(pending.size, 0);
    doc.hidden = false; listeners.get('doc:visibilitychange')(); assert.equal(pending.size, 1);
    media.matches = true; listeners.get('media:change')(); assert.equal(pending.size, 0); assert.equal(game.animationTime, 0);
    media.matches = false; listeners.get('media:change')(); assert.equal(pending.size, 1);
    game._stopAmbientLoop(); assert.equal(pending.size, 0); assert.equal(listeners.size, 0);
});

test('display size matches celestial radius, differentiates units, and picking favors visible ships', () => {
    const context = { physicalScale: require('../client/utils/physical-scale'), isCelestialObject: obj => ['sun', 'star', 'planet', 'moon'].includes(obj.celestial_type || obj.type) };
    vm.createContext(context);
    const source = fs.readFileSync('client/render/object-scale.js', 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export function', 'function');
    vm.runInContext(source, context);
    const size = context.objectDisplaySize;
    assert.equal(size({ type: 'planet', radius: 12 }, 20), 480);
    const scout = { id: 1, type: 'ship', x: 0, y: 0, meta: { shipType: 'swift-courier' } };
    const station = { type: 'station', meta: { class: 'planet-station' } };
    assert(size(station, 20) > size(scout, 20));
    assert(size(scout, 4) >= 42);
    const game = { tileSize: 20, camera: { x: 0, y: 0 }, canvas: { width: 800, height: 600 }, objects: [{ type: 'planet', radius: 12, x: 0, y: 0 }, scout] };
    assert.equal(context.pickMapObject(game, 418, 300).id, 1);
    assert.equal(context.pickMapObject(game, 700, 300), null);
});
