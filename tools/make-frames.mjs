import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { PATHS, FRAME } from './config.mjs';

// Usage: node tools/make-frames.mjs <shipKey>
// Expects:
//   assets_work/ships/<shipKey>/base_64.png (or _<FRAME>.png)
//   art_src/fx/engine_small/*.png (ordered frames)

const shipKey = process.argv[2];
if (!shipKey) {
    console.error('Usage: node tools/make-frames.mjs <shipKey>');
    process.exit(1);
}

const hullPath = path.join(PATHS.WORK, 'ships', shipKey, `base_${FRAME}.png`);
const fxDir = path.join(PATHS.SRC, 'fx', 'engine_small');
const outDir = path.join(PATHS.WORK, 'ships', shipKey, 'frames');

await fs.mkdir(outDir, { recursive: true });

const fxFiles = (await fs.readdir(fxDir)).filter(f => f.toLowerCase().endsWith('.png')).sort();

let i = 0;
for (const f of fxFiles.slice(0, 3)) {
    await sharp(hullPath).composite([{ input: path.join(fxDir, f), blend: 'screen' }]).png()
        .toFile(path.join(outDir, `idle_${i++}.png`));
}

i = 0;
for (const f of fxFiles) {
    await sharp(hullPath).composite([{ input: path.join(fxDir, f), blend: 'screen' }]).png()
        .toFile(path.join(outDir, `moving_${i++}.png`));
}

console.log('Frames written to', outDir);


