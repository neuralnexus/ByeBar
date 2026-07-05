import { COOKIE_ACTION_RE, COOKIE_IMPLIED_CONSENT_RE, COOKIE_LANGUAGE_RE } from './constants.mjs';

export function isCookieYesElement(id, className) {
  const cls = (className || '').toLowerCase();
  const normalizedId = (id || '').toLowerCase();
  return (
    normalizedId === 'cookieyes-banner' ||
    cls.includes('cky-consent') ||
    cls.includes('cky-banner') ||
    cls.includes('cky-overlay') ||
    cls.startsWith('cky-')
  );
}

export function isDidomiElement(id, className) {
  const cls = (className || '').toLowerCase();
  const normalizedId = (id || '').toLowerCase();
  return (
    normalizedId === 'didomi-host' ||
    normalizedId.startsWith('didomi-') ||
    normalizedId.includes('didomi') ||
    cls.includes('didomi-') ||
    cls.includes('didomi-popup') ||
    cls.includes('didomi-consent') ||
    cls.includes('didomi-screen')
  );
}

export function isUsercentricsElement(id, className) {
  const cls = (className || '').toLowerCase();
  const normalizedId = (id || '').toLowerCase();
  return (
    normalizedId === 'usercentrics-root' ||
    normalizedId.includes('usercentrics') ||
    cls.includes('usercentrics') ||
    cls.includes('uc-banner') ||
    cls.startsWith('uc-')
  );
}

export function matchesCookieBannerText(text) {
  const sample = (text || '').slice(0, 3000);
  if (sample.length < 40) return false;
  const hasCookieLanguage = COOKIE_LANGUAGE_RE.test(sample);
  const hasBannerActions = COOKIE_ACTION_RE.test(sample);
  const hasImpliedConsent = COOKIE_IMPLIED_CONSENT_RE.test(sample);
  return hasCookieLanguage && (hasBannerActions || hasImpliedConsent);
}
