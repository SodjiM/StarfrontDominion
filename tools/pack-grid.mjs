import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { PATHS, FRAME } from './config.mjs';

// Usage: node tools/pack-grid.mjs <shipKey>

const shipKey = process.argv[2];
if (!shipKey) {
    console.error('Usage: node tools/pack-grid.mjs <shipKey>');
    process.exit(1);
}

const srcFrames = path.join(PATHS.WORK, 'ships', shipKey, 'frames');
const outPng = path.join(PATHS.OUT_SHEETS, `${shipKey}.png`);
const outJson = path.join(PATHS.OUT_SHEETS, `${shipKey}.sheet.json`);

const FRAME_SIZE = FRAME;
const PADDING = 2;
const groups = ['idle', 'moving'];

const framesByGroup = {};
let maxCols = 0;
for (const g of groups) {
    const files = (await fs.readdir(srcFrames))
        .filter(f => f.startsWith(`${g}_`) && f.toLowerCase().endsWith('.png'))
        .sort((a,b)=>Number(a.match(/\d+/)?.[0]||0)-Number(b.match(/\d+/)?.[0]||0));
    framesByGroup[g] = files.map(f => path.join(srcFrames, f));
    if (files.length) maxCols = Math.max(maxCols, files.length);
}

const rows = groups.filter(g => framesByGroup[g] && framesByGroup[g].length > 0);
const W = maxCols * FRAME_SIZE + (maxCols + 1) * PADDING;
const H = rows.length * FRAME_SIZE + (rows.length + 1) * PADDING;

await fs.mkdir(path.dirname(outPng), { recursive: true });

const composites = [];
let rowIdx = 0;
const animations = {};

for (const g of rows) {
    const files = framesByGroup[g];
    animations[g] = { row: rowIdx, from: 0, to: files.length - 1, fps: g === 'moving' ? 10 : 6, loop: true };
    for (let col = 0; col < files.length; col++) {
        composites.push({
            input: await fs.readFile(files[col]),
            left: PADDING + col * (FRAME_SIZE + PADDING),
            top: PADDING + rowIdx * (FRAME_SIZE + PADDING)
        });
    }
    rowIdx++;
}

const sheet = sharp({ create: { width: W, height: H, channels: 4, background: { r:0,g:0,b:0,alpha:0 } }});
await sheet.composite(composites).png().toFile(outPng);

await fs.writeFile(outJson, JSON.stringify({
    image: outPng.replace(/^client\//, ''),
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
    padding: PADDING,
    animations
}, null, 2));

console.log('Packed sheet:', outPng);
console.log('Descriptor:', outJson);


