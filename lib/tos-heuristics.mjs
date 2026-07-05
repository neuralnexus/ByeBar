import { TOS_ACCEPT_TEXT, TOS_LANGUAGE_RE } from './constants.mjs';
import { normalizeText } from './text.mjs';

export function matchesTosModalText(text) {
  const sample = (text || '').slice(0, 4000);
  if (sample.length < 40) return false;
  return TOS_LANGUAGE_RE.test(sample);
}

export function textMatchesAccept(text, patterns = TOS_ACCEPT_TEXT, maxLength = 80) {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length > maxLength) return false;
  return patterns.some((re) => re.test(normalized));
}

export function isBloombergCmpModal(id) {
  return (id || '').toLowerCase() === 'cmp-consent-modal';
}

export function bloombergConsentCookieDomain(hostname) {
  const parts = (hostname || '').split('bloomberg.');
  if (parts.length <= 1) return hostname || '';
  return `.bloomberg.${parts[1]}`;
}
