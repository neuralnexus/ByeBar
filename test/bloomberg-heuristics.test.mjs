import { describe, expect, it } from 'vitest';
import {
  findBloombergPromoRoot,
  hasBloombergModuleVisibilityClass,
  looksLikeBloombergPromo,
  matchesBloombergPromoText
} from '../lib/bloomberg-heuristics.mjs';

function mockNode({
  tagName,
  id = '',
  href = '',
  role = '',
  className = '',
  textContent = '',
  parentElement = null,
  rect = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
}) {
  return {
    tagName,
    id,
    className,
    textContent,
    parentElement,
    getAttribute(name) {
      if (name === 'href') return href;
      if (name === 'role') return role;
      return null;
    },
    getBoundingClientRect() {
      return rect;
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

describe('looksLikeBloombergPromo', () => {
  const viewport = { width: 1200, height: 800 };
  const rect = { left: 0, top: 720, width: 1200, height: 80, right: 1200, bottom: 800 };

  it('requires an intrusive positioned strip', () => {
    const promo = mockNode({
      tagName: 'DIV',
      className: '_showOnDesktop_abc',
      textContent: 'Subscribe for just $1.99',
      rect
    });
    expect(looksLikeBloombergPromo(promo, () => ({ position: 'static' }), viewport)).toBe(false);
    expect(looksLikeBloombergPromo(promo, () => ({ position: 'sticky' }), viewport)).toBe(true);
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

  it('does not climb into sticky site navigation', () => {
    const nav = mockNode({ tagName: 'NAV', id: 'site-nav' });
    const anchor = mockNode({
      tagName: 'A',
      id: 'promo-link',
      href: '/subscriptions/offer',
      parentElement: nav
    });
    const span = mockNode({ tagName: 'SPAN', parentElement: anchor });
    const getComputedStyle = (el) => ({ position: el === nav ? 'sticky' : 'static' });

    expect(findBloombergPromoRoot(span, getComputedStyle)?.id).toBe('promo-link');
  });
});
