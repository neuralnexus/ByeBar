import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const families = [
  {
    source: 'logo.svg',
    prefix: 'icon',
    canvas: 128,
    sizes: [16, 32, 48, 64, 96, 128, 256, 512, 1024]
  },
  {
    source: 'toolbar.svg',
    prefix: 'toolbar',
    canvas: 64,
    sizes: [16, 24, 32, 48, 64]
  }
];

function assertHermeticSvg(relativePath, source) {
  if (/<(?:image|script)\b|\b@import\b/i.test(source)) {
    throw new Error(`${relativePath} must not embed active or external resources`);
  }
  for (const match of source.matchAll(/\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi)) {
    if (!match[2].trim().startsWith('#')) {
      throw new Error(`${relativePath} must not reference external resources`);
    }
  }
  for (const match of source.matchAll(/\burl\(([^)]*)\)/gi)) {
    const value = match[1]
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2')
      .trim();
    if (!value.startsWith('#')) {
      throw new Error(`${relativePath} must not reference external resources`);
    }
  }
}

async function readSource({ source, canvas }) {
  const relativePath = `icons/${source}`;
  const svg = readFileSync(join(root, relativePath));
  assertHermeticSvg(relativePath, svg.toString('utf8'));
  const metadata = await sharp(svg).metadata();
  if (metadata.width !== metadata.height || metadata.width !== canvas) {
    throw new Error(`${relativePath} must use a ${canvas}x${canvas} square canvas`);
  }
  return svg;
}

function writeOrCheck(path, bytes) {
  if (check) {
    if (!bytes.equals(readFileSync(path))) throw new Error(`${path} is stale; run npm run icons`);
  } else {
    writeFileSync(path, bytes);
  }
}

let brandSvg;
let docsIcon;
for (const family of families) {
  const svg = await readSource(family);
  if (family.prefix === 'icon') brandSvg = svg;
  for (const size of family.sizes) {
    const iconPath = join(root, 'icons', `${family.prefix}-${size}.png`);
    const generated = await sharp(svg)
      .resize(size, size, { fit: 'contain' })
      .toColorspace('srgb')
      .png({ compressionLevel: 9 })
      .toBuffer();
    writeOrCheck(iconPath, generated);
    if (family.prefix === 'icon' && size === 128) docsIcon = generated;
  }
}

writeOrCheck(join(root, 'docs', 'logo.svg'), brandSvg);
writeOrCheck(join(root, 'docs', 'icon-128.png'), docsIcon);

console.log(check ? 'icons are current' : 'icons generated');
