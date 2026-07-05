import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('manifest.json', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

  it('uses manifest v3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('loads settings schema before browser polyfill', () => {
    const scripts = manifest.content_scripts[0].js;
    expect(scripts[0]).toBe('shared/settings.js');
    expect(scripts[1]).toBe('shared/browser.js');
    expect(scripts).toContain('content/safari-compat.js');
  });

  it('declares safari minimum version', () => {
    expect(manifest.browser_specific_settings?.safari?.strict_min_version).toBe('16.4');
  });

  it('keeps description within Chrome Web Store limit', () => {
    expect(manifest.description.length).toBeLessThanOrEqual(132);
  });
});
