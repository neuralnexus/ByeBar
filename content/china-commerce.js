/**
 * ByeBar ; coupon spinner / lottery wheel overlays on Chinese commerce sites.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const removed = new WeakSet();

  function queryAll(selector, root = document) {
    return BYEBAR.shadow?.queryAll(selector, root) || Array.from(root.querySelectorAll(selector));
  }

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function matchesSpinnerText(text) {
    const sample = normalizeText(text);
    if (sample.length < 8 || sample.length > 2000) return false;
    return (
      /spin\s+to\s+win|spin\s+the\s+wheel|coupon\s+spin|lucky\s+wheel|prize\s+wheel|turntable|draw\s+now|get\s+your\s+coupon|claim\s+your\s+prize|free\s+spin|wheel\s+of\s+fortune|spin\s+button/i.test(
        sample
      ) && /spin|draw|wheel|coupon|prize|lottery|claim|turntable/i.test(sample)
    );
  }

  function hasSpinnerClassHint(el) {
    const id = (el?.id || '').toLowerCase();
    const cls = typeof el?.className === 'string' ? el.className.toLowerCase() : '';
    const haystack = `${id} ${cls}`;
    return /lottery|turntable|spin-wheel|spinwheel|coupon-spin|couponspin|lucky-wheel|luckywheel|fortune-wheel|vue-coupon|react-responsive-modal/.test(
      haystack
    );
  }

  function findSpinnerRoot(el) {
    if (!el) return null;

    let node = el;

    for (let depth = 0; depth < 12 && node; depth++) {
      if (node.classList?.contains('react-responsive-modal-root') || hasSpinnerClassHint(node)) {
        return node;
      }

      const style = getComputedStyle(node);
      const highZ = parseInt(style.zIndex, 10) >= 200;
      const positioned = style.position === 'fixed' || style.position === 'absolute';

      if (positioned && highZ && matchesSpinnerText(node.textContent || '')) {
        return node;
      }

      if (
        (node.getAttribute?.('role') === 'dialog' || node.getAttribute?.('aria-modal') === 'true') &&
        matchesSpinnerText(node.textContent || '')
      ) {
        return node;
      }

      const parent = node.parentElement;
      if (!parent) break;

      const parentTag = parent.tagName;
      if (parentTag === 'BODY' || parentTag === 'HTML') {
        break;
      }

      node = parent;
    }

    return el;
  }

  function removeElement(el) {
    if (!el?.parentNode || removed.has(el)) return;
    removed.add(el);
    try {
      el.setAttribute('data-byebar-hidden', 'true');
      el.remove();
    } catch {
      try {
        el.parentNode.removeChild(el);
      } catch {
        /* ignore */
      }
    }
  }

  function unlockPageScroll() {
    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) return;

    for (const el of [html, body]) {
      if (el.style.overflow === 'hidden' || el.style.position === 'fixed') {
        el.style.overflow = '';
        el.style.position = '';
        el.style.top = '';
        el.style.width = '';
      }
    }

    body.classList.forEach((name) => {
      if (/no-scroll|noscroll|modal-open|overflow-hidden/i.test(name)) {
        body.classList.remove(name);
      }
    });
  }

  function looksLikeSpinner(el) {
    if (!el || el.nodeType !== 1 || removed.has(el)) return false;
    if (!BYEBAR.isChinaCommerce?.()) return false;
    if (el.getAttribute('data-byebar-hidden')) return false;

    if (el.classList?.contains('react-responsive-modal-root') || hasSpinnerClassHint(el)) {
      return true;
    }

    return matchesSpinnerText(el.textContent || '');
  }

  function nukeViaSelectors(root = document) {
    let removedAny = false;

    for (const selector of BYEBAR.SITE_RULES.chinaCommerce.remove) {
      queryAll(selector, root).forEach((el) => {
        removeElement(el);
        removedAny = true;
      });
    }

    return removedAny;
  }

  function nukeViaHeuristic(root = document) {
    const seen = new Set();
    let removedAny = false;

    queryAll(BYEBAR.CHINA_COMMERCE_TRIGGERS, root).forEach((el) => {
      const spinnerRoot = findSpinnerRoot(el);
      if (!spinnerRoot || seen.has(spinnerRoot)) return;
      seen.add(spinnerRoot);
      removeElement(spinnerRoot);
      removedAny = true;
    });

    queryAll('[role="dialog"], [aria-modal="true"], div, section', root).forEach((el) => {
      if (!looksLikeSpinner(el)) return;
      const spinnerRoot = findSpinnerRoot(el);
      if (!spinnerRoot || seen.has(spinnerRoot)) return;
      seen.add(spinnerRoot);
      removeElement(spinnerRoot);
      removedAny = true;
    });

    return removedAny;
  }

  function nukeSpinners(root = document) {
    if (!BYEBAR.isChinaCommerce?.() || !BYEBAR.engine?.siteEnabled?.()) return false;

    const removedAny = nukeViaSelectors(root) || nukeViaHeuristic(root);
    if (removedAny) unlockPageScroll();
    return removedAny;
  }

  BYEBAR.chinaCommerce = { nukeSpinners, looksLikeSpinner };
})();
