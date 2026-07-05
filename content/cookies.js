/**
 * ByeBar cookie consent — auto-decline when a reject button is found.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const clicked = new WeakSet();

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function textMatchesDecline(text) {
    const normalized = normalizeText(text);
    if (!normalized || normalized.length > 80) return false;
    return BYEBAR.COOKIE_DECLINE_TEXT.some((re) => re.test(normalized));
  }

  function clickIfDecline(el) {
    if (!el || clicked.has(el)) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;

    const label =
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.textContent ||
      el.value ||
      '';

    if (!textMatchesDecline(label)) return false;

    clicked.add(el);
    try {
      el.click();
      return true;
    } catch {
      try {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      } catch {
        return false;
      }
    }
  }

  function clickElement(el) {
    if (!el || clicked.has(el)) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    clicked.add(el);
    try {
      el.click();
      return true;
    } catch {
      try {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      } catch {
        return false;
      }
    }
  }

  function declineViaSelectors(root) {
    let clickedAny = false;

    for (const selector of BYEBAR.COOKIE_DECLINE_SELECTORS) {
      let nodes = [];
      try {
        nodes = root.querySelectorAll(selector);
      } catch {
        continue;
      }
      nodes.forEach((el) => {
        if (clickElement(el)) clickedAny = true;
      });
    }

    return clickedAny;
  }

  function declineViaTextScan(root) {
    const buttons = root.querySelectorAll(
      'button, a[role="button"], input[type="button"], input[type="submit"], [role="button"]'
    );
    let clickedAny = false;

    buttons.forEach((el) => {
      const inBanner = el.closest(
        BYEBAR.COOKIE_HIDE.join(',') + ',[class*="cookie" i],[class*="consent" i],[class*="gdpr" i],[id*="cookie" i]'
      );
      if (!inBanner) return;
      if (clickIfDecline(el)) clickedAny = true;
    });

    return clickedAny;
  }

  function decline(root = document) {
    if (!BYEBAR.engine?.settings?.cookieDecline) return false;
    if (!BYEBAR.engine?.siteEnabled?.()) return false;

    return declineViaSelectors(root) || declineViaTextScan(root);
  }

  BYEBAR.cookies = { decline };
})();