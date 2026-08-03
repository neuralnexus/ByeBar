import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildValidatedFile } from './artifact-output.mjs';
import { runFirefoxLint } from './lint-firefox.mjs';
import { projectRoot, stageExtension } from './stage-extension.mjs';
import { validatePackage } from './validate-package.mjs';

const version = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version;
const distDir = join(projectRoot, 'dist');
const filename = `byebar-firefox-${version}.zip`;
const archivePath = join(distDir, filename);
let stageDir;

const { sha256 } = await buildValidatedFile(archivePath, {
  build: async (_candidatePath, workspace) => {
    execFileSync(process.execPath, [join(projectRoot, 'scripts', 'build-runtime.mjs')], { stdio: 'inherit' });
    execFileSync(process.execPath, [join(projectRoot, 'scripts', 'generate-icons.mjs')], {
      stdio: 'inherit'
    });
    stageDir = await stageExtension('firefox');
    runFirefoxLint(stageDir);
    execFileSync(
      process.execPath,
      [
        join(projectRoot, 'node_modules', 'web-ext', 'bin', 'web-ext.js'),
        'build',
        '--source-dir',
        stageDir,
        '--artifacts-dir',
        workspace,
        '--filename',
        filename,
        '--overwrite-dest'
      ],
      { stdio: 'inherit' }
    );
  },
  validate: (candidatePath) => validatePackage(candidatePath, stageDir)
});

console.log(`firefox package: ${archivePath}`);
console.log(`sha256: ${sha256}`);
