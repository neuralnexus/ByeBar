import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildValidatedFile } from './artifact-output.mjs';
import { createCrx3, publicKeyFingerprint, signerPublicKey, validateCrx3 } from './crx3.mjs';
import { writeDeterministicZip } from './deterministic-zip.mjs';
import { projectRoot, stageExtension } from './stage-extension.mjs';
import { validatePackage } from './validate-package.mjs';

const distDir = join(projectRoot, 'dist');
const defaultKey = join(projectRoot, 'store', 'signing', 'privatekey.pem');
const keyPath = process.env.BYEBAR_CRX_PRIVATE_KEY || defaultKey;
const version = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version;
const outCrx = join(distDir, `byebar-chrome-${version}.crx`);

let stageDir;
let expectedPublicKey;
let signerFingerprint;
const { sha256 } = await buildValidatedFile(outCrx, {
  build: async (candidatePath, workspace) => {
    if (!existsSync(keyPath)) {
      throw new Error(
        `missing signing key: ${keyPath}. Generate one with: mkdir -p store/signing && openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out store/signing/privatekey.pem`
      );
    }
    const privateKey = readFileSync(keyPath);
    expectedPublicKey = signerPublicKey(privateKey);
    signerFingerprint = publicKeyFingerprint(expectedPublicKey);
    stageDir = await stageExtension('chrome');
    const embeddedZip = join(workspace, 'embedded.zip');
    const zip = await writeDeterministicZip(stageDir, embeddedZip);
    writeFileSync(candidatePath, createCrx3(zip, privateKey), { mode: 0o644 });
  },
  validate: async (candidatePath, workspace) => {
    const result = validateCrx3(readFileSync(candidatePath), {
      expectedPublicKey,
      expectedFingerprint: process.env.BYEBAR_CRX_PUBLIC_KEY_SHA256 || ''
    });
    const embeddedZip = join(workspace, 'embedded.zip');
    writeFileSync(embeddedZip, result.zip);
    await validatePackage(embeddedZip, stageDir);
  }
});

console.log(`signed chrome package: ${outCrx}`);
console.log(`version: ${version}`);
console.log(`signed with: ${keyPath}`);
console.log(`signer sha256: ${signerFingerprint}`);
console.log(`sha256: ${sha256}`);
