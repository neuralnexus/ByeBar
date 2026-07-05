import { describe, expect, it } from 'vitest';
import {
  bloombergConsentCookieDomain,
  isBloombergCmpModal,
  matchesTosModalText,
  textMatchesAccept
} from '../lib/tos-heuristics.mjs';

const BLOOMBERG_TOS =
  "We've updated our terms By accepting, you agree to our updated Terms of Service, including the arbitration provision and class action waiver.";

describe('matchesTosModalText', () => {
  it('matches Bloomberg terms update copy', () => {
    expect(matchesTosModalText(BLOOMBERG_TOS)).toBe(true);
  });

  it('rejects unrelated page text', () => {
    expect(matchesTosModalText('Latest market news and analysis from Bloomberg.')).toBe(false);
  });
});

describe('textMatchesAccept', () => {
  it('matches common accept labels', () => {
    expect(textMatchesAccept('Accept')).toBe(true);
    expect(textMatchesAccept('I agree')).toBe(true);
    expect(textMatchesAccept('Decline')).toBe(false);
  });
});

describe('isBloombergCmpModal', () => {
  it('detects cmp-consent-modal', () => {
    expect(isBloombergCmpModal('cmp-consent-modal')).toBe(true);
    expect(isBloombergCmpModal('other')).toBe(false);
  });
});

describe('bloombergConsentCookieDomain', () => {
  it('scopes cookies to bloomberg TLD', () => {
    expect(bloombergConsentCookieDomain('www.bloomberg.com')).toBe('.bloomberg.com');
    expect(bloombergConsentCookieDomain('www.bloomberg.co.jp')).toBe('.bloomberg.co.jp');
  });
});
