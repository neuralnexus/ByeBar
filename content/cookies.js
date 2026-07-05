/**
 * ByeBar cookie consent ; auto-decline when a reject button is found.
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

  function isKnownCmpNode(el) {
    if (!el || el.nodeType !== 1) return false;
    const id = (el.id || '').toLowerCase();
    const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';

    return (
      id === 'sp-cc' ||
      id.startsWith('sp_message_') ||
      cls.includes('sp_message') ||
      cls.includes('sp_choice_type') ||
      id === 'fc-consent-root' ||
      cls.includes('fc-consent') ||
      cls.includes('fc-dialog') ||
      id.startsWith('cybotcookiebot') ||
      cls.includes('cybotcookiebot') ||
      cls.includes('qc-cmp2') ||
      id.startsWith('iubenda-cs-') ||
      cls.includes('iubenda-cs-') ||
      cls.includes('iub-cmp') ||
      id === 'termly-code-snippet-support' ||
      id.startsWith('termly-') ||
      cls.includes('termly') ||
      cls.includes('t-consent-banner') ||
      id === 'lanyard-root' ||
      id.startsWith('ketch-') ||
      cls.includes('ketch-banner') ||
      id === 'borlabscookiebox' ||
      cls.includes('borlabs') ||
      cls.includes('brlbs-') ||
      id === 'cmplz-cookiebanner-container' ||
      id.startsWith('cmplz-') ||
      cls.includes('cmplz-') ||
      id.startsWith('moove_gdpr') ||
      cls.includes('moove-gdpr') ||
      id === 'cmpbox' ||
      id === 'cmpbox2' ||
      cls.includes('cmpwrapper') ||
      id.startsWith('onetrust') ||
      cls.includes('onetrust') ||
      cls.includes('ot-sdk') ||
      id === 'cookieyes-banner' ||
      cls.includes('cky-consent') ||
      cls.includes('cky-banner') ||
      cls.startsWith('cky-') ||
      el.hasAttribute?.('data-cky-tag') ||
      id === 'usercentrics-root' ||
      id.includes('usercentrics') ||
      cls.includes('usercentrics') ||
      cls.startsWith('uc-') ||
      id === 'didomi-host' ||
      id.startsWith('didomi-') ||
      cls.includes('didomi-')
    );
  }

  function hasSourcepointBanner(root = document) {
    return (
      queryAll(
        '#sp-cc, [id^="sp_message_container"], .sp_message_container, iframe[id^="sp_message_iframe"]',
        root
      ).length > 0 || Boolean(root.defaultView?._sp_)
    );
  }

  function hasCookiebotBanner(root = document) {
    return (
      queryAll('#CybotCookiebotDialog, .CybotCookiebotDialogActive', root).length > 0 ||
      Boolean(root.defaultView?.Cookiebot)
    );
  }

  function hasQuantcastBanner(root = document) {
    return queryAll('.qc-cmp2-container', root).length > 0 || typeof root.defaultView?.__cmp === 'function';
  }

  function hasIubendaBanner(root = document) {
    return (
      queryAll('#iubenda-cs-banner, [id^="iubenda-cs-"]', root).length > 0 ||
      Boolean(root.defaultView?._iub?.cs?.api)
    );
  }

  function hasOneTrustBanner(root = document) {
    return (
      queryAll('#onetrust-banner-sdk, #onetrust-consent-sdk', root).length > 0 ||
      Boolean(root.defaultView?.OneTrust || root.defaultView?.Optanon)
    );
  }

  function hasKetchBanner(root = document) {
    return (
      queryAll('#lanyard-root, [id^="ketch-"]', root).length > 0 ||
      typeof root.defaultView?.ketch === 'function'
    );
  }

  function declineViaSourcepointApi() {
    if (!hasSourcepointBanner()) return false;

    try {
      const sp = window._sp_;
      if (!sp) return false;

      for (const scope of [sp.gdpr, sp.cc, sp.usnat, sp.ccpa, sp]) {
        if (scope && typeof scope.rejectAll === 'function') {
          scope.rejectAll();
          return true;
        }
      }
    } catch {
      /* ignore */
    }

    return false;
  }

  function declineViaCookiebotApi() {
    if (!hasCookiebotBanner()) return false;

    try {
      const bot = window.Cookiebot;
      if (!bot) return false;
      if (typeof bot.withdraw === 'function') {
        bot.withdraw();
        return true;
      }
      if (typeof bot.hide === 'function') {
        bot.hide();
        return true;
      }
    } catch {
      /* ignore */
    }

    return false;
  }

  function declineViaQuantcastApi() {
    if (!hasQuantcastBanner()) return false;

    try {
      if (typeof window.__cmp === 'function') {
        window.__cmp('rejectAll');
        return true;
      }
    } catch {
      /* ignore */
    }

    return false;
  }

  function declineViaIubendaApi() {
    if (!hasIubendaBanner()) return false;

    try {
      const api = window._iub?.cs?.api;
      if (!api) return false;
      if (typeof api.reject === 'function') {
        api.reject();
        return true;
      }
      if (typeof api.close === 'function') {
        api.close();
        return true;
      }
    } catch {
      /* ignore */
    }

    return false;
  }

  function declineViaOneTrustApi() {
    if (!hasOneTrustBanner()) return false;

    try {
      if (typeof window.OneTrust?.RejectAll === 'function') {
        window.OneTrust.RejectAll();
        return true;
      }
      if (typeof window.Optanon?.RejectAll === 'function') {
        window.Optanon.RejectAll();
        return true;
      }
    } catch {
      /* ignore */
    }

    return false;
  }

  function declineViaKetchApi() {
    if (!hasKetchBanner()) return false;

    try {
      if (typeof window.ketch === 'function') {
        window.ketch('deny', { showRightsForm: false });
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
      cls.includes('didomi-screen') ||
      isKnownCmpNode(el)
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
      '.cky-consent-container, .cky-banner-element, .cky-overlay, [data-cky-tag="notice"], #didomi-host, [class*="didomi-popup" i], [class*="didomi-consent" i], #sp-cc, [id^="sp_message_container"], .fc-consent-root, #iubenda-cs-banner, #termly-code-snippet-support, #lanyard-root, #BorlabsCookieBox, #cmplz-cookiebanner-container, #moove_gdpr_cookie_info_bar, #cookie-notice, #cmpbox, #consent_blackbar, #trustarc-banner-overlay, #truste-consent-track, #truste-consent-content, [role="dialog"], [aria-modal="true"], div, section, aside',
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
      (hasSourcepointBanner(root) && declineViaSourcepointApi()) ||
      (hasCookiebotBanner(root) && declineViaCookiebotApi()) ||
      (hasQuantcastBanner(root) && declineViaQuantcastApi()) ||
      (hasIubendaBanner(root) && declineViaIubendaApi()) ||
      (hasOneTrustBanner(root) && declineViaOneTrustApi()) ||
      (hasKetchBanner(root) && declineViaKetchApi()) ||
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
