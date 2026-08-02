import {
  DEFAULT_SETTINGS,
  FEATURE_KEYS,
  GLOBAL_BOOLEAN_KEYS,
  SETTINGS_SCHEMA_VERSION
} from './constants.mjs';

export { DEFAULT_SETTINGS, FEATURE_KEYS, GLOBAL_BOOLEAN_KEYS, SETTINGS_SCHEMA_VERSION };

const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const MAX_SITE_OVERRIDES = 500;

function validationError(message, code = 'invalid-setting') {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function normalizeHostKey(host) {
  if (typeof host !== 'string') return '';
  const key = host
    .trim()
    .replace(/^www\./i, '')
    .slice(0, 253)
    .toLowerCase();
  if (!key || key === '__proto__' || key === 'prototype' || key === 'constructor') return '';
  return HOST_RE.test(key) ? key : '';
}

export function isFeatureKey(key) {
  return FEATURE_KEYS.includes(key);
}

export function normalizeSiteOverrides(overrides) {
  if (!isRecord(overrides)) return {};

  const result = {};
  let count = 0;
  for (const [host, value] of Object.entries(overrides)) {
    if (count >= MAX_SITE_OVERRIDES) break;
    const key = normalizeHostKey(host);
    if (!key || typeof value !== 'boolean') continue;
    result[key] = value;
    count += 1;
  }
  return result;
}

export function normalizeSiteFeatureOverrides(overrides) {
  if (!isRecord(overrides)) return {};

  const result = {};
  let count = 0;
  for (const [host, values] of Object.entries(overrides)) {
    if (count >= MAX_SITE_OVERRIDES) break;
    const key = normalizeHostKey(host);
    if (!key || !isRecord(values)) continue;

    const features = {};
    for (const feature of FEATURE_KEYS) {
      if (typeof values[feature] === 'boolean') features[feature] = values[feature];
    }
    if (Object.keys(features).length === 0) continue;
    result[key] = features;
    count += 1;
  }
  return result;
}

export function normalizeSettings(stored, defaults = DEFAULT_SETTINGS) {
  const source = isRecord(stored) ? stored : {};
  const sourceVersion = Number.isInteger(source.settingsSchemaVersion)
    ? Math.max(0, source.settingsSchemaVersion)
    : 0;
  const result = {
    ...defaults,
    settingsSchemaVersion: Math.max(SETTINGS_SCHEMA_VERSION, sourceVersion),
    siteOverrides: normalizeSiteOverrides(source.siteOverrides),
    siteFeatureOverrides: normalizeSiteFeatureOverrides(source.siteFeatureOverrides)
  };

  for (const key of GLOBAL_BOOLEAN_KEYS) {
    if (typeof source[key] === 'boolean') result[key] = source[key];
  }
  if (sourceVersion < SETTINGS_SCHEMA_VERSION) result.tosAccept = defaults.tosAccept;
  return result;
}

export function resolveSettingsForHost(settings, host) {
  const normalized = normalizeSettings(settings);
  const key = normalizeHostKey(host);
  const siteFeatures = key ? normalized.siteFeatureOverrides[key] || {} : {};
  const enabledOverride =
    key && Object.hasOwn(normalized.siteOverrides, key) ? normalized.siteOverrides[key] : null;
  const enabled = enabledOverride ?? normalized.enabled;

  const overrides = { enabled: enabledOverride };
  const configured = { enabled };
  const effective = { enabled };
  for (const feature of FEATURE_KEYS) {
    const override = Object.hasOwn(siteFeatures, feature) ? siteFeatures[feature] : null;
    const value = override ?? normalized[feature];
    overrides[feature] = override;
    configured[feature] = value;
    effective[feature] = Boolean(enabled && value);
  }

  return {
    host: key,
    overrides,
    configured,
    effective,
    hasOverrides: enabledOverride !== null || FEATURE_KEYS.some((feature) => overrides[feature] !== null)
  };
}

export function updateSetting(settings, { scope, host = '', key, value }) {
  const next = normalizeSettings(settings);
  if (!GLOBAL_BOOLEAN_KEYS.includes(key)) throw validationError('invalid setting key');

  if (scope === 'global') {
    if (typeof value !== 'boolean') throw validationError('global setting must be boolean');
    next[key] = value;
    return next;
  }
  if (scope !== 'site') throw validationError('invalid setting scope');

  const hostKey = normalizeHostKey(host);
  if (!hostKey) throw validationError('invalid host', 'invalid-host');
  if (value !== null && typeof value !== 'boolean')
    throw validationError('site setting must be boolean or null');

  if (key === 'enabled') {
    if (
      value !== null &&
      !Object.hasOwn(next.siteOverrides, hostKey) &&
      Object.keys(next.siteOverrides).length >= MAX_SITE_OVERRIDES
    ) {
      throw validationError('site override limit reached', 'quota-exceeded');
    }
    if (value === null) delete next.siteOverrides[hostKey];
    else next.siteOverrides[hostKey] = value;
    return next;
  }

  if (
    value !== null &&
    !Object.hasOwn(next.siteFeatureOverrides, hostKey) &&
    Object.keys(next.siteFeatureOverrides).length >= MAX_SITE_OVERRIDES
  ) {
    throw validationError('site feature override limit reached', 'quota-exceeded');
  }
  const featureOverrides = { ...(next.siteFeatureOverrides[hostKey] || {}) };
  if (value === null) delete featureOverrides[key];
  else featureOverrides[key] = value;

  if (Object.keys(featureOverrides).length === 0) delete next.siteFeatureOverrides[hostKey];
  else next.siteFeatureOverrides[hostKey] = featureOverrides;
  return next;
}

export function clearSiteOverrides(settings, host) {
  const next = normalizeSettings(settings);
  const hostKey = normalizeHostKey(host);
  if (!hostKey) throw validationError('invalid host', 'invalid-host');
  delete next.siteOverrides[hostKey];
  delete next.siteFeatureOverrides[hostKey];
  return next;
}
