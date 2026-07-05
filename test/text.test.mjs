import { describe, expect, it } from 'vitest';
import { normalizeText, textMatchesDecline } from '../lib/text.mjs';

describe('normalizeText', () => {
  it('collapses whitespace', () => {
    expect(normalizeText('  Opt-Out  \n')).toBe('Opt-Out');
  });
});

describe('textMatchesDecline', () => {
  it('matches opt-out labels', () => {
    expect(textMatchesDecline('Opt-Out')).toBe(true);
    expect(textMatchesDecline('opt out')).toBe(true);
  });

  it('matches do-not-sell labels', () => {
    expect(textMatchesDecline('Do not sell or share my personal information')).toBe(true);
  });

  it('rejects accept labels', () => {
    expect(textMatchesDecline('Accept and Proceed')).toBe(false);
    expect(textMatchesDecline('Accept all')).toBe(false);
  });
});
