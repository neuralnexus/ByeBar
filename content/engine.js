/**
 * ByeBar engine — settings, DOM removal, mutation observer.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const DEFAULTS = {
    enabled: true,
    genericBlocking: true,
    cookieDecline: true,
    tosAccept: true,
    locationDecline: true,
    netsuiteLeadRedirect: true,
    siteOverrides: {}
  };

  let settings = { ...DEFAULTS };
  let activeSelectors = [];
  let combinedSelector = '';
  let observer = null;
  let pending = false;

  const { storageGet, onStorageChanged } = BYEBAR.browser;

  function hostKey() {
    return location.hostname.replace(/^www\./i, '');
  }

  function siteEnabled() {
    const key = hostKey();
    if (key in settings.siteOverrides) return settings.siteOverrides[key];
    return settings.enabled;
  }

  function buildSelectors() {
    const selectors = new Set();

    if (!siteEnabled()) return [];

    if (settings.cookieDecline) {
      BYEBAR.COOKIE_HIDE.forEach((s) => selectors.add(s));
    }

    if (settings.tosAccept) {
      BYEBAR.TOS_HIDE.forEach((s) => selectors.add(s));
    }

    if (BYEBAR.isBloomberg?.()) {
      BYEBAR.SITE_RULES.bloomberg.remove.forEach((s) => selectors.add(s));
    }

    if (BYEBAR.isChinaCommerce?.()) {
      BYEBAR.SITE_RULES.chinaCommerce.remove.forEach((s) => selectors.add(s));
    }

    if (BYEBAR.isSubstack()) {
      BYEBAR.SITE_RULES.substack.remove.forEach((s) => selectors.add(s));
    }

    if (settings.genericBlocking) {
      BYEBAR.GENERIC_REMOVE.forEach((s) => selectors.add(s));
    }

    return [...selectors];
  }

  function refreshSelectors() {
    activeSelectors = buildSelectors();
    combinedSelector = activeSelectors.join(',');
  }

  function removeElement(el) {
    if (!el?.parentNode) return;
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

  const SUBSTACK_MODAL_TEXT_RE =
    /join\s+.+\s+on\s+substack|the home for great writing|get the app|sign in.*get the app/i;
  const SUBSTACK_PANEL_CLASS_RE = /\bpanel-[A-Za-z0-9_-]+\b/;

  function matchesSubstackSignupText(text) {
    const sample = (text || '').replace(/\s+/g, ' ').trim();
    if (!sample || sample.length > 2000) return false;
    return SUBSTACK_MODAL_TEXT_RE.test(sample);
  }

  function isSubstackRadixDialog(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.getAttribute('role') !== 'dialog') return false;

    const id = el.id || '';
    const cls = typeof el.className === 'string' ? el.className : '';

    if (el.getAttribute('data-testid') === 'modal') return true;
    if (id.startsWith('radix-')) return true;
    if (SUBSTACK_PANEL_CLASS_RE.test(cls)) return true;
    if (el.querySelector?.('[data-modal-role="header"], [data-modal-role="footer"]')) return true;

    return false;
  }

  function looksLikeSubstackSignupModal(el) {
    if (!el || el.nodeType !== 1) return false;

    if (isSubstackRadixDialog(el)) {
      const text = el.textContent || '';
      if (matchesSubstackSignupText(text)) return true;
      return Boolean(el.querySelector?.('button, a[role="button"]') && /get the app|sign in/i.test(text));
    }

    if (el.getAttribute('role') !== 'dialog' && el.getAttribute('aria-modal') !== 'true') {
      return false;
    }

    return matchesSubstackSignupText(el.textContent || '');
  }

  function isSubstackScrim(el) {
    if (!el || el.nodeType !== 1) return false;
    const cls = typeof el.className === 'string' ? el.className : '';
    const id = el.id || '';

    if (
      id.startsWith('radix-') &&
      el.getAttribute('data-state') === 'open' &&
      el.getAttribute('role') !== 'dialog'
    ) {
      return true;
    }

    if ((el.textContent || '').trim().length > 0) return false;

    // Substack modal dimmer, e.g. <div class="background-qPxN3C" style="opacity: 0.5">
    if (/\bbackground-[A-Za-z0-9_-]+\b/.test(cls)) return true;

    const hasBackdropClass =
      /\boverlay-[A-Za-z0-9_-]+\b/.test(cls) || /modalScrim|modal-scrim|ModalScrim/i.test(cls);
    if (!hasBackdropClass) return false;

    const style = getComputedStyle(el);
    const fixed = style.position === 'fixed' || style.position === 'absolute';
    if (!fixed) return false;

    const rect = el.getBoundingClientRect();
    return rect.width >= window.innerWidth * 0.5 && rect.height >= window.innerHeight * 0.5;
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

  function hasBloombergModuleClass(el) {
    const cls = typeof el?.className === 'string' ? el.className : '';
    return /_showOn(?:Mobile|Desktop)/.test(cls);
  }

  function matchesBloombergPromoText(text) {
    const sample = (text || '').replace(/\s+/g, ' ').trim();
    if (!sample || sample.length > 500) return false;
    return /flash sale|save up to \d+%|subscribe for (just )?\$?\d|limited[- ]time offer|get \d+% off|off your first (month|year)|unlock your offer/i.test(
      sample
    );
  }

  function findBloombergPromoRoot(el) {
    if (!el) return null;

    let node = el;
    let anchorMatch = null;

    for (let depth = 0; depth < 12 && node; depth++) {
      const tag = node.tagName;
      const href = node.getAttribute?.('href') || '';

      if (tag === 'A' && /\/subscriptions|subscribe|offer|flash/i.test(href)) {
        anchorMatch = node;
      }

      const style = getComputedStyle(node);
      if (style.position === 'fixed' || style.position === 'sticky') {
        return node;
      }

      if (node.getAttribute?.('role') === 'banner' || tag === 'HEADER' || tag === 'NAV') {
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

    return anchorMatch || el;
  }

  function looksLikeBloombergPromo(el) {
    if (!el || el.nodeType !== 1 || !BYEBAR.isBloomberg?.()) return false;
    if (el.getAttribute('data-byebar-hidden')) return false;

    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!matchesBloombergPromoText(text)) return false;

    if (
      hasBloombergModuleClass(el) ||
      el.querySelector?.('[class*="_showOnMobile"], [class*="_showOnDesktop"]')
    ) {
      return true;
    }

    const style = getComputedStyle(el);
    const positioned =
      style.position === 'fixed' ||
      style.position === 'sticky' ||
      style.position === 'absolute' ||
      parseInt(style.zIndex, 10) >= 50;

    if (!positioned) return false;

    const rect = el.getBoundingClientRect();
    return rect.width >= window.innerWidth * 0.4 && rect.height <= 200;
  }

  function nukeBloombergPromos(root = document) {
    if (!BYEBAR.isBloomberg?.() || !siteEnabled()) return;

    const seen = new Set();

    queryMatches('[class*="_showOnMobile"], [class*="_showOnDesktop"]', root).forEach((el) => {
      const promoRoot = findBloombergPromoRoot(el);
      if (!promoRoot || seen.has(promoRoot)) return;
      seen.add(promoRoot);
      removeElement(promoRoot);
    });

    queryMatches('a[href*="/subscriptions"], [role="banner"], header, nav, div, section', root).forEach(
      (el) => {
        if (!looksLikeBloombergPromo(el)) return;
        const promoRoot = findBloombergPromoRoot(el);
        if (!promoRoot || seen.has(promoRoot)) return;
        seen.add(promoRoot);
        removeElement(promoRoot);
      }
    );
  }

  function nukeSubstackLayers(root = document) {
    if (!BYEBAR.isSubstack() && !settings.genericBlocking) return;

    const seen = new Set();

    const nukeModal = (el) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      removeElement(el);
    };

    if (BYEBAR.isSubstack()) {
      root.querySelectorAll('[class*="modalViewer"]').forEach((viewer) => {
        Array.from(viewer.children).forEach(nukeModal);
        if (!viewer.children.length && viewer.parentNode) {
          nukeModal(viewer);
        }
      });
    }

    queryMatches(
      '[role="dialog"][data-testid="modal"], [role="dialog"][id^="radix-"], [role="dialog"][class*="panel-"], [data-radix-portal] [role="dialog"], [role="dialog"], [aria-modal="true"]',
      root
    ).forEach((el) => {
      if (
        BYEBAR.isSubstack()
          ? looksLikeSubstackSignupModal(el) || isSubstackRadixDialog(el)
          : looksLikeSubstackSignupModal(el)
      ) {
        nukeModal(el);
      }
    });

    root
      .querySelectorAll('[class^="background-"], [class^="overlay-"], [id^="radix-"][data-state="open"]')
      .forEach((el) => {
        if (isSubstackScrim(el)) nukeModal(el);
      });

    root.querySelectorAll('body > div, body > div > div').forEach((el) => {
      if (isSubstackScrim(el)) nukeModal(el);
    });

    unlockPageScroll();
  }

  function looksLikeOverlay(el) {
    if (!el || el.nodeType !== 1) return false;
    if (BYEBAR.chinaCommerce?.looksLikeSpinner?.(el)) return false;
    if (el.closest('header, nav, footer, main article')) {
      const tag = el.tagName;
      if (tag !== 'DIALOG' && el.getAttribute('role') !== 'dialog') return false;
    }

    const style = getComputedStyle(el);
    const fixed = style.position === 'fixed' || style.position === 'sticky';
    const highZ = parseInt(style.zIndex, 10) >= 100 || style.zIndex === 'auto';
    const text = (el.textContent || '').toLowerCase();
    const keywords =
      /subscribe|newsletter|sign\s*up|email\s*list|get\s+\d+%|discount|coupon|off\s+your|join\s+our|join\s+.+\s+on\s+substack|get the app|great writing/i;

    if (el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true') {
      if (looksLikeSubstackSignupModal(el)) return true;
      return keywords.test(text) || keywords.test(el.className) || keywords.test(el.id || '');
    }

    if (fixed && highZ && keywords.test(text) && text.length < 2000) {
      const rect = el.getBoundingClientRect();
      const nearBottom = rect.top > window.innerHeight * 0.55;
      const fullWidth = rect.width > window.innerWidth * 0.6;
      if (nearBottom && fullWidth) return true;
    }

    return false;
  }

  function heuristicScan(root) {
    if (!settings.genericBlocking || !siteEnabled()) return;

    const heuristicSelector = BYEBAR.safari?.normalizeSelector?.(
      '[role="dialog"], [aria-modal="true"], [class*="popup" i], [class*="modal" i], [class*="overlay" i]'
    );
    let candidates = [];
    try {
      candidates = root.querySelectorAll(heuristicSelector);
    } catch {
      return;
    }

    candidates.forEach((el) => {
      if (el.getAttribute('data-byebar-hidden')) return;
      if (looksLikeOverlay(el)) removeElement(el);
    });
  }

  function queryMatches(selector, root = document) {
    if (BYEBAR.shadow?.queryAll) return BYEBAR.shadow.queryAll(selector, root);
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return [];
    }
  }

  function nukeAll(root = document) {
    if (!siteEnabled() || !combinedSelector) return;

    activeSelectors.forEach((selector) => {
      queryMatches(selector, root).forEach(removeElement);
    });
    nukeSubstackLayers(root);
    nukeBloombergPromos(root);
    BYEBAR.chinaCommerce?.nukeSpinners?.(root);
    heuristicScan(root);
  }

  function startObserver() {
    if (observer || !document.documentElement) return;

    observer = new MutationObserver(() => {
      if (pending || !siteEnabled()) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        if (BYEBAR.shadow?.watchShadowRoots) {
          BYEBAR.shadow.watchShadowRoots(observer, document.documentElement);
        }
        nukeAll(document);
        if (settings.cookieDecline && BYEBAR.cookies) {
          BYEBAR.cookies.decline(document);
          BYEBAR.cookies.removeBanners?.(document);
        }
        if (settings.tosAccept && BYEBAR.tos) {
          BYEBAR.tos.accept(document);
          BYEBAR.tos.removeModals?.(document);
        }
      });
    });

    const observe = () => {
      if (BYEBAR.shadow?.watchShadowRoots) {
        BYEBAR.shadow.watchShadowRoots(observer, document.documentElement);
      } else if (document.documentElement) {
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [
            'class',
            'style',
            'aria-label',
            'aria-modal',
            'aria-hidden',
            'data-intro-popup',
            'open'
          ]
        });
      }
    };

    observe();
  }

  function stopObserver() {
    observer?.disconnect();
    observer = null;
  }

  function applySettings(next) {
    settings = { ...DEFAULTS, ...next };
    refreshSelectors();

    if (!siteEnabled()) {
      stopObserver();
      return;
    }

    nukeAll(document);
    if (settings.cookieDecline && BYEBAR.cookies) {
      BYEBAR.cookies.decline(document);
      BYEBAR.cookies.removeBanners?.(document);
    }
    if (settings.tosAccept && BYEBAR.tos) {
      BYEBAR.tos.accept(document);
      BYEBAR.tos.removeModals?.(document);
    }
    startObserver();
  }

  async function loadSettings() {
    const stored = await storageGet(DEFAULTS);
    applySettings(stored);
    return settings;
  }

  onStorageChanged((changes) => {
    const next = { ...settings };
    for (const [key, change] of Object.entries(changes)) {
      next[key] = change.newValue;
    }
    applySettings(next);
  });

  BYEBAR.engine = {
    loadSettings,
    applySettings,
    nukeAll,
    siteEnabled,
    hostKey,
    get settings() {
      return settings;
    }
  };
})();
