import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/constants.mjs';
import {
  isExternalLeadContext,
  isExternalLeadUrl,
  isNetSuiteExtLeadUrl,
  isNetSuiteScriptAlert,
  isSearchReferrer,
  looksLikeLeadCaptureHtml,
  normalizeRedirectTarget,
  resolveBaseDomainFromHtml,
  shouldRedirectNetSuiteLead
} from '../lib/netsuite-lead.mjs';

const SAMPLE_URL =
  'https://6262239.extforms.netsuite.com/app/site/crm/externalleadpage.nl/compid.6262239/.f?formid=3994&h=AAFdikaIeIn9bU4iOHhxr0CQB2ZYYBdc5tdb5gVACyU7E7ceZVk&leadsource=g8664';

const ORACLE_LEAD_FORM_HTML = `
<form id="main_form" action="/app/site/crm/externalleadpage.nl?compid=6262239">
  <img src="/c.6262239/portal/common/form/landing_pages/img/logos-ons/logo-ons-text-color.svg" alt="Oracle NetSuite">
  <input name="email" id="email" data-fieldtype="email">
</form>`;

const GENERIC_LP_FORM_HTML = `
<html><head><link rel="canonical" href="https://www.wrike.com/request-demo"></head>
<body><form class="hs-form" action="/submit"><input type="email" name="email"><button type="submit">Go</button></form></body></html>`;

describe('isNetSuiteExtLeadUrl', () => {
  it('matches extforms external lead pages', () => {
    expect(isNetSuiteExtLeadUrl(SAMPLE_URL)).toBe(true);
    expect(isExternalLeadUrl(SAMPLE_URL)).toBe(true);
  });

  it('skips unrelated NetSuite hosts', () => {
    expect(isNetSuiteExtLeadUrl('https://www.netsuite.com/portal/home.shtml')).toBe(false);
  });
});

describe('isExternalLeadUrl', () => {
  it('matches marketing subdomains', () => {
    expect(isExternalLeadUrl('https://lp.example.com/contact')).toBe(true);
    expect(isExternalLeadUrl('https://go.vendor.com/demo')).toBe(true);
  });

  it('skips normal site pages', () => {
    expect(isExternalLeadUrl('https://www.example.com/pricing')).toBe(false);
  });
});

describe('isSearchReferrer', () => {
  it('detects common search engines', () => {
    expect(isSearchReferrer('https://www.google.com/search?q=acme')).toBe(true);
    expect(isSearchReferrer('https://www.bing.com/search?q=acme')).toBe(true);
  });
});

describe('shouldRedirectNetSuiteLead', () => {
  it('redirects when enabled globally', () => {
    expect(shouldRedirectNetSuiteLead(DEFAULT_SETTINGS, '6262239.extforms.netsuite.com')).toBe(true);
  });

  it('respects per-site disable', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      siteOverrides: { '6262239.extforms.netsuite.com': false }
    };
    expect(shouldRedirectNetSuiteLead(settings, '6262239.extforms.netsuite.com')).toBe(false);
  });

  it('skips when netsuiteLeadRedirect is off', () => {
    expect(
      shouldRedirectNetSuiteLead(
        { ...DEFAULT_SETTINGS, netsuiteLeadRedirect: false },
        '6262239.extforms.netsuite.com'
      )
    ).toBe(false);
  });
});

describe('normalizeRedirectTarget', () => {
  it('returns the site origin', () => {
    expect(normalizeRedirectTarget('https://www.wrike.com/lp/demo?utm=1')).toBe('https://www.wrike.com/');
  });

  it('blocks ad and form hosts', () => {
    expect(normalizeRedirectTarget('https://www.google.com/search?q=test')).toBe(null);
    expect(normalizeRedirectTarget(SAMPLE_URL)).toBe(null);
    expect(normalizeRedirectTarget('https://lp.example.com/demo')).toBe(null);
  });

  it('blocks the current page host', () => {
    expect(normalizeRedirectTarget('https://lp.example.com/demo', 'lp.example.com')).toBe(null);
  });
});

describe('isNetSuiteScriptAlert', () => {
  it('detects broken client script alerts', () => {
    expect(
      isNetSuiteScriptAlert(
        "TypeError: Cannot read properties of null (reading 'addEventListener') customform (pageInit)"
      )
    ).toBe(true);
    expect(isNetSuiteScriptAlert('Please enter your email')).toBe(false);
  });
});

describe('looksLikeLeadCaptureHtml', () => {
  it('detects NetSuite lead forms with email fields', () => {
    expect(looksLikeLeadCaptureHtml(ORACLE_LEAD_FORM_HTML)).toBe(true);
  });

  it('detects generic marketing forms', () => {
    expect(looksLikeLeadCaptureHtml(GENERIC_LP_FORM_HTML)).toBe(true);
  });
});

describe('isExternalLeadContext', () => {
  it('accepts search traffic to thin lead forms', () => {
    expect(
      isExternalLeadContext({
        html: GENERIC_LP_FORM_HTML,
        url: 'https://lp.example.com/contact',
        referrer: 'https://www.google.com/search?q=wrike',
        currentHostname: 'lp.example.com'
      })
    ).toBe(true);
  });

  it('skips normal on-site contact pages', () => {
    expect(
      isExternalLeadContext({
        html: '<form><input type="email" name="email"><button type="submit">Send</button></form>',
        url: 'https://www.example.com/contact',
        referrer: 'https://www.example.com/about',
        currentHostname: 'www.example.com'
      })
    ).toBe(false);
  });
});

describe('resolveBaseDomainFromHtml', () => {
  it('falls back to netsuite.com for Oracle-branded forms', () => {
    expect(resolveBaseDomainFromHtml(ORACLE_LEAD_FORM_HTML, 'https://www.google.com/')).toBe(
      'https://www.netsuite.com/'
    );
  });

  it('uses a clean referrer when available', () => {
    expect(resolveBaseDomainFromHtml('<html></html>', 'https://www.wrike.com/landing')).toBe(
      'https://www.wrike.com/'
    );
  });

  it('reads canonical links before fallback', () => {
    const html =
      '<html><head><link rel="canonical" href="https://acme.example.com/demo"></head><body></body></html>';
    expect(resolveBaseDomainFromHtml(html)).toBe('https://acme.example.com/');
  });

  it('returns null when no brand target is found', () => {
    expect(resolveBaseDomainFromHtml('<html><body></body></html>')).toBe(null);
  });
});
