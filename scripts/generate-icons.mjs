import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'icons', 'logo.svg'));
const check = process.argv.includes('--check');
const sizes = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024];

const source = svg.toString('utf8');
if (/<(?:image|script)\b|\b(?:href|src)=["'](?!#)/i.test(source)) {
  throw new Error('icons/logo.svg must not reference external resources');
}
const metadata = await sharp(svg).metadata();
if (metadata.width !== metadata.height || metadata.width !== 128) {
  throw new Error('icons/logo.svg must use a 128x128 square canvas');
}

function writeOrCheck(path, bytes) {
  if (check) {
    if (!bytes.equals(readFileSync(path))) throw new Error(`${path} is stale; run npm run icons`);
  } else {
    writeFileSync(path, bytes);
  }
}

let docsIcon;
for (const size of sizes) {
  const iconPath = join(root, 'icons', `icon-${size}.png`);
  const generated = await sharp(svg)
    .resize(size, size, { fit: 'contain' })
    .toColorspace('srgb')
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeOrCheck(iconPath, generated);
  if (size === 128) docsIcon = generated;
}

writeOrCheck(join(root, 'docs', 'logo.svg'), svg);
writeOrCheck(join(root, 'docs', 'icon-128.png'), docsIcon);

console.log(check ? 'icons are current' : 'icons generated');
