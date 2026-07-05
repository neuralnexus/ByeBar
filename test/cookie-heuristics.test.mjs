import { describe, expect, it } from 'vitest';
import {
  isCookieYesElement,
  isDidomiElement,
  isUsercentricsElement,
  matchesCookieBannerText
} from '../lib/cookie-heuristics.mjs';

const USC_BANNER =
  'We use cookies and similar technologies to understand our visitors’ experiences. By continuing to use this website, you agree to this condition of use. For further information please see our privacy notice.';

const MERCEDES_BANNER =
  'The Mercedes-Benz AG uses cookies for various purposes. You can decide which categories you want to allow. Ablehnen Akzeptieren';

describe('isCookieYesElement', () => {
  it('detects cookieyes classes', () => {
    expect(isCookieYesElement('', 'cky-banner-element')).toBe(true);
    expect(isCookieYesElement('', 'cky-consent-container')).toBe(true);
  });
});

describe('isDidomiElement', () => {
  it('detects Didomi consent popups', () => {
    expect(isDidomiElement('didomi-host', '')).toBe(true);
    expect(
      isDidomiElement(
        '',
        'notranslate didomi-screen-medium didomi-consent-popup__46f7dddf-c089-41ee-a5e2-5ea92cabd8dd'
      )
    ).toBe(true);
  });
});

describe('isUsercentricsElement', () => {
  it('detects usercentrics hosts', () => {
    expect(isUsercentricsElement('usercentrics-root', '')).toBe(true);
    expect(isUsercentricsElement('', 'uc-banner-root')).toBe(true);
  });
});

describe('matchesCookieBannerText', () => {
  it('matches USC implied-consent copy', () => {
    expect(matchesCookieBannerText(USC_BANNER)).toBe(true);
  });

  it('matches Mercedes-Benz Usercentrics copy', () => {
    expect(matchesCookieBannerText(MERCEDES_BANNER)).toBe(true);
  });

  it('rejects unrelated page text', () => {
    expect(matchesCookieBannerText('Welcome to our computer science department.')).toBe(false);
  });
});
