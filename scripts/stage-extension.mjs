import { execFileSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateManifest } from './validate-manifest.mjs';

export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const targets = new Set(['chrome', 'firefox', 'safari']);
const popupFiles = ['popup/popup.html', 'popup/popup.css', 'popup/popup.js'];

function clone(value) {
  return structuredClone(value);
}

export function createTargetManifest(source, target) {
  const manifest = clone(source);
  delete manifest.minimum_chrome_version;

  if (target === 'chrome') {
    manifest.minimum_chrome_version = '109';
    delete manifest.browser_specific_settings;
  } else if (target === 'firefox') {
    manifest.background = {
      scripts: ['shared/runtime.generated.js', 'shared/browser.js', 'background/service-worker.js']
    };
    manifest.browser_specific_settings = { gecko: clone(source.browser_specific_settings.gecko) };
  } else {
    manifest.browser_specific_settings = { safari: clone(source.browser_specific_settings.safari) };
  }

  return manifest;
}

function packageFiles(manifest) {
  const files = new Set(popupFiles);
  Object.values(manifest.icons || {}).forEach((file) => files.add(file));
  Object.values(manifest.action?.default_icon || {}).forEach((file) => files.add(file));
  manifest.content_scripts?.forEach((entry) => {
    entry.js?.forEach((file) => files.add(file));
    entry.css?.forEach((file) => files.add(file));
  });
  if (manifest.background?.service_worker) files.add(manifest.background.service_worker);
  manifest.background?.scripts?.forEach((file) => files.add(file));
  return [...files].sort();
}

function assertSupportedManifest(manifest) {
  const unsupportedResourceFields = [
    'default_locale',
    'declarative_net_request',
    'devtools_page',
    'options_page',
    'options_ui',
    'side_panel',
    'web_accessible_resources'
  ];
  for (const field of unsupportedResourceFields) {
    if (manifest[field] !== undefined) {
      throw new Error(`extension staging must be extended before using manifest.${field}`);
    }
  }
}

function assertSourceFile(relativePath) {
  const normalized = posix.normalize(relativePath);
  if (normalized !== relativePath || normalized.startsWith('../') || posix.isAbsolute(normalized)) {
    throw new Error(`unsafe package path: ${relativePath}`);
  }
  const sourcePath = join(projectRoot, relativePath);
  const stat = lstatSync(sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`package source is not a regular file: ${relativePath}`);
  return sourcePath;
}

export async function stageExtension(target) {
  if (!targets.has(target)) throw new Error(`unknown extension target: ${target}`);
  const sourceManifest = JSON.parse(readFileSync(join(projectRoot, 'manifest.json'), 'utf8'));
  assertSupportedManifest(sourceManifest);
  execFileSync(process.execPath, [join(projectRoot, 'scripts', 'build-runtime.mjs'), '--check'], {
    stdio: 'inherit'
  });
  execFileSync(process.execPath, [join(projectRoot, 'scripts', 'generate-icons.mjs'), '--check'], {
    stdio: 'inherit'
  });
  const manifest = createTargetManifest(sourceManifest, target);
  const stageDir = join(projectRoot, 'dist', 'stage', target);
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });

  for (const relativePath of packageFiles(manifest)) {
    const destination = join(stageDir, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(assertSourceFile(relativePath), destination);
  }
  writeFileSync(join(stageDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await validateManifest(stageDir, target);
  return stageDir;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    const stageDir = await stageExtension(process.argv[2]);
    console.log(`staged ${process.argv[2]} extension: ${stageDir}`);
  } catch (error) {
    console.error(`extension staging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
