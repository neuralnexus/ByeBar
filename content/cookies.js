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
      el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.value || '';

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

  let didomiReadyHooked = false;

  function hasDidomiBanner(root = document) {
    return queryAll('#didomi-host, [class*="didomi-popup" i], [class*="didomi-consent" i]', root).length > 0;
  }

  function unlockDidomiBody() {
    document.body?.classList?.remove('didomi-popup-open');
    if (document.body?.style?.overflow === 'hidden') {
      document.body.style.removeProperty('overflow');
    }
    document.documentElement?.classList?.remove('didomi-popup-open');
    if (document.documentElement?.style?.overflow === 'hidden') {
      document.documentElement.style.removeProperty('overflow');
    }
  }

  function declineViaDidomiApi() {
    if (!hasDidomiBanner()) return false;

    try {
      const didomi = window.Didomi;
      if (didomi && typeof didomi.setUserDisagreeToAll === 'function') {
        didomi.setUserDisagreeToAll();
        unlockDidomiBody();
        return true;
      }
    } catch {
      /* ignore */
    }

    return false;
  }

  function cookieDeclineEnabled(settings) {
    const key = location.hostname.replace(/^www\./i, '');
    const siteOn = key in settings.siteOverrides ? settings.siteOverrides[key] : settings.enabled;
    return Boolean(siteOn && settings.cookieDecline);
  }

  function runDidomiDecline() {
    declineViaDidomiUi(document);
    declineViaDidomiApi();
    removeViaSelectors(document);
    removeViaHeuristic(document);
    unlockDidomiBody();
  }

  function hookDidomiReady() {
    if (didomiReadyHooked) return;
    didomiReadyHooked = true;

    const { storageGet } = BYEBAR.browser || {};
    const defaults = { enabled: true, cookieDecline: true, siteOverrides: {} };

    window.didomiOnReady = window.didomiOnReady || [];
    window.didomiOnReady.push(() => {
      if (storageGet) {
        void storageGet(defaults).then((settings) => {
          if (cookieDeclineEnabled(settings)) runDidomiDecline();
        });
        return;
      }

      if (BYEBAR.engine?.settings?.cookieDecline && BYEBAR.engine?.siteEnabled?.()) {
        runDidomiDecline();
      }
    });
  }

  function declineViaDidomiUi(root = document) {
    if (!hasDidomiBanner(root)) return false;

    let clickedAny = false;

    const continueWithout = queryAll('.didomi-continue-without-agreeing', root);
    for (const el of continueWithout) {
      if (clickElement(el)) clickedAny = true;
    }

    const disagree = queryAll(
      '#didomi-notice-disagree-button, #btn-toggle-disagree, button[onclick*="setUserDisagreeToAll" i], a[href*="setUserDisagreeToAll" i], button[aria-label*="Disagree to all" i], button[aria-label*="Refuser" i]',
      root
    );
    for (const el of disagree) {
      if (clickElement(el)) clickedAny = true;
    }

    const learnMore = queryAll('#didomi-notice-learn-more-button', root);
    if (learnMore.length > 0 && !clickedAny) {
      for (const el of learnMore) {
        clickElement(el);
      }
      queryAll('#btn-toggle-disagree, #didomi-notice-disagree-button', root).forEach((el) => {
        if (clickElement(el)) clickedAny = true;
      });
    }

    if (clickedAny) unlockDidomiBody();
    return clickedAny;
  }

  function hasUsercentricsBanner(root = document) {
    return (
      queryAll(
        '#usercentrics-root, #usercentrics-cmp-ui, [data-testid="uc-banner"], [data-testid="uc-first-layer"]',
        root
      ).length > 0
    );
  }

  function declineViaUsercentricsApi() {
    if (!hasUsercentricsBanner()) return false;

    try {
      const ui = window.UC_UI;
      if (ui) {
        if (typeof ui.denyAllConsents === 'function') {
          ui.denyAllConsents();
          return true;
        }
        if (typeof ui.denyAllServices === 'function') {
          ui.denyAllServices();
          return true;
        }
        if (typeof ui.rejectAllConsents === 'function') {
          ui.rejectAllConsents();
          return true;
        }
      }

      const cmp = window.__ucCmp;
      if (cmp && typeof cmp.denyAllConsents === 'function') {
        cmp.denyAllConsents();
        return true;
      }
    } catch {
      /* ignore */
    }

    return false;
  }

  function declineViaTrustArcApi() {
    const truste = window.truste;
    if (!truste) return false;
    if (!queryAll('#truste-consent-track, #consent_blackbar, #truste-ccpa-optout').length) return false;

    try {
      const optout =
        BYEBAR.shadow?.query('#truste-ccpa-optout') || document.getElementById('truste-ccpa-optout');
      if (optout) {
        clickElement(optout);
        return true;
      }

      if (typeof truste.bn?.declineCPRA === 'function') {
        truste.bn.declineCPRA();
        return true;
      }

      if (typeof truste.eu?.clickListener === 'function') {
        truste.eu.clickListener(7, true, { cpraConsent: '0', cpraSource: 'banner-decline-ccpa' });
        return true;
      }
    } catch {
      /* ignore */
    }

    return false;
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
      id === 'truste-ccpa-optout' ||
      id === 'truste-repop-msg' ||
      cls.includes('truste-consent') ||
      cls.includes('truste-banner') ||
      cls.includes('opt-out-button') ||
      cls.includes('cky-consent') ||
      cls.includes('cky-banner') ||
      cls.includes('cky-overlay') ||
      cls.startsWith('cky-') ||
      el.hasAttribute?.('data-cky-tag') ||
      id === 'usercentrics-root' ||
      id.includes('usercentrics') ||
      cls.includes('usercentrics') ||
      cls.includes('uc-banner') ||
      cls.startsWith('uc-') ||
      el.getAttribute?.('data-testid')?.startsWith('uc-') ||
      id === 'didomi-host' ||
      id.startsWith('didomi-') ||
      id.includes('didomi') ||
      cls.includes('didomi-') ||
      cls.includes('didomi-popup') ||
      cls.includes('didomi-consent') ||
      cls.includes('didomi-screen')
    ) {
      return true;
    }

    const text = (el.textContent || '').slice(0, 3000);
    if (text.length < 40) return false;

    const hasCookieLanguage =
      /about cookies on this site|to opt-?out of us sharing|third parties for advertising|your privacy rights|cookie preferences|privacy law|personal information|opt-?out|do not sell|similar technologies|required\)\.|we use cookies|continuing to use this website|condition of use|privacy notice|uses cookies for various purposes|mercedes-benz ag uses cookies/i.test(
        text
      );
    const hasBannerActions =
      /accept( and proceed| all)?|opt-?out|more info|reject|decline|manage preferences|do not sell or share|ablehnen|akzeptieren|nur technisch|einstellungen/i.test(
        text
      );
    const hasImpliedConsent =
      /continuing to use|by continuing|agree to this condition|you agree to this/i.test(text);
    if (!hasCookieLanguage || (!hasBannerActions && !hasImpliedConsent)) return false;

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

    queryAll(
      'button, a[role="button"], input[type="button"], input[type="submit"], [role="button"]',
      root
    ).forEach((el) => {
      if (!closestBanner(el)) return;
      if (clickIfDecline(el)) clickedAny = true;
    });

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
      '.cky-consent-container, .cky-banner-element, .cky-overlay, [data-cky-tag="notice"], #didomi-host, [class*="didomi-popup" i], [class*="didomi-consent" i], #consent_blackbar, #trustarc-banner-overlay, #truste-consent-track, #truste-consent-content, [role="dialog"], [aria-modal="true"], div, section, aside',
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

    const removed = removeViaSelectors(root) || removeViaHeuristic(root);
    if (removed || !hasDidomiBanner(root)) {
      unlockDidomiBody();
    }
    return removed;
  }

  function decline(root = document) {
    if (!BYEBAR.engine?.settings?.cookieDecline) return false;
    if (!BYEBAR.engine?.siteEnabled?.()) return false;

    if (hasDidomiBanner(root)) {
      hookDidomiReady();
    }

    const clicked =
      declineViaDidomiUi(root) ||
      declineViaSelectors(root) ||
      declineViaTextScan(root) ||
      (hasDidomiBanner(root) && declineViaDidomiApi()) ||
      (hasUsercentricsBanner(root) && declineViaUsercentricsApi()) ||
      (queryAll('#truste-consent-track, #consent_blackbar, #truste-ccpa-optout', root).length > 0 &&
        declineViaTrustArcApi());

    removeBanners(root);
    return clicked;
  }

  hookDidomiReady();
  BYEBAR.cookies = { decline, removeBanners };
})();
