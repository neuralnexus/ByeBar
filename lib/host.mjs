import { normalizeHostKey, resolveSettingsForHost } from './settings.mjs';

export function hostKey(hostname) {
  return normalizeHostKey(hostname);
}

export function normalizeHost(url) {
  return parseUrlContext(url).host;
}

export function parseUrlContext(url) {
  if (typeof url !== 'string' || !url.trim()) return { readable: false, host: '' };
  try {
    return { readable: true, host: hostKey(new URL(url).hostname) };
  } catch {
    return { readable: false, host: '' };
  }
}

export { isSubstackHost, isSubstackPageHtml, isSubstackSite } from './substack-detect.mjs';

export function siteEnabledForHost(settings, hostname) {
  return resolveSettingsForHost(settings, hostname).effective.enabled;
}

export function featureEnabledForHost(settings, hostname, feature) {
  return Boolean(resolveSettingsForHost(settings, hostname).effective[feature]);
}
