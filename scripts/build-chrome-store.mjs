import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildValidatedFile } from './artifact-output.mjs';
import { writeDeterministicZip } from './deterministic-zip.mjs';
import { projectRoot, stageExtension } from './stage-extension.mjs';
import { validatePackage } from './validate-package.mjs';

const version = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version;
const distDir = join(projectRoot, 'dist');
const zipPath = join(distDir, `byebar-chrome-${version}.zip`);
let stageDir;

const { sha256 } = await buildValidatedFile(zipPath, {
  build: async (candidatePath) => {
    stageDir = await stageExtension('chrome');
    await writeDeterministicZip(stageDir, candidatePath);
  },
  validate: (candidatePath) => validatePackage(candidatePath, stageDir)
});

console.log(`chrome web store package: ${zipPath}`);
console.log(`sha256: ${sha256}`);
