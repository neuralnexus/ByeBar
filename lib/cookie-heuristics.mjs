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

export function isSourcepointElement(id, className) {
  const cls = (className || '').toLowerCase();
  const normalizedId = (id || '').toLowerCase();
  return (
    normalizedId === 'sp-cc' ||
    normalizedId.startsWith('sp_message_') ||
    cls.includes('sp_message') ||
    cls.includes('sp_choice_type') ||
    cls.includes('message-container')
  );
}

export function isFundingChoicesElement(id, className) {
  const cls = (className || '').toLowerCase();
  const normalizedId = (id || '').toLowerCase();
  return (
    normalizedId === 'fc-consent-root' ||
    cls.includes('fc-consent') ||
    cls.includes('fc-dialog') ||
    cls.includes('fc-button')
  );
}

export function isCookiebotElement(id, className) {
  const cls = (className || '').toLowerCase();
  const normalizedId = (id || '').toLowerCase();
  return (
    normalizedId === 'cybotcookiebotdialog' ||
    normalizedId.startsWith('cybotcookiebot') ||
    cls.includes('cybotcookiebot') ||
    cls.includes('cookiebot')
  );
}

export function isQuantcastElement(id, className) {
  const cls = (className || '').toLowerCase();
  return cls.includes('qc-cmp2') || cls.includes('quantcast');
}

export function isIubendaElement(id, className) {
  const cls = (className || '').toLowerCase();
  const normalizedId = (id || '').toLowerCase();
  return (
    normalizedId.startsWith('iubenda-cs-') ||
    normalizedId === 'iubenda-cs-banner' ||
    cls.includes('iubenda-cs-') ||
    cls.includes('iub-cmp')
  );
}

export function isTermlyElement(id, className) {
  const cls = (className || '').toLowerCase();
  const normalizedId = (id || '').toLowerCase();
  return (
    normalizedId === 'termly-code-snippet-support' ||
    normalizedId.startsWith('termly-') ||
    cls.includes('termly') ||
    cls.includes('t-consent-banner')
  );
}

export function isKetchElement(id, className) {
  const cls = (className || '').toLowerCase();
  const normalizedId = (id || '').toLowerCase();
  return (
    normalizedId === 'lanyard-root' ||
    normalizedId.startsWith('ketch-') ||
    cls.includes('ketch-banner') ||
    cls.includes('ketch-modal')
  );
}

export function isBorlabsElement(id, className) {
  const cls = (className || '').toLowerCase();
  const normalizedId = (id || '').toLowerCase();
  return normalizedId === 'borlabscookiebox' || cls.includes('borlabs') || cls.includes('brlbs-');
}

export function isComplianzElement(id, className) {
  const cls = (className || '').toLowerCase();
  const normalizedId = (id || '').toLowerCase();
  return (
    normalizedId === 'cmplz-cookiebanner-container' ||
    normalizedId.startsWith('cmplz-') ||
    cls.includes('cmplz-')
  );
}

export function isMooveGdprElement(id, className) {
  const cls = (className || '').toLowerCase();
  const normalizedId = (id || '').toLowerCase();
  return normalizedId.startsWith('moove_gdpr') || cls.includes('moove-gdpr');
}

export function isConsentManagerElement(id, className) {
  const cls = (className || '').toLowerCase();
  const normalizedId = (id || '').toLowerCase();
  return normalizedId === 'cmpbox' || normalizedId === 'cmpbox2' || cls.includes('cmpwrapper');
}

export function isOneTrustElement(id, className) {
  const cls = (className || '').toLowerCase();
  const normalizedId = (id || '').toLowerCase();
  return normalizedId.startsWith('onetrust') || cls.includes('onetrust') || cls.includes('ot-sdk');
}

export function isKnownCmpElement(id, className) {
  return (
    isCookieYesElement(id, className) ||
    isDidomiElement(id, className) ||
    isUsercentricsElement(id, className) ||
    isSourcepointElement(id, className) ||
    isFundingChoicesElement(id, className) ||
    isCookiebotElement(id, className) ||
    isQuantcastElement(id, className) ||
    isIubendaElement(id, className) ||
    isTermlyElement(id, className) ||
    isKetchElement(id, className) ||
    isBorlabsElement(id, className) ||
    isComplianzElement(id, className) ||
    isMooveGdprElement(id, className) ||
    isConsentManagerElement(id, className) ||
    isOneTrustElement(id, className)
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
