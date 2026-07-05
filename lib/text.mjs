import { COOKIE_DECLINE_TEXT, COOKIE_LANGUAGE_RE } from './constants.mjs';

export function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

export function textMatchesDecline(text, patterns = COOKIE_DECLINE_TEXT, maxLength = 120) {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length > maxLength) return false;
  return patterns.some((re) => re.test(normalized));
}

export function matchesCookieLanguage(text) {
  return COOKIE_LANGUAGE_RE.test(text || '');
}
