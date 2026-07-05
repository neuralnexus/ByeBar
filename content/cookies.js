/**
 * ByeBar cookie consent — auto-decline when a reject button is found.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const clicked = new WeakSet();
  const removed = new WeakSet();

  function queryAll(selector, root = document) {
    return BYEBAR.shadow?.queryAll(selector, root) || Array.from(root.querySelectorAll(selector));
  }

  function closestBanner(el) {
    if (!el) return null;
    return (
      BYEBAR.shadow?.closestDeep(el, BYEBAR.COOKIE_BANNER_ANCESTORS) ||
      el.closest?.(BYEBAR.COOKIE_BANNER_ANCESTORS) ||
      BYEBAR.shadow?.closestDeep(el, '#consent_blackbar, #truste-consent-track, #trustarc-banner-overlay') ||
      el.closest?.('#consent_blackbar, #truste-consent-track, #trustarc-banner-overlay')
    );
  }

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function textMatchesDecline(text) {
    const normalized = normalizeText(text);
    if (!normalized || normalized.length > 120) return false;
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
      id === 'trustarc-banner-overlay' ||
      id === 'truste-consent-content' ||
      cls.includes('truste-consent') ||
      cls.includes('truste-banner') ||
      cls.includes('opt-out-button')
    ) {
      return true;
    }

    const text = (el.textContent || '').slice(0, 3000);
    if (text.length < 40) return false;

    const hasCookieLanguage =
      /about cookies on this site|cookie preferences|privacy law|personal information|opt-?out|do not sell|similar technologies|required\)\./i.test(
        text
      );
    const hasBannerActions =
      /accept( all)?|opt-?out|more info|reject|decline|manage preferences|do not sell or share/i.test(text);
    if (!hasCookieLanguage || !hasBannerActions) return false;

    if (closestBanner(el)) return true;

    const style = getComputedStyle(el);
    const positioned =
      style.position === 'fixed' ||
      style.position === 'sticky' ||
      style.position === 'absolute' ||
      parseInt(style.zIndex, 10) >= 100;

    if (!positioned) return false;

    const rect = el.getBoundingClientRect();
    return rect.width >= 200 && rect.height >= 40;
  }

  function declineViaSelectors(root = document) {
    let clickedAny = false;

    for (const selector of BYEBAR.COOKIE_DECLINE_SELECTORS) {
      queryAll(selector, root).forEach((el) => {
        if (clickElement(el)) clickedAny = true;
      });
    }

    return clickedAny;
  }

  function declineViaTextScan(root = document) {
    let clickedAny = false;

    queryAll('button, a[role="button"], input[type="button"], input[type="submit"], [role="button"]', root).forEach(
      (el) => {
        if (!closestBanner(el)) return;
        if (clickIfDecline(el)) clickedAny = true;
      }
    );

    return clickedAny;
  }

  function removeViaSelectors(root = document) {
    let removedAny = false;

    for (const selector of BYEBAR.COOKIE_HIDE) {
      queryAll(selector, root).forEach((el) => {
        removeElement(el);
        removedAny = true;
      });
    }

    return removedAny;
  }

  function removeViaHeuristic(root = document) {
    let removedAny = false;

    queryAll(
      '#consent_blackbar, #trustarc-banner-overlay, #truste-consent-track, #truste-consent-content, [role="dialog"], [aria-modal="true"], div, section, aside',
      root
    ).forEach((el) => {
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