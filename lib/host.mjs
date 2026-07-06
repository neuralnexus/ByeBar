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

export { isSubstackHost, isSubstackPageHtml, isSubstackSite } from './substack-detect.mjs';

export function siteEnabledForHost(settings, hostname) {
  const key = hostKey(hostname);
  if (key && key in settings.siteOverrides) return settings.siteOverrides[key];
  return settings.enabled;
}
