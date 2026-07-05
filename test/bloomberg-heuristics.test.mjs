import { describe, expect, it } from 'vitest';
import {
  findBloombergPromoRoot,
  hasBloombergModuleVisibilityClass,
  matchesBloombergPromoText
} from '../lib/bloomberg-heuristics.mjs';

function mockNode({ tagName, id = '', href = '', role = '', parentElement = null }) {
  return {
    tagName,
    id,
    parentElement,
    getAttribute(name) {
      if (name === 'href') return href;
      if (name === 'role') return role;
      return null;
    }
  };
}

describe('hasBloombergModuleVisibilityClass', () => {
  it('detects CSS module visibility classes', () => {
    expect(hasBloombergModuleVisibilityClass('_showOnMobile_1juvt_23')).toBe(true);
    expect(hasBloombergModuleVisibilityClass('_showOnDesktop_abc_12')).toBe(true);
    expect(hasBloombergModuleVisibilityClass('header-item')).toBe(false);
  });
});

describe('matchesBloombergPromoText', () => {
  it('matches subscription flash sale copy', () => {
    expect(matchesBloombergPromoText('Summer Flash Sale: Save up to 60%')).toBe(true);
    expect(matchesBloombergPromoText('Subscribe for just $1.99')).toBe(true);
  });

  it('rejects unrelated article text', () => {
    expect(matchesBloombergPromoText('Markets rose after the Federal Reserve meeting.')).toBe(false);
  });
});

describe('findBloombergPromoRoot', () => {
  it('prefers sticky promo containers over inner spans', () => {
    const strip = mockNode({ tagName: 'DIV', id: 'promo-strip' });
    const anchor = mockNode({
      tagName: 'A',
      href: '/subscriptions/offer',
      parentElement: strip
    });
    const span = mockNode({ tagName: 'SPAN', parentElement: anchor });
    const getComputedStyle = (el) => (el === strip ? { position: 'sticky' } : { position: 'static' });

    expect(findBloombergPromoRoot(span, getComputedStyle)?.id).toBe('promo-strip');
  });

  it('falls back to subscription links', () => {
    const anchor = mockNode({
      tagName: 'A',
      id: 'promo-link',
      href: '/subscriptions/flash-sale'
    });
    const span = mockNode({ tagName: 'SPAN', parentElement: anchor });
    const getComputedStyle = () => ({ position: 'static' });

    expect(findBloombergPromoRoot(span, getComputedStyle)?.id).toBe('promo-link');
  });
});
