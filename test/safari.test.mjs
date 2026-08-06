import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripCaseInsensitiveFlag, toSafariSafeSelectors } from '../lib/safari.mjs';
import { buildSafariProject } from '../scripts/build-safari.mjs';
import {
  configureSafariProjectText,
  SAFARI_IOS_DEPLOYMENT_TARGET,
  SAFARI_MACOS_DEPLOYMENT_TARGET,
  safariMarketingVersion,
  validateSafariBuildNumber
} from '../scripts/configure-safari-project.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('stripCaseInsensitiveFlag', () => {
  it('removes CSS Level 4 case-insensitive flag', () => {
    expect(stripCaseInsensitiveFlag('[class*="cookie" i]')).toBe('[class*="cookie"]');
  });
});

describe('toSafariSafeSelectors', () => {
  it('normalizes selector arrays', () => {
    expect(toSafariSafeSelectors(['[class*="Popup" i]', '#id'])).toEqual(['[class*="Popup"]', '#id']);
  });
});

describe('generated Safari project settings', () => {
  it('uses the matching package and manifest version', () => {
    const packageVersion = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ).version;
    expect(safariMarketingVersion()).toBe(packageVersion);

    const root = mkdtempSync(join(tmpdir(), 'byebar-safari-version-test-'));
    try {
      writeFileSync(join(root, 'package.json'), '{"version":"1.2.3"}');
      writeFileSync(join(root, 'manifest.json'), '{"version":"1.2.4"}');
      expect(() => safariMarketingVersion(root)).toThrow('Safari marketing version mismatch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(['', '0', '01', '1.2', '-1'])('rejects invalid build number %j', (buildNumber) => {
    expect(() => validateSafariBuildNumber(buildNumber)).toThrow('positive integer');
  });

  it('requires an explicit build number in release mode', () => {
    const env = { ...process.env, BYEBAR_SAFARI_RELEASE: '1' };
    delete env.BYEBAR_SAFARI_BUILD_NUMBER;
    const result = spawnSync(
      'bash',
      [fileURLToPath(new URL('../scripts/build-safari.sh', import.meta.url))],
      { encoding: 'utf8', env }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Release builds require an explicit BYEBAR_SAFARI_BUILD_NUMBER');
  });

  it('configures every app and extension build configuration', () => {
    const settings = Array.from({ length: 8 }, (_, index) => {
      const deployment =
        index < 4
          ? '\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 15.0;'
          : '\t\t\t\tMACOSX_DEPLOYMENT_TARGET = 10.14;';
      return ['\t\t\t\tCURRENT_PROJECT_VERSION = 1;', '\t\t\t\tMARKETING_VERSION = 1.0;', deployment].join(
        '\n'
      );
    }).join('\n');

    const configured = configureSafariProjectText(settings, {
      marketingVersion: '0.8.0',
      buildNumber: '42'
    });

    expect(configured.match(/MARKETING_VERSION = 0\.8\.0;/g)).toHaveLength(8);
    expect(configured.match(/CURRENT_PROJECT_VERSION = 42;/g)).toHaveLength(8);
    expect(
      configured.match(new RegExp(`IPHONEOS_DEPLOYMENT_TARGET = ${SAFARI_IOS_DEPLOYMENT_TARGET};`, 'g'))
    ).toHaveLength(4);
    expect(
      configured.match(new RegExp(`MACOSX_DEPLOYMENT_TARGET = ${SAFARI_MACOS_DEPLOYMENT_TARGET};`, 'g'))
    ).toHaveLength(4);
  });

  it('resolves a capability-based full-Xcode fallback before invoking Node', () => {
    const script = readFileSync(new URL('../scripts/build-safari.sh', import.meta.url), 'utf8');
    const fallback = script.indexOf('SELECTED_CONVERTER=');
    const versionProbe = script.indexOf('MARKETING_VERSION="$(node');
    const nodeOrchestrator = script.indexOf('exec node');

    expect(fallback).toBeGreaterThanOrEqual(0);
    expect(fallback).toBeLessThan(versionProbe);
    expect(fallback).toBeLessThan(nodeOrchestrator);
    const fallbackBlock = script.slice(script.indexOf('if [[ -z "${DEVELOPER_DIR:-}"'), versionProbe);
    expect(fallbackBlock).toContain(
      'if [[ -z "${DEVELOPER_DIR:-}" && -d "/Applications/Xcode.app/Contents/Developer" ]]'
    );
    expect(fallbackBlock).toContain('xcrun --find safari-web-extension-converter');
    expect(fallbackBlock).toContain('xcrun --find xcodebuild');
    expect(fallbackBlock).toContain('! -x "$SELECTED_CONVERTER" || ! -x "$SELECTED_XCODEBUILD"');
    expect(fallbackBlock).toContain('export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"');
    expect(fallbackBlock).not.toContain('/Library/Developer/CommandLineTools');
  });

  it('isolates every xcodebuild invocation in the candidate workspace', () => {
    const script = readFileSync(new URL('../scripts/build-safari.sh', import.meta.url), 'utf8');
    const lines = script.split('\n');
    const calls = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].trimEnd().endsWith('xcodebuild \\')) continue;
      const command = [lines[index]];
      while (lines[index].trimEnd().endsWith('\\')) {
        index += 1;
        command.push(lines[index]);
      }
      calls.push(command.join('\n'));
    }

    expect(calls).toHaveLength(3);
    const probe = calls.find((command) => command.includes('-showBuildSettings'));
    expect(probe).toBeDefined();
    expect(probe).not.toContain('-derivedDataPath');
    for (const setting of [
      'OBJROOT="$DERIVED_DATA/BuildSettings/Intermediates.noindex"',
      'SYMROOT="$DERIVED_DATA/BuildSettings/Products"',
      'SHARED_PRECOMPS_DIR="$DERIVED_DATA/BuildSettings/PrecompiledHeaders"',
      'CLANG_MODULE_CACHE_PATH="$DERIVED_DATA/BuildSettings/ModuleCache.noindex"',
      'SWIFT_MODULE_CACHE_PATH="$DERIVED_DATA/BuildSettings/ModuleCache.noindex"'
    ]) {
      expect(probe).toContain(setting);
    }
    for (const command of calls.filter((candidate) => candidate !== probe)) {
      expect(command).toContain('-derivedDataPath "$DERIVED_DATA"');
    }
  });

  it('serializes candidate conversion and uses isolated DerivedData workspaces', async () => {
    const root = mkdtempSync(join(tmpdir(), 'byebar-safari-publication-test-'));
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const candidates = [];
    const workspaces = [];
    let secondStarted = false;

    function runBuild(label, hold) {
      const stageDirectory = join(root, `stage-${label}`);
      mkdirSync(stageDirectory);
      writeFileSync(join(stageDirectory, 'generation.txt'), label);
      return buildSafariProject({
        root,
        lock: { timeoutMs: 1000, pollMs: 5 },
        consumeStage: (consume) => consume(stageDirectory),
        convert: async (pinnedStage, candidateDirectory, workspace) => {
          if (label === 'second') secondStarted = true;
          candidates.push(candidateDirectory);
          workspaces.push(workspace);
          mkdirSync(join(candidateDirectory, 'ByeBar', 'ByeBar.xcodeproj'), { recursive: true });
          writeFileSync(
            join(candidateDirectory, 'ByeBar', 'generation.txt'),
            readFileSync(join(pinnedStage, 'generation.txt'))
          );
          if (hold) {
            firstStarted.resolve();
            await releaseFirst.promise;
          }
        },
        validate: async (candidateDirectory, workspace) => {
          expect(readFileSync(join(candidateDirectory, 'ByeBar', 'generation.txt'), 'utf8')).toBe(label);
          mkdirSync(join(workspace, 'DerivedData'));
          writeFileSync(join(workspace, 'DerivedData', 'owner.txt'), label);
        }
      });
    }

    try {
      const first = runBuild('first', true);
      await firstStarted.promise;
      const second = runBuild('second', false);
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(secondStarted).toBe(false);
      releaseFirst.resolve();
      await Promise.all([first, second]);

      expect(secondStarted).toBe(true);
      expect(new Set(candidates).size).toBe(2);
      expect(new Set(workspaces).size).toBe(2);
      expect(readFileSync(join(root, 'safari', 'ByeBar', 'generation.txt'), 'utf8')).toBe('second');
    } finally {
      releaseFirst.resolve();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
