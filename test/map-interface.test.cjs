const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadGrid() {
  const code = fs.readFileSync('client/render/grid-renderer.js', 'utf8');
  const window = {};
  vm.runInNewContext(code, { window, localStorage: { getItem: () => null } });
  return window.SFRenderers.grid.drawGrid;
}

function canvas() {
  const strokes = [];
  const ctx = {
    lineWidth: 0, strokeStyle: '',
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() { strokes.push(this.strokeStyle); },
    createRadialGradient() { return { addColorStop() {} }; }
  };
  return { canvas: { width: 240, height: 160 }, ctx, strokes };
}

test('contextual grid is quiet without a focus point', () => {
  const drawGrid = loadGrid(); const c = canvas();
  drawGrid(c.ctx, c.canvas, { x: 2500.25, y: 2499.75 }, 20, { always: false });
  assert.equal(c.strokes.length, 0);
});

test('grid stays bounded, world aligned, and fades at the edge', () => {
  const drawGrid = loadGrid(); const c = canvas();
  drawGrid(c.ctx, c.canvas, { x: 2500.25, y: 2499.75 }, 20, { hoverWorld: { x: 2500, y: 2500 }, radiusTiles: 6 });
  assert.ok(c.strokes.length > 0 && c.strokes.length < 500);
  assert.ok(c.strokes.some(style => style && typeof style === 'object'));
});

test('always grid remains bounded at fractional camera coordinates', () => {
  const drawGrid = loadGrid(); const c = canvas();
  drawGrid(c.ctx, c.canvas, { x: 17.37, y: 21.91 }, 8, { always: true });
  assert.ok(c.strokes.length > 0 && c.strokes.length < 2000);
});

test('background cover fit preserves aspect ratio', () => {
  const source = fs.readFileSync('client/render/system-background.js', 'utf8')
    .replace(/export function /g, 'function ')
    .replace(/\(function \(\) \{[\s\S]*?\}\)\(\);\s*$/, '');
  const sandbox = {}; vm.runInNewContext(`${source}; this.coverRect = coverRect;`, sandbox);
  for (const [sw, sh, w, h] of [[1600, 900, 300, 300], [900, 1600, 300, 300], [1200, 800, 800, 300]]) {
    const [, , dw, dh] = sandbox.coverRect(sw, sh, w, h);
    assert.ok(Math.abs(dw / dh - sw / sh) < 1e-9);
  }
});

test('minimap discovery never mistakes the game canvas for a minimap', () => {
  const source = fs.readFileSync('client/game.js', 'utf8');
  const start = source.indexOf('    ensureMiniCanvasRef() {');
  const end = source.indexOf('\n    connectSocket()', start);
  assert.ok(start > 0 && end > start);
  const method = source.slice(start, end).replace(/^    ensureMiniCanvasRef\(\) \{/, 'function ensureMiniCanvasRef() {');
  class FakeCanvas { getContext() { return {}; } }
  const main = new FakeCanvas();
  const elements = new Map([['gameCanvas', main]]);
  const sandbox = {
    HTMLCanvasElement: FakeCanvas,
    document: { getElementById(id) { return elements.get(id) || null; } }
  };
  vm.runInNewContext(`${method}; this.ensureMiniCanvasRef = ensureMiniCanvasRef;`, sandbox);
  let bindCount = 0;
  const game = { miniCanvas: null, miniCtx: null, bindMiniMapInteractions() { bindCount++; } };
  sandbox.ensureMiniCanvasRef.call(game);
  assert.equal(game.miniCanvas, null);
  assert.equal(bindCount, 0);

  const mini = new FakeCanvas(); elements.set('miniCanvas', mini);
  sandbox.ensureMiniCanvasRef.call(game);
  assert.equal(game.miniCanvas, mini);
  assert.deepEqual(game.miniCtx, {});
  assert.equal(bindCount, 1);
});

test('strategic map exposes active incidents in both canvas and accessible briefing UI', () => {
  const source = fs.readFileSync('client/ui/map-modal.js', 'utf8');
  assert.match(source, /id="mapIncidents"/);
  assert.match(source, /aria-label="Active regional incidents"/);
  assert.match(source, /Unresolved: −\$\{incident\.healthLoss\} regional health/);
  assert.match(source, /move \$\{roleLabel\} to \(\$\{Number\(target\.x\)\}, \$\{Number\(target\.y\)\}\)/);
  assert.match(source, /incident\.resolution\.target\.x/);
  assert.doesNotMatch(source, /Commit selected courier|Cancel response|beginIncidentResponse|cancelIncidentResponse/);
  assert.match(source, /ctx\.fillText\('!', x, y\)/);
});
