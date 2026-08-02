import { describe, expect, it } from 'vitest';
import {
  findSpinnerRoot,
  hasSpinnerClassHint,
  isChinaCommerceHost,
  looksLikeSpinnerOverlay,
  matchesSpinnerText
} from '../lib/china-commerce-heuristics.mjs';

function mockNode({ tagName = 'DIV', id = '', className = '', role = '', parentElement = null }) {
  return {
    tagName,
    id,
    className,
    parentElement,
    classList: {
      contains(name) {
        return className.split(/\s+/).includes(name);
      }
    },
    getAttribute(name) {
      if (name === 'role') return role;
      return null;
    },
    getBoundingClientRect() {
      return { width: 400, height: 300 };
    },
    textContent: ''
  };
}

describe('isChinaCommerceHost', () => {
  it('matches Temu and Shein hosts', () => {
    expect(isChinaCommerceHost('www.temu.com')).toBe(true);
    expect(isChinaCommerceHost('us.shein.com')).toBe(true);
    expect(isChinaCommerceHost('www.bloomberg.com')).toBe(false);
  });
});

describe('matchesSpinnerText', () => {
  it('matches coupon wheel copy', () => {
    expect(matchesSpinnerText('Spin to win your coupon')).toBe(true);
    expect(matchesSpinnerText('Draw now for a free prize')).toBe(true);
  });

  it('rejects unrelated product text', () => {
    expect(matchesSpinnerText('Wireless earbuds with charging case')).toBe(false);
  });
});

describe('hasSpinnerClassHint', () => {
  it('detects spinner class hints', () => {
    expect(hasSpinnerClassHint('', 'c-vue-coupon')).toBe(true);
    expect(hasSpinnerClassHint('', 'lottery-popup-root')).toBe(true);
  });
});

describe('looksLikeSpinnerOverlay', () => {
  it('requires overlay geometry in addition to spinner content', () => {
    const section = mockNode({ className: 'lottery-products' });
    section.textContent = 'Spin to win your coupon';

    expect(looksLikeSpinnerOverlay(section, () => ({ position: 'static' }))).toBe(false);
    expect(looksLikeSpinnerOverlay(section, () => ({ position: 'fixed', zIndex: '200' }))).toBe(true);
    expect(
      looksLikeSpinnerOverlay(section, () => ({ position: 'fixed', zIndex: '200', display: 'none' }))
    ).toBe(false);
  });
});

describe('findSpinnerRoot', () => {
  it('prefers react-responsive-modal roots', () => {
    const modal = mockNode({
      tagName: 'DIV',
      className: 'react-responsive-modal-root',
      id: 'lottery-modal'
    });
    const inner = mockNode({
      tagName: 'SPAN',
      className: 'spin-button',
      parentElement: modal
    });
    inner.textContent = 'Spin to win your coupon';
    modal.textContent = inner.textContent;

    expect(findSpinnerRoot(inner, () => ({ position: 'static' }))).toBe(modal);
  });
});
