import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'icons', 'logo.svg'));
const check = process.argv.includes('--check');

for (const size of [48, 96, 128, 256, 512, 1024]) {
  const iconPath = join(root, 'icons', `icon-${size}.png`);
  const generated = await sharp(svg).resize(size, size).png().toBuffer();
  if (check) {
    if (!generated.equals(readFileSync(iconPath))) {
      throw new Error(`${iconPath} is stale; run npm run icons`);
    }
  } else {
    writeFileSync(iconPath, generated);
  }
}

console.log(check ? 'icons are current' : 'icons generated');
