import { SUBSTACK_HOST_PATTERNS } from './constants.mjs';

export function hostKey(hostname) {
  return (hostname || '').replace(/^www\./i, '');
}

export function normalizeHost(url) {
  try {
    return hostKey(new URL(url).hostname);
  } catch {
    return '';
  }
}

export function isSubstackHost(hostname) {
  return SUBSTACK_HOST_PATTERNS.some((re) => re.test(hostname || ''));
}

export function siteEnabledForHost(settings, hostname) {
  const key = hostKey(hostname);
  if (key && key in settings.siteOverrides) return settings.siteOverrides[key];
  return settings.enabled;
}
