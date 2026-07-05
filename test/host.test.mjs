import { describe, expect, it } from 'vitest';
import { hostKey, isSubstackHost, normalizeHost, siteEnabledForHost } from '../lib/host.mjs';
import { DEFAULT_SETTINGS } from '../lib/constants.mjs';

describe('hostKey', () => {
  it('strips www prefix', () => {
    expect(hostKey('www.substack.com')).toBe('substack.com');
  });
});

describe('isSubstackHost', () => {
  it('detects substack domains', () => {
    expect(isSubstackHost('matthewivan.substack.com')).toBe(true);
    expect(isSubstackHost('substack.com')).toBe(true);
    expect(isSubstackHost('servicenow.com')).toBe(false);
  });
});

describe('normalizeHost', () => {
  it('parses urls', () => {
    expect(normalizeHost('https://www.ibm.com/path')).toBe('ibm.com');
  });
});

describe('siteEnabledForHost', () => {
  it('honors per-site overrides', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      siteOverrides: { 'example.com': false }
    };
    expect(siteEnabledForHost(settings, 'example.com')).toBe(false);
    expect(siteEnabledForHost(settings, 'other.com')).toBe(true);
  });
});
