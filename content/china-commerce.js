/**
 * Coupon spinner and lottery overlays on supported commerce sites.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const dismissed = new WeakSet();
  const meta = {
    feature: 'genericBlocking',
    rule: 'commerce-spinner',
    operation: 'hide',
    reason: 'spinner-copy-and-geometry'
  };

  function queryAll(selector, root = document) {
    return BYEBAR.shadow?.queryAll(selector, root) || Array.from(root.querySelectorAll(selector));
  }

  function pageHasInteractionLock() {
    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) return false;
    const htmlStyle = getComputedStyle(html);
    const bodyStyle = getComputedStyle(body);
    return Boolean(
      htmlStyle.overflow === 'hidden' ||
      bodyStyle.overflow === 'hidden' ||
      bodyStyle.position === 'fixed' ||
      document.querySelector('[inert], body > [aria-hidden="true"]')
    );
  }

  function tryDismiss(el) {
    if (!el?.querySelectorAll || dismissed.has(el)) return false;
    for (const control of el.querySelectorAll('button, [role~="button" i]')) {
      const label = BYEBAR.lib.text.normalizeText(
        control.getAttribute('aria-label') ||
          control.getAttribute('title') ||
          control.textContent ||
          control.value ||
          ''
      );
      if (!/^(close|dismiss|no thanks|not now)$/i.test(label)) continue;
      if (control.disabled || control.getAttribute('aria-disabled') === 'true') continue;
      if (!BYEBAR.isVisiblyInteractive?.(control)) continue;

      dismissed.add(el);
      try {
        control.click();
        BYEBAR.actions.recordIrreversible({ ...meta, operation: 'dismiss', reason: 'close-control' });
        return true;
      } catch {
        dismissed.delete(el);
        return false;
      }
    }
    return false;
  }

  function hideElement(el) {
    if (
      !el ||
      dismissed.has(el) ||
      BYEBAR.wasUserOpened?.(el) ||
      BYEBAR.actions.isSuppressed(el) ||
      BYEBAR.visibility.isHidden(el)
    ) {
      return false;
    }
    if (tryDismiss(el)) return true;
    if (el.tagName === 'DIALOG' && el.open && typeof el.close === 'function') {
      dismissed.add(el);
      el.close();
      BYEBAR.actions.recordIrreversible({ ...meta, operation: 'dismiss', reason: 'native-dialog' });
      return true;
    }

    const rect = el.getBoundingClientRect?.();
    const blocksScroll =
      BYEBAR.lib.aria.hasRole(el, 'dialog') ||
      el.getAttribute?.('aria-modal') === 'true' ||
      Boolean(rect && rect.width >= window.innerWidth * 0.75 && rect.height >= window.innerHeight * 0.6);
    if (blocksScroll || pageHasInteractionLock()) {
      BYEBAR.actions.skip(meta, 'interaction-lock');
      return false;
    }

    const action = BYEBAR.actions.begin(meta);
    if (!BYEBAR.actions.hide(action, el, 'china-commerce')) return false;
    BYEBAR.actions.commit(action);
    return true;
  }

  function looksLikeSpinner(el) {
    return Boolean(
      el &&
      BYEBAR.isChinaCommerce?.() &&
      !BYEBAR.visibility.isHidden(el) &&
      BYEBAR.lib.chinaCommerce.looksLikeSpinnerOverlay(el, getComputedStyle)
    );
  }

  function nukeSpinners(root = document) {
    if (
      BYEBAR.picker?.blocksAutomation?.() ||
      !BYEBAR.isChinaCommerce?.() ||
      !BYEBAR.engine?.featureEnabled?.('genericBlocking')
    ) {
      return false;
    }

    const seen = new Set();
    let handledAny = false;
    const candidates = [
      ...queryAll(BYEBAR.CHINA_COMMERCE_TRIGGERS, root),
      ...queryAll('[role~="dialog" i], [aria-modal="true"]', root)
    ];
    candidates.forEach((candidate) => {
      const spinnerRoot = BYEBAR.lib.chinaCommerce.findSpinnerRoot(candidate, getComputedStyle);
      if (!spinnerRoot || seen.has(spinnerRoot) || !looksLikeSpinner(spinnerRoot)) return;
      seen.add(spinnerRoot);
      if (hideElement(spinnerRoot)) handledAny = true;
    });
    return handledAny;
  }

  BYEBAR.chinaCommerce = { nukeSpinners, looksLikeSpinner };
})();
