import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

function fail(message) {
  console.error(`manifest validation failed: ${message}`);
  process.exit(1);
}

for (const size of Object.keys(manifest.icons || {})) {
  const iconPath = join(root, manifest.icons[size]);
  if (!existsSync(iconPath)) fail(`missing icon: ${manifest.icons[size]}`);
}

for (const entry of manifest.content_scripts || []) {
  for (const script of entry.js || []) {
    if (!existsSync(join(root, script))) fail(`missing content script: ${script}`);
  }
  for (const stylesheet of entry.css || []) {
    if (!existsSync(join(root, stylesheet))) fail(`missing stylesheet: ${stylesheet}`);
  }
}

if (!existsSync(join(root, manifest.background.service_worker))) {
  fail(`missing service worker: ${manifest.background.service_worker}`);
}

const MAX_DESCRIPTION_LENGTH = 132;
if (manifest.description?.length > MAX_DESCRIPTION_LENGTH) {
  fail(`manifest description is ${manifest.description.length} characters (max ${MAX_DESCRIPTION_LENGTH})`);
}

console.log('manifest validation passed');
