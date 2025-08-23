import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { PATHS, FRAME } from './config.mjs';

// Usage: node tools/prepare-frame.mjs ships/explorer/base.png [size]
const relInput = process.argv[2];
const size = parseInt(process.argv[3] || String(FRAME), 10);

if (!relInput) {
    console.error('Usage: node tools/prepare-frame.mjs <relative input under art_src/> [size]');
    process.exit(1);
}

const inPath = path.join(PATHS.SRC, relInput);
const outPath = path.join(PATHS.WORK, relInput.replace(/\.png$/i, `_${size}.png`));

await fs.mkdir(path.dirname(outPath), { recursive: true });

const buf = await sharp(inPath)
    .resize(size, size, { fit: 'contain', withoutEnlargement: true, background: { r:0,g:0,b:0,alpha:0 } })
    .png()
    .toBuffer();

const glow = await sharp(buf).blur(1.2).modulate({ brightness: 1.05 }).toBuffer();
const merged = await sharp({
    create: { width: size, height: size, channels: 4, background: { r:0,g:0,b:0,alpha:0 } }
})
    .composite([{ input: glow, blend: 'over' }, { input: buf, blend: 'over' }])
    .png()
    .toBuffer();

await sharp(merged).png().toFile(outPath);
console.log('Prepared frame:', outPath);


