import { describe, expect, it } from 'vitest';
import {
  findPromotionalOverlayRoot,
  looksLikePromotionalOverlay,
  matchesPromotionalOverlayText
} from '../lib/overlay-heuristics.mjs';

function mockElement({
  tagName = 'DIV',
  id = '',
  className = '',
  textContent = '',
  role = '',
  ariaModal = '',
  hasNavigation = false,
  parentElement = null,
  rect = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
} = {}) {
  return {
    nodeType: 1,
    tagName,
    id,
    className,
    textContent,
    parentElement,
    getAttribute(name) {
      if (name === 'role') return role;
      if (name === 'aria-modal') return ariaModal;
      return '';
    },
    getBoundingClientRect() {
      return rect;
    },
    querySelector(selector) {
      return hasNavigation && selector.includes('navigation') ? { nodeType: 1 } : null;
    }
  };
}

const viewport = { width: 1200, height: 800 };

describe('matchesPromotionalOverlayText', () => {
  it('recognizes promotional calls to action', () => {
    expect(matchesPromotionalOverlayText('Sign up for our newsletter and get 20% off')).toBe(true);
  });

  it('does not confuse subscription management with a promotion', () => {
    expect(matchesPromotionalOverlayText('Manage your subscription or subscribe to a different plan')).toBe(
      false
    );
  });
});

describe('looksLikePromotionalOverlay', () => {
  it('matches a fixed promotional bar', () => {
    const bar = mockElement({
      className: 'newsletter-bar',
      textContent: 'Subscribe to our newsletter',
      rect: { left: 0, top: 730, width: 1200, height: 70, right: 1200, bottom: 800 }
    });

    expect(looksLikePromotionalOverlay(bar, () => ({ position: 'fixed', zIndex: '20' }), viewport)).toBe(
      true
    );
  });

  it('matches a visible newsletter dialog', () => {
    const dialog = mockElement({
      role: 'dialog',
      ariaModal: 'true',
      textContent: 'Sign up for our newsletter',
      rect: { left: 400, top: 200, width: 400, height: 300, right: 800, bottom: 500 }
    });
    expect(looksLikePromotionalOverlay(dialog, () => ({ position: 'fixed' }), viewport)).toBe(true);
  });

  it('recognizes a normalized dialog fallback token', () => {
    const dialog = mockElement({
      role: 'alertdialog DIALOG',
      textContent: 'Sign up for our newsletter',
      rect: { left: 400, top: 200, width: 400, height: 300, right: 800, bottom: 500 }
    });
    expect(looksLikePromotionalOverlay(dialog, () => ({ position: 'static' }), viewport)).toBe(true);
  });

  it('leaves an inline newsletter form alone', () => {
    const form = mockElement({
      tagName: 'FORM',
      className: 'klaviyo-form',
      textContent: 'Sign up for our newsletter',
      rect: { left: 100, top: 500, width: 600, height: 160, right: 700, bottom: 660 }
    });

    expect(looksLikePromotionalOverlay(form, () => ({ position: 'static', zIndex: 'auto' }), viewport)).toBe(
      false
    );
  });

  it('leaves unrelated application dialogs alone', () => {
    const dialog = mockElement({ role: 'dialog', ariaModal: 'true', textContent: 'Edit your profile email' });
    expect(looksLikePromotionalOverlay(dialog, () => ({ position: 'fixed' }), viewport)).toBe(false);
  });

  it('does not trust a promotional class name without promotional copy', () => {
    const dialog = mockElement({
      className: 'subscribe-modal',
      role: 'dialog',
      ariaModal: 'true',
      textContent: 'Manage billing details'
    });
    expect(looksLikePromotionalOverlay(dialog, () => ({ position: 'fixed' }), viewport)).toBe(false);
  });

  it('leaves checkout and newsletter-preference dialogs alone', () => {
    const rect = { left: 400, top: 200, width: 400, height: 300, right: 800, bottom: 500 };
    const checkout = mockElement({
      role: 'dialog',
      ariaModal: 'true',
      textContent: 'Apply discount code and save 20%',
      rect
    });
    const preferences = mockElement({
      role: 'dialog',
      ariaModal: 'true',
      textContent: 'Newsletter preferences and delivery frequency',
      rect
    });

    expect(looksLikePromotionalOverlay(checkout, () => ({ position: 'fixed' }), viewport)).toBe(false);
    expect(looksLikePromotionalOverlay(preferences, () => ({ position: 'fixed' }), viewport)).toBe(false);
  });

  it('leaves authentication and account dialogs alone even when they mention email subscriptions', () => {
    const rect = { left: 400, top: 200, width: 400, height: 300, right: 800, bottom: 500 };
    const authentication = mockElement({
      role: 'dialog',
      ariaModal: 'true',
      textContent: 'Enter your email to continue',
      rect
    });
    const account = mockElement({
      role: 'dialog',
      ariaModal: 'true',
      textContent: 'Account settings: Subscribe to our newsletter',
      rect
    });

    expect(looksLikePromotionalOverlay(authentication, () => ({ position: 'fixed' }), viewport)).toBe(false);
    expect(looksLikePromotionalOverlay(account, () => ({ position: 'fixed' }), viewport)).toBe(false);
  });

  it('ignores dormant promotional dialogs', () => {
    const dialog = mockElement({
      role: 'dialog',
      ariaModal: 'true',
      textContent: 'Sign up for our newsletter',
      rect: { left: 400, top: 200, width: 400, height: 300, right: 800, bottom: 500 }
    });
    expect(
      looksLikePromotionalOverlay(dialog, () => ({ position: 'fixed', display: 'none' }), viewport)
    ).toBe(false);
  });

  it('does not hide site navigation with a subscribe action', () => {
    const nav = mockElement({
      tagName: 'NAV',
      textContent: 'News Subscribe Account',
      rect: { left: 0, top: 0, width: 1200, height: 64, right: 1200, bottom: 64 }
    });
    expect(looksLikePromotionalOverlay(nav, () => ({ position: 'sticky', zIndex: '10' }), viewport)).toBe(
      false
    );
  });

  it('does not hide a fixed navigation drawer with a newsletter link', () => {
    const drawer = mockElement({
      hasNavigation: true,
      textContent: 'Home News Newsletter Account',
      rect: { left: 0, top: 0, width: 420, height: 800, right: 420, bottom: 800 }
    });
    expect(looksLikePromotionalOverlay(drawer, () => ({ position: 'fixed', zIndex: '100' }), viewport)).toBe(
      false
    );
  });
});

describe('findPromotionalOverlayRoot', () => {
  it('walks from a vendor form to its fixed popup container', () => {
    const popup = mockElement({ className: 'popup-shell' });
    const form = mockElement({ className: 'klaviyo-form', parentElement: popup });
    const getStyle = (el) => ({ position: el === popup ? 'fixed' : 'static' });

    expect(findPromotionalOverlayRoot(form, getStyle)).toBe(popup);
  });
});
