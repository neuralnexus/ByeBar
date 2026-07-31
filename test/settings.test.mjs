import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  clearSiteOverrides,
  normalizeSettings,
  resolveSettingsForHost,
  updateSetting
} from '../lib/settings.mjs';

describe('normalizeSettings', () => {
  it('returns defaults for missing or invalid stored data', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings([])).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('enabled')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid boolean settings and ignores invalid types', () => {
    const result = normalizeSettings({
      settingsSchemaVersion: 1,
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

  it('rejects a new site after the override limit instead of reporting a no-op success', () => {
    const siteOverrides = Object.fromEntries(
      Array.from({ length: 500 }, (_, index) => [`s${index}.x`, false])
    );
    expect(() =>
      updateSetting(
        { ...DEFAULT_SETTINGS, siteOverrides },
        {
          scope: 'site',
          host: 'overflow.example',
          key: 'enabled',
          value: false
        }
      )
    ).toThrow('site override limit reached');
  });

  it('normalizes feature overrides and drops malformed keys', () => {
    const result = normalizeSettings({
      siteFeatureOverrides: {
        'WWW.Example.com': {
          genericBlocking: false,
          cookieDecline: true,
          tosAccept: 'yes',
          unknown: false
        },
        'not a host': { genericBlocking: true },
        'empty.example': { genericBlocking: null }
      }
    });

    expect(result.siteFeatureOverrides).toEqual({
      'example.com': { genericBlocking: false, cookieDecline: true }
    });
  });

  it('preserves a newer schema version without trusting unknown settings', () => {
    const result = normalizeSettings({ settingsSchemaVersion: 9, unknown: true });
    expect(result.settingsSchemaVersion).toBe(9);
    expect(result).not.toHaveProperty('unknown');
  });

  it('resets legal acceptance while migrating settings that predate the schema', () => {
    expect(normalizeSettings({ tosAccept: true }).tosAccept).toBe(false);
    expect(normalizeSettings({ settingsSchemaVersion: 1, tosAccept: true }).tosAccept).toBe(true);
  });

  it.each([0, -1, 1.5, '1'])('normalizes invalid schema version %s to the current schema', (version) => {
    expect(normalizeSettings({ settingsSchemaVersion: version }).settingsSchemaVersion).toBe(1);
  });
});

describe('site setting resolution', () => {
  it('applies whole-site gates before feature overrides', () => {
    const settings = normalizeSettings({
      enabled: true,
      cookieDecline: false,
      siteOverrides: { 'example.com': false },
      siteFeatureOverrides: { 'example.com': { cookieDecline: true } }
    });
    const site = resolveSettingsForHost(settings, 'www.example.com');
    expect(site.configured.cookieDecline).toBe(true);
    expect(site.effective.enabled).toBe(false);
    expect(site.effective.cookieDecline).toBe(false);
  });

  it('supports a positive site override when the global default is off', () => {
    const settings = updateSetting(
      { ...DEFAULT_SETTINGS, enabled: false },
      {
        scope: 'site',
        host: 'example.com',
        key: 'enabled',
        value: true
      }
    );
    expect(resolveSettingsForHost(settings, 'example.com').effective.enabled).toBe(true);
  });

  it('sets, inherits, and clears individual feature overrides', () => {
    let settings = updateSetting(DEFAULT_SETTINGS, {
      scope: 'site',
      host: 'example.com',
      key: 'genericBlocking',
      value: false
    });
    expect(resolveSettingsForHost(settings, 'example.com').overrides.genericBlocking).toBe(false);

    settings = updateSetting(settings, {
      scope: 'site',
      host: 'example.com',
      key: 'genericBlocking',
      value: null
    });
    expect(resolveSettingsForHost(settings, 'example.com').overrides.genericBlocking).toBeNull();

    settings = updateSetting(settings, {
      scope: 'site',
      host: 'example.com',
      key: 'cookieDecline',
      value: false
    });
    expect(clearSiteOverrides(settings, 'example.com').siteFeatureOverrides).toEqual({});
  });
});
