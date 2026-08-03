import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildValidatedFile } from './artifact-output.mjs';
import { projectRoot, stageExtension } from './stage-extension.mjs';
import { validatePackage } from './validate-package.mjs';

const distDir = join(projectRoot, 'dist');
const defaultKey = join(projectRoot, 'store', 'signing', 'privatekey.pem');
const keyPath = process.env.BYEBAR_CRX_PRIVATE_KEY || defaultKey;
const version = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version;
const outCrx = join(distDir, `byebar-chrome-${version}.crx`);

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

let stageDir;
const { sha256 } = await buildValidatedFile(outCrx, {
  build: async (candidatePath, workspace) => {
    if (!existsSync(keyPath)) {
      throw new Error(
        `missing signing key: ${keyPath}. Generate one with: mkdir -p store/signing && openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out store/signing/privatekey.pem`
      );
    }
    const chrome = findChrome();
    if (!chrome) throw new Error('Chrome not found. Set CHROME_PATH to your Chrome executable.');

    execFileSync(process.execPath, [join(projectRoot, 'scripts', 'build-runtime.mjs')], { stdio: 'inherit' });
    execFileSync(process.execPath, [join(projectRoot, 'scripts', 'generate-icons.mjs')], {
      stdio: 'inherit'
    });
    stageDir = await stageExtension('chrome');
    const packRoot = join(workspace, 'byebar');
    const packedCrx = `${packRoot}.crx`;
    cpSync(stageDir, packRoot, { recursive: true });
    const packArgs = [`--pack-extension=${packRoot}`, `--pack-extension-key=${keyPath}`];
    if (process.env.BYEBAR_CRX_NO_SANDBOX === '1') packArgs.unshift('--no-sandbox');
    execFileSync(chrome, packArgs, { stdio: 'inherit' });
    if (!existsSync(packedCrx)) throw new Error('pack failed: CRX not produced');
    renameSync(packedCrx, candidatePath);
  },
  validate: async (candidatePath, workspace) => {
    const header = readFileSync(candidatePath);
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
    const embeddedZip = join(workspace, 'embedded.zip');
    writeFileSync(embeddedZip, header.subarray(zipOffset));
    await validatePackage(embeddedZip, stageDir);
  }
});

console.log(`signed chrome package: ${outCrx}`);
console.log(`version: ${version}`);
console.log(`signed with: ${keyPath}`);
console.log(`sha256: ${sha256}`);
