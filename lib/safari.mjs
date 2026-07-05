/**
 * Safari/WebKit compatibility helpers.
 * Case-insensitive attribute selectors in querySelector are Safari 16.4+ only.
 */
const CASE_INSENSITIVE_ATTR_RE = /\s+i\]/g;

export function stripCaseInsensitiveFlag(selector) {
  return selector.replace(CASE_INSENSITIVE_ATTR_RE, ']');
}

export function toSafariSafeSelectors(selectors) {
  return selectors.map(stripCaseInsensitiveFlag);
}

export function isCaseInsensitiveSelectorSupported() {
  if (typeof document === 'undefined') return true;
  try {
    document.querySelector('[class*="byebar-probe" i]');
    return true;
  } catch {
    return false;
  }
}
