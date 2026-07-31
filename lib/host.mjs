import { normalizeHostKey, resolveSettingsForHost } from './settings.mjs';

export function hostKey(hostname) {
  return normalizeHostKey(hostname);
}

export function normalizeHost(url) {
  try {
    return hostKey(new URL(url).hostname);
  } catch {
    return '';
  }
}

export { isSubstackHost, isSubstackPageHtml, isSubstackSite } from './substack-detect.mjs';

export function siteEnabledForHost(settings, hostname) {
  return resolveSettingsForHost(settings, hostname).effective.enabled;
}

export function featureEnabledForHost(settings, hostname, feature) {
  return Boolean(resolveSettingsForHost(settings, hostname).effective[feature]);
}
