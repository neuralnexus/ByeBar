import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTargetManifest } from '../scripts/stage-extension.mjs';

const source = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

describe('target manifests', () => {
  function expectIconsPreserved(manifest) {
    expect(manifest.icons).toEqual(source.icons);
    expect(manifest.action.default_icon).toEqual(source.action.default_icon);
    expect(manifest.commands).toEqual(source.commands);
  }

  it('creates a Chrome-only service worker manifest', () => {
    const manifest = createTargetManifest(source, 'chrome');
    expect(manifest.background).toEqual({ service_worker: 'background/service-worker.js' });
    expect(manifest.minimum_chrome_version).toBe('109');
    expect(manifest).not.toHaveProperty('browser_specific_settings');
    expectIconsPreserved(manifest);
  });

  it('creates an ordered Firefox background-script fallback', () => {
    const manifest = createTargetManifest(source, 'firefox');
    expect(manifest.background).toEqual({
      scripts: ['shared/runtime.generated.js', 'shared/browser.js', 'background/service-worker.js']
    });
    expect(manifest.browser_specific_settings).toEqual({
      gecko: source.browser_specific_settings.gecko
    });
    expect(manifest).not.toHaveProperty('minimum_chrome_version');
    expectIconsPreserved(manifest);
  });

  it('creates a Safari-only service worker manifest', () => {
    const manifest = createTargetManifest(source, 'safari');
    expect(manifest.background).toEqual({ service_worker: 'background/service-worker.js' });
    expect(manifest.browser_specific_settings).toEqual({
      safari: source.browser_specific_settings.safari
    });
    expect(manifest).not.toHaveProperty('minimum_chrome_version');
    expectIconsPreserved(manifest);
  });
});
