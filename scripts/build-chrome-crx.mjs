import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const defaultKey = join(root, 'store', 'signing', 'privatekey.pem');
const keyPath = process.env.BYEBAR_CRX_PRIVATE_KEY || defaultKey;

const include = ['manifest.json', 'icons', 'popup', 'content', 'background', 'shared'];

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    'google-chrome',
    'chromium',
    'chromium-browser'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes('/') ? existsSync(candidate) : true) {
      try {
        execSync(`"${candidate}" --version`, { stdio: 'ignore' });
        return candidate;
      } catch {
        /* try next */
      }
    }
  }

  return null;
}

if (!existsSync(keyPath)) {
  console.error(`missing signing key: ${keyPath}`);
  console.error('Generate one with:');
  console.error(
    '  mkdir -p store/signing && openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out store/signing/privatekey.pem'
  );
  console.error('Public key for the dashboard:');
  console.error('  openssl rsa -in store/signing/privatekey.pem -pubout');
  process.exit(1);
}

execSync('node scripts/validate-manifest.mjs', { cwd: root, stdio: 'inherit' });

const chrome = findChrome();
if (!chrome) {
  console.error('Chrome not found. Set CHROME_PATH to your Chrome executable.');
  process.exit(1);
}

const stageDir = mkdtempSync(join(tmpdir(), 'byebar-crx-'));
const packRoot = join(stageDir, 'byebar');
mkdirSync(packRoot, { recursive: true });

for (const item of include) {
  cpSync(join(root, item), join(packRoot, item), { recursive: true });
}

const quotedChrome = chrome.includes(' ') ? `"${chrome}"` : chrome;
const quotedRoot = `"${packRoot}"`;
const quotedKey = `"${keyPath}"`;

execSync(`${quotedChrome} --pack-extension=${quotedRoot} --pack-extension-key=${quotedKey}`, {
  stdio: 'inherit',
  shell: true
});

const packedCrx = `${packRoot}.crx`;
const packedPem = `${packRoot}.pem`;

if (!existsSync(packedCrx)) {
  console.error('pack failed: CRX not produced');
  process.exit(1);
}

mkdirSync(distDir, { recursive: true });
const outCrx = join(distDir, 'byebar-chrome.crx');
cpSync(packedCrx, outCrx);

rmSync(stageDir, { recursive: true, force: true });
rmSync(packedCrx, { force: true });
if (existsSync(packedPem)) rmSync(packedPem, { force: true });

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
console.log(`signed chrome package: ${outCrx}`);
console.log(`version: ${manifest.version}`);
console.log(`signed with: ${keyPath}`);
