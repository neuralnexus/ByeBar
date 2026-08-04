import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { buildValidatedFile } from './artifact-output.mjs';
import { projectRoot, stageExtension } from './stage-extension.mjs';
import { listRegularFiles, validatePackage } from './validate-package.mjs';

const version = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version;
const distDir = join(projectRoot, 'dist');
const zipPath = join(distDir, `byebar-chrome-${version}.zip`);
let stageDir;

const { sha256 } = await buildValidatedFile(zipPath, {
  build: async (candidatePath) => {
    execFileSync(process.execPath, [join(projectRoot, 'scripts', 'build-runtime.mjs')], { stdio: 'inherit' });
    execFileSync(process.execPath, [join(projectRoot, 'scripts', 'generate-icons.mjs')], {
      stdio: 'inherit'
    });
    stageDir = await stageExtension('chrome');
    const zip = new JSZip();
    for (const file of listRegularFiles(stageDir)) {
      zip.file(file, readFileSync(join(stageDir, file)), {
        date: new Date('1980-01-01T00:00:00Z')
      });
    }
    writeFileSync(candidatePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  },
  validate: (candidatePath) => validatePackage(candidatePath, stageDir)
});

console.log(`chrome web store package: ${zipPath}`);
console.log(`sha256: ${sha256}`);
