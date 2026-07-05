import { describe, expect, it } from 'vitest';
import { isCookieYesElement, matchesCookieBannerText } from '../lib/cookie-heuristics.mjs';

const USC_BANNER =
  'We use cookies and similar technologies to understand our visitors’ experiences. By continuing to use this website, you agree to this condition of use. For further information please see our privacy notice.';

describe('isCookieYesElement', () => {
  it('detects cookieyes classes', () => {
    expect(isCookieYesElement('', 'cky-banner-element')).toBe(true);
    expect(isCookieYesElement('', 'cky-consent-container')).toBe(true);
  });
});

describe('matchesCookieBannerText', () => {
  it('matches USC implied-consent copy', () => {
    expect(matchesCookieBannerText(USC_BANNER)).toBe(true);
  });

  it('rejects unrelated page text', () => {
    expect(matchesCookieBannerText('Welcome to our computer science department.')).toBe(false);
  });
});
