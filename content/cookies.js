/**
 * ByeBar cookie consent — auto-decline when a reject button is found.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const clicked = new WeakSet();
  const removed = new WeakSet();

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

  function looksLikeCookieBanner(el) {
    if (!el || el.nodeType !== 1 || removed.has(el)) return false;

    const id = (el.id || '').toLowerCase();
    const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
    if (
      id === 'consent_blackbar' ||
      id === 'truste-consent-track' ||
      cls.includes('truste-consent') ||
      cls.includes('opt-out-button')
    ) {
      return true;
    }

    const text = (el.textContent || '').slice(0, 2500);
    if (text.length < 40) return false;

    const hasCookieLanguage =
      /cookie|consent|privacy law|personal information|opt-?out|do not sell|similar technologies/i.test(text);
    const hasBannerActions = /accept|opt-?out|more info|reject|decline|manage preferences/i.test(text);
    if (!hasCookieLanguage || !hasBannerActions) return false;

    const style = getComputedStyle(el);
    const positioned =
      style.position === 'fixed' ||
      style.position === 'sticky' ||
      style.position === 'absolute' ||
      el.closest('#consent_blackbar, #onetrust-banner-sdk, [class*="cookie" i], [class*="consent" i]');

    if (!positioned) return false;

    const rect = el.getBoundingClientRect();
    return rect.width >= 200 && rect.height >= 40;
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
      const inBanner = el.closest(BYEBAR.COOKIE_BANNER_ANCESTORS);
      if (!inBanner && !el.closest('#consent_blackbar, #truste-consent-track')) return;
      if (clickIfDecline(el)) clickedAny = true;
    });

    return clickedAny;
  }

  function removeViaSelectors(root) {
    let removedAny = false;

    for (const selector of BYEBAR.COOKIE_HIDE) {
      let nodes = [];
      try {
        nodes = root.querySelectorAll(selector);
      } catch {
        continue;
      }
      nodes.forEach((el) => {
        removeElement(el);
        removedAny = true;
      });
    }

    return removedAny;
  }

  function removeViaHeuristic(root) {
    let removedAny = false;
    const candidates = root.querySelectorAll(
      '#consent_blackbar, #truste-consent-track, [role="dialog"], [aria-modal="true"], div, section, aside'
    );

    candidates.forEach((el) => {
      if (!looksLikeCookieBanner(el)) return;
      removeElement(el);
      removedAny = true;
    });

    return removedAny;
  }

  function removeBanners(root = document) {
    if (!BYEBAR.engine?.settings?.cookieDecline) return false;
    if (!BYEBAR.engine?.siteEnabled?.()) return false;

    return removeViaSelectors(root) || removeViaHeuristic(root);
  }

  function decline(root = document) {
    if (!BYEBAR.engine?.settings?.cookieDecline) return false;
    if (!BYEBAR.engine?.siteEnabled?.()) return false;

    const clicked = declineViaSelectors(root) || declineViaTextScan(root);
    removeBanners(root);
    return clicked;
  }

  BYEBAR.cookies = { decline, removeBanners };
})();