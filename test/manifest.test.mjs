import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('manifest.json', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

  it('uses manifest v3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('loads shared helpers before content scripts', () => {
    const scripts = manifest.content_scripts[0].js;
    expect(scripts[0]).toBe('shared/runtime.generated.js');
    expect(scripts[1]).toBe('shared/browser.js');
    expect(scripts[2]).toBe('shared/substack-detect.js');
    expect(scripts).toContain('content/safari-compat.js');
    expect(scripts).toContain('content/picker.js');
    expect(scripts.indexOf('content/visibility.js')).toBeLessThan(scripts.indexOf('content/engine.js'));
    expect(scripts.indexOf('content/actions.js')).toBeLessThan(scripts.indexOf('content/engine.js'));
    expect(scripts.indexOf('content/picker.js')).toBeLessThan(scripts.indexOf('content/engine.js'));
  });

  it('runs only in the top frame and has no unconditional site CSS', () => {
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0].all_frames).toBe(false);
    expect(manifest.content_scripts[0].css).toEqual(['content/styles.css']);
  });

  it('declares only the permissions required for settings, active-tab UI, and route safety', () => {
    expect(manifest.permissions).toEqual(['storage', 'activeTab']);
  });

  it('declares safari minimum version', () => {
    expect(manifest.browser_specific_settings?.safari?.strict_min_version).toBe('16.4');
  });

  it('targets Firefox desktop 140 with the AMO no-data declaration', () => {
    expect(manifest.browser_specific_settings?.gecko).toEqual({
      id: 'byebar@neuralnexus.dev',
      strict_min_version: '140.0',
      data_collection_permissions: {
        required: ['none'],
        optional: []
      }
    });
    expect(manifest.browser_specific_settings).not.toHaveProperty('gecko_android');
  });

  it('declares crisp extension and toolbar icon sizes', () => {
    expect(manifest.icons).toEqual(
      Object.fromEntries(
        [16, 32, 48, 64, 96, 128, 256, 512, 1024].map((size) => [size, `icons/icon-${size}.png`])
      )
    );
    expect(manifest.action.default_icon).toEqual(
      Object.fromEntries([16, 24, 32, 48, 64].map((size) => [size, `icons/toolbar-${size}.png`]))
    );
  });

  it('declares a configurable shortcut for the conservative page Sweep', () => {
    expect(manifest.commands).toEqual({
      'sweep-page': {
        suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' },
        description: 'Run ByeBar Sweep on the active page'
      }
    });
  });

  it('keeps description within Chrome Web Store limit', () => {
    expect(manifest.description.length).toBeLessThanOrEqual(132);
  });

  it('matches the current package and lockfile release version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
    expect(manifest.version).toBe('0.8.0');
    expect(manifest.version).toBe(pkg.version);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
  });
});
