import { describe, expect, it } from 'vitest';
import {
  findSpinnerRoot,
  hasSpinnerClassHint,
  isChinaCommerceHost,
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

    expect(findSpinnerRoot(inner, () => ({ position: 'static' }))).toBe(modal);
  });
});
