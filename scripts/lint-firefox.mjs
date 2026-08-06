import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRoot, stageExtension } from './stage-extension.mjs';

export function runFirefoxLint(stageDir) {
  const output = execFileSync(
    process.execPath,
    [
      join(projectRoot, 'node_modules', 'web-ext', 'bin', 'web-ext.js'),
      'lint',
      '--source-dir',
      stageDir,
      '--output',
      'json'
    ],
    { encoding: 'utf8' }
  );
  const result = JSON.parse(output);
  const expectedWarnings = result.warnings.filter(
    (warning) =>
      warning.code === 'KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION' &&
      warning.file === 'manifest.json' &&
      warning.description.includes('data_collection_permissions') &&
      warning.description.includes('version 142')
  );
  const unexpectedWarnings = result.warnings.filter((warning) => !expectedWarnings.includes(warning));
  if (result.errors.length || unexpectedWarnings.length || expectedWarnings.length !== 1) {
    const failures = [...result.errors, ...unexpectedWarnings]
      .map((item) => `${item.code}: ${item.message}`)
      .join('\n');
    throw new Error(`Firefox lint failed:\n${failures || 'expected compatibility warnings changed'}`);
  }
  console.log(
    `Firefox desktop lint passed (${result.summary.errors} errors, ${result.summary.warnings} allowed non-target warnings)`
  );
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  await stageExtension('firefox', runFirefoxLint);
}
