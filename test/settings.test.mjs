import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../lib/settings.mjs';

describe('normalizeSettings', () => {
  it('returns defaults for missing or invalid stored data', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings([])).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('enabled')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid boolean settings and ignores invalid types', () => {
    const result = normalizeSettings({
      enabled: false,
      genericBlocking: 'no',
      cookieDecline: 0,
      tosAccept: true,
      locationDecline: null,
      netsuiteLeadRedirect: true,
      extraKey: 'ignored'
    });

    expect(result).toEqual({
      ...DEFAULT_SETTINGS,
      enabled: false,
      tosAccept: true,
      netsuiteLeadRedirect: true,
      siteOverrides: {}
    });
  });

  it('normalizes site override hostnames', () => {
    const result = normalizeSettings({
      siteOverrides: {
        'WWW.Example.COM': false,
        '  substack.com  ': true,
        'not a host!': true,
        '': false,
        'valid.io': false
      }
    });

    expect(result.siteOverrides).toEqual({
      'example.com': false,
      'substack.com': true,
      'valid.io': false
    });
  });

  it('blocks prototype pollution keys in site overrides', () => {
    const result = normalizeSettings({
      siteOverrides: {
        __proto__: true,
        prototype: false,
        constructor: true,
        'safe.example': false
      }
    });

    expect(result.siteOverrides).toEqual({ 'safe.example': false });
  });

  it('ignores non-boolean site override values', () => {
    const result = normalizeSettings({
      siteOverrides: {
        'example.com': 'false',
        'other.com': 0,
        'good.com': true
      }
    });

    expect(result.siteOverrides).toEqual({ 'good.com': true });
  });

  it('caps site overrides at 500 entries', () => {
    const overrides = {};
    for (let i = 0; i < 600; i += 1) {
      overrides[`site${i}.example`] = i % 2 === 0;
    }

    const result = normalizeSettings({ siteOverrides: overrides });
    expect(Object.keys(result.siteOverrides)).toHaveLength(500);
  });
});
