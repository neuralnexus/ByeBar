/**
 * ByeBar settings schema (mirror of lib/settings.mjs).
 */
(() => {
  const DEFAULT_SETTINGS = {
    enabled: true,
    genericBlocking: true,
    cookieDecline: true,
    tosAccept: true,
    locationDecline: true,
    netsuiteLeadRedirect: true,
    siteOverrides: {}
  };

  const BOOLEAN_KEYS = [
    'enabled',
    'genericBlocking',
    'cookieDecline',
    'tosAccept',
    'locationDecline',
    'netsuiteLeadRedirect'
  ];

  const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
  const MAX_SITE_OVERRIDES = 500;

  function normalizeSiteOverrides(overrides) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      return {};
    }

    const result = {};
    let count = 0;

    for (const [host, value] of Object.entries(overrides)) {
      if (count >= MAX_SITE_OVERRIDES) break;
      if (typeof host !== 'string' || typeof value !== 'boolean') continue;

      const key = host
        .trim()
        .replace(/^www\./i, '')
        .slice(0, 253)
        .toLowerCase();
      if (!key || key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
      if (!HOST_RE.test(key)) continue;

      result[key] = value;
      count += 1;
    }

    return result;
  }

  function normalizeSettings(stored, defaults = DEFAULT_SETTINGS) {
    const source = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    const result = {
      ...defaults,
      siteOverrides: { ...defaults.siteOverrides }
    };

    for (const key of BOOLEAN_KEYS) {
      if (typeof source[key] === 'boolean') {
        result[key] = source[key];
      }
    }

    result.siteOverrides = normalizeSiteOverrides(source.siteOverrides);
    return result;
  }

  const globalScope = typeof globalThis !== 'undefined' ? globalThis : window;
  globalScope.ByeBar = globalScope.ByeBar || {};
  globalScope.ByeBar.settings = {
    DEFAULT_SETTINGS,
    normalizeSettings
  };
})();
