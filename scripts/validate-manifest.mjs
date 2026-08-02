import { lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version;
const firefoxBackground = [
  'shared/runtime.generated.js',
  'shared/browser.js',
  'background/service-worker.js'
];

function assertSafePath(root, relativePath, label) {
  if (
    typeof relativePath !== 'string' ||
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath.includes('\\') ||
    posix.normalize(relativePath) !== relativePath ||
    relativePath.startsWith('../')
  ) {
    throw new Error(`unsafe ${label} path: ${relativePath}`);
  }
  const filePath = join(root, relativePath);
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`${label} is not a regular file: ${relativePath}`);
  return filePath;
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`);
}

function popupReferences(root, popupPath) {
  const html = readFileSync(assertSafePath(root, popupPath, 'popup'), 'utf8');
  const references = [];
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
    const value = match[1];
    if (/^(?:[a-z]+:|#)/i.test(value)) continue;
    references.push(posix.normalize(posix.join(posix.dirname(popupPath), value)));
  }
  return references;
}

export async function validateManifest(root = projectRoot, target = 'source') {
  const manifestPath = assertSafePath(root, 'manifest.json', 'manifest');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3');
  if (manifest.version !== packageVersion) {
    throw new Error(`manifest version ${manifest.version} does not match package version ${packageVersion}`);
  }
  if ((manifest.description || '').length > 132)
    throw new Error('manifest description exceeds 132 characters');

  const iconEntries = Object.entries(manifest.icons || {});
  for (const [size, relativePath] of iconEntries) {
    const metadata = await sharp(assertSafePath(root, relativePath, 'icon')).metadata();
    if (metadata.width !== Number(size) || metadata.height !== Number(size)) {
      throw new Error(`icon dimensions do not match ${size}: ${relativePath}`);
    }
  }
  for (const relativePath of Object.values(manifest.action?.default_icon || {})) {
    assertSafePath(root, relativePath, 'action icon');
  }

  for (const entry of manifest.content_scripts || []) {
    if (entry.all_frames !== false) throw new Error('content scripts must be top-frame-only');
    assertUnique(entry.js || [], 'content script');
    assertUnique(entry.css || [], 'content stylesheet');
    for (const relativePath of entry.js || []) assertSafePath(root, relativePath, 'content script');
    for (const relativePath of entry.css || []) assertSafePath(root, relativePath, 'stylesheet');
  }

  const popupPath = manifest.action?.default_popup;
  if (!popupPath) throw new Error('missing action popup');
  for (const relativePath of popupReferences(root, popupPath)) {
    assertSafePath(root, relativePath, 'popup resource');
  }

  if (target === 'firefox') {
    if (manifest.background?.service_worker)
      throw new Error('Firefox target must not declare a service worker');
    if (JSON.stringify(manifest.background?.scripts) !== JSON.stringify(firefoxBackground)) {
      throw new Error('Firefox background scripts are missing or out of order');
    }
    if (!manifest.browser_specific_settings?.gecko || manifest.browser_specific_settings?.safari) {
      throw new Error('Firefox target must contain only Gecko browser settings');
    }
  } else {
    assertSafePath(root, manifest.background?.service_worker, 'service worker');
    if (manifest.background?.scripts) throw new Error(`${target} target must not declare background scripts`);
  }

  if (target === 'chrome') {
    if (manifest.browser_specific_settings)
      throw new Error('Chrome target contains browser-specific settings');
    if (manifest.minimum_chrome_version !== '109') throw new Error('Chrome minimum version must be 109');
  }
  if (target === 'safari') {
    if (!manifest.browser_specific_settings?.safari || manifest.browser_specific_settings?.gecko) {
      throw new Error('Safari target must contain only Safari browser settings');
    }
  }

  return manifest;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    const root = process.argv[2] ? resolve(process.argv[2]) : projectRoot;
    await validateManifest(root, process.argv[3] || 'source');
    console.log(`manifest validation passed (${process.argv[3] || 'source'})`);
  } catch (error) {
    console.error(`manifest validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
