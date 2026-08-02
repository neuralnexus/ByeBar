import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import JSZip from 'jszip';
import { projectRoot, stageExtension } from './stage-extension.mjs';
import { listRegularFiles, validatePackage } from './validate-package.mjs';

const version = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version;
const distDir = join(projectRoot, 'dist');
const zipPath = join(distDir, `byebar-chrome-${version}.zip`);
const stageDir = await stageExtension('chrome');

mkdirSync(distDir, { recursive: true });
rmSync(zipPath, { force: true });
const zip = new JSZip();
for (const file of listRegularFiles(stageDir)) {
  zip.file(file, readFileSync(join(stageDir, file)), { date: new Date('1980-01-01T00:00:00Z') });
}
writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
const sha256 = await validatePackage(zipPath, stageDir);
writeFileSync(`${zipPath}.sha256`, `${sha256}  ${basename(zipPath)}\n`);

console.log(`chrome web store package: ${zipPath}`);
console.log(`sha256: ${sha256}`);
