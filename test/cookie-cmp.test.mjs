import { describe, expect, it, vi } from 'vitest';
import {
  declineCookiebot,
  declineIubenda,
  declineKetch,
  declineOneTrust,
  declineQuantcast,
  declineSourcepoint
} from '../lib/cookie-cmp.mjs';

describe('declineSourcepoint', () => {
  it('calls gdpr.rejectAll', () => {
    const rejectAll = vi.fn();
    expect(declineSourcepoint({ _sp_: { gdpr: { rejectAll } } })).toBe(true);
    expect(rejectAll).toHaveBeenCalled();
  });
});

describe('declineCookiebot', () => {
  it('calls withdraw when available', () => {
    const withdraw = vi.fn();
    expect(declineCookiebot({ Cookiebot: { withdraw } })).toBe(true);
    expect(withdraw).toHaveBeenCalled();
  });
});

describe('declineQuantcast', () => {
  it('calls __cmp rejectAll', () => {
    const cmp = vi.fn();
    expect(declineQuantcast({ __cmp: cmp })).toBe(true);
    expect(cmp).toHaveBeenCalledWith('rejectAll');
  });
});

describe('declineIubenda', () => {
  it('calls _iub.cs.api.reject', () => {
    const reject = vi.fn();
    expect(declineIubenda({ _iub: { cs: { api: { reject } } } })).toBe(true);
    expect(reject).toHaveBeenCalled();
  });
});

describe('declineOneTrust', () => {
  it('calls OneTrust.RejectAll', () => {
    const RejectAll = vi.fn();
    expect(declineOneTrust({ OneTrust: { RejectAll } })).toBe(true);
    expect(RejectAll).toHaveBeenCalled();
  });
});

describe('declineKetch', () => {
  it('calls ketch deny', () => {
    const ketch = vi.fn();
    expect(declineKetch({ ketch })).toBe(true);
    expect(ketch).toHaveBeenCalledWith('deny', { showRightsForm: false });
  });
});
