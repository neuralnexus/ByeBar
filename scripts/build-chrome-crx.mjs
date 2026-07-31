import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { projectRoot, stageExtension } from './stage-extension.mjs';
import { validatePackage } from './validate-package.mjs';

const distDir = join(projectRoot, 'dist');
const defaultKey = join(projectRoot, 'store', 'signing', 'privatekey.pem');
const keyPath = process.env.BYEBAR_CRX_PRIVATE_KEY || defaultKey;
const version = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version;

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
    if (candidate.includes('/') && !existsSync(candidate)) continue;
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      /* try next executable */
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
  process.exit(1);
}

const chrome = findChrome();
if (!chrome) {
  console.error('Chrome not found. Set CHROME_PATH to your Chrome executable.');
  process.exit(1);
}

const stageDir = await stageExtension('chrome');
const tempDir = mkdtempSync(join(tmpdir(), 'byebar-crx-'));
const packRoot = join(tempDir, 'byebar');
const packedCrx = `${packRoot}.crx`;
const packedPem = `${packRoot}.pem`;

try {
  cpSync(stageDir, packRoot, { recursive: true });
  execFileSync(chrome, [`--pack-extension=${packRoot}`, `--pack-extension-key=${keyPath}`], {
    stdio: 'inherit'
  });
  if (!existsSync(packedCrx)) throw new Error('pack failed: CRX not produced');

  const header = readFileSync(packedCrx);
  if (
    header.length <= 12 ||
    header.subarray(0, 4).toString('ascii') !== 'Cr24' ||
    header.readUInt32LE(4) !== 3
  ) {
    throw new Error('pack failed: output is not a valid CRX3 file');
  }
  const crxHeaderLength = header.readUInt32LE(8);
  const zipOffset = 12 + crxHeaderLength;
  if (crxHeaderLength === 0 || zipOffset >= header.length) {
    throw new Error('pack failed: CRX3 header length is invalid');
  }
  const embeddedZip = join(tempDir, 'embedded.zip');
  writeFileSync(embeddedZip, header.subarray(zipOffset));
  await validatePackage(embeddedZip, stageDir);

  mkdirSync(distDir, { recursive: true });
  const outCrx = join(distDir, `byebar-chrome-${version}.crx`);
  cpSync(packedCrx, outCrx);
  const sha256 = createHash('sha256').update(header).digest('hex');
  writeFileSync(`${outCrx}.sha256`, `${sha256}  ${basename(outCrx)}\n`);
  console.log(`signed chrome package: ${outCrx}`);
  console.log(`version: ${version}`);
  console.log(`signed with: ${keyPath}`);
  console.log(`sha256: ${sha256}`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(packedCrx, { force: true });
  rmSync(packedPem, { force: true });
}
