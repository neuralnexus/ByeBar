import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildValidatedFile } from './artifact-output.mjs';
import { writeDeterministicZip } from './deterministic-zip.mjs';
import { runFirefoxLint } from './lint-firefox.mjs';
import { projectRoot, stageExtension } from './stage-extension.mjs';
import { validatePackage } from './validate-package.mjs';

const version = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version;
const distDir = join(projectRoot, 'dist');
const archivePath = join(distDir, `byebar-firefox-${version}.zip`);

const { sha256 } = await buildValidatedFile(archivePath, {
  build: async (candidatePath) => {
    await stageExtension('firefox', async (stageDir) => {
      runFirefoxLint(stageDir);
      await writeDeterministicZip(stageDir, candidatePath);
      await validatePackage(candidatePath, stageDir);
    });
  },
  validate: async () => {}
});

console.log(`firefox package: ${archivePath}`);
console.log(`sha256: ${sha256}`);
