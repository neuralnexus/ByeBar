import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'icons', 'logo.svg'));

for (const size of [48, 96, 128, 256, 512]) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(join(root, 'icons', `icon-${size}.png`));
}

console.log('icons generated');
