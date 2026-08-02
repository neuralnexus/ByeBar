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
    expect(scripts.indexOf('content/visibility.js')).toBeLessThan(scripts.indexOf('content/engine.js'));
    expect(scripts.indexOf('content/actions.js')).toBeLessThan(scripts.indexOf('content/engine.js'));
  });

  it('runs only in the top frame and has no unconditional site CSS', () => {
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0].all_frames).toBe(false);
    expect(manifest.content_scripts[0].css).toEqual(['content/styles.css']);
  });

  it('declares safari minimum version', () => {
    expect(manifest.browser_specific_settings?.safari?.strict_min_version).toBe('16.4');
  });

  it('supports currently signed Firefox releases', () => {
    expect(manifest.browser_specific_settings?.gecko?.strict_min_version).toBe('115.0');
  });

  it('declares high-resolution store icons', () => {
    expect(manifest.icons).toMatchObject({
      256: 'icons/icon-256.png',
      512: 'icons/icon-512.png',
      1024: 'icons/icon-1024.png'
    });
  });

  it('keeps description within Chrome Web Store limit', () => {
    expect(manifest.description.length).toBeLessThanOrEqual(132);
  });

  it('matches package version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(manifest.version).toBe(pkg.version);
  });
});
