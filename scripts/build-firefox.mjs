import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFirefoxLint } from './lint-firefox.mjs';
import { projectRoot, stageExtension } from './stage-extension.mjs';
import { validatePackage } from './validate-package.mjs';

const version = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version;
const distDir = join(projectRoot, 'dist');
const filename = `byebar-firefox-${version}.zip`;
const archivePath = join(distDir, filename);
const stageDir = await stageExtension('firefox');

mkdirSync(distDir, { recursive: true });
rmSync(archivePath, { force: true });
runFirefoxLint(stageDir);
execFileSync(
  process.execPath,
  [
    join(projectRoot, 'node_modules', 'web-ext', 'bin', 'web-ext.js'),
    'build',
    '--source-dir',
    stageDir,
    '--artifacts-dir',
    distDir,
    '--filename',
    filename,
    '--overwrite-dest'
  ],
  { stdio: 'inherit' }
);
const sha256 = await validatePackage(archivePath, stageDir);
writeFileSync(`${archivePath}.sha256`, `${sha256}  ${filename}\n`);

console.log(`firefox package: ${archivePath}`);
console.log(`sha256: ${sha256}`);
