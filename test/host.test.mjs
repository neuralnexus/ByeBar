import { describe, expect, it } from 'vitest';
import {
  hostKey,
  isSubstackHost,
  isSubstackPageHtml,
  isSubstackSite,
  normalizeHost,
  siteEnabledForHost
} from '../lib/host.mjs';
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

describe('isSubstackPageHtml', () => {
  it('detects substack custom domains from page markers', () => {
    const html =
      '<link rel="preconnect" href="https://substackcdn.com" /><meta content="https://noahpinion.substack.com/api/v1/post_preview/1/twitter.jpg"/>';
    expect(isSubstackPageHtml(html)).toBe(true);
    expect(isSubstackPageHtml('<html><body>Hello world</body></html>')).toBe(false);
  });
});

describe('isSubstackSite', () => {
  it('accepts native and custom substack hosts', () => {
    expect(isSubstackSite('matthewivan.substack.com')).toBe(true);
    expect(isSubstackSite('noahpinion.blog', '<link href="https://substackcdn.com/bundle/main.css">')).toBe(
      true
    );
    expect(isSubstackSite('example.com')).toBe(false);
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
