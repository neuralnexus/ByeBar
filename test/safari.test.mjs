import { describe, expect, it } from 'vitest';
import { stripCaseInsensitiveFlag, toSafariSafeSelectors } from '../lib/safari.mjs';

describe('stripCaseInsensitiveFlag', () => {
  it('removes CSS Level 4 case-insensitive flag', () => {
    expect(stripCaseInsensitiveFlag('[class*="cookie" i]')).toBe('[class*="cookie"]');
  });
});

describe('toSafariSafeSelectors', () => {
  it('normalizes selector arrays', () => {
    expect(toSafariSafeSelectors(['[class*="Popup" i]', '#id'])).toEqual(['[class*="Popup"]', '#id']);
  });
});
