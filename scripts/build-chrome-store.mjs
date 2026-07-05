import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const zipPath = join(distDir, 'byebar-chrome.zip');

const include = ['manifest.json', 'icons', 'popup', 'content', 'background', 'shared'];

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

execSync('node scripts/validate-manifest.mjs', { cwd: root, stdio: 'inherit' });

const zipArgs = ['-r', zipPath, ...include, '-x', '**/.DS_Store'];
execSync(`zip ${zipArgs.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`).join(' ')}`, {
  cwd: root,
  stdio: 'inherit',
  shell: true
});

console.log(`chrome web store package: ${zipPath}`);
