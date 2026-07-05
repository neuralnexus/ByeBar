/**
 * ByeBar engine — settings, DOM removal, mutation observer.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const DEFAULTS = {
    enabled: true,
    genericBlocking: true,
    cookieDecline: true,
    siteOverrides: {}
  };

  let settings = { ...DEFAULTS };
  let activeSelectors = [];
  let combinedSelector = '';
  let observer = null;
  let pending = false;

  const storage = chrome.storage?.sync || chrome.storage?.local;

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

  function isSubstackScrim(el) {
    if (!el || el.nodeType !== 1) return false;
    const cls = typeof el.className === 'string' ? el.className : '';
    if ((el.textContent || '').trim().length > 0) return false;

    // Substack modal dimmer, e.g. <div class="background-qPxN3C" style="opacity: 0.5">
    if (/\bbackground-[A-Za-z0-9_-]+\b/.test(cls)) return true;

    const hasBackdropClass =
      /\boverlay-[A-Za-z0-9_-]+\b/.test(cls) ||
      /modalScrim|modal-scrim|ModalScrim/i.test(cls);
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

  function nukeSubstackLayers() {
    if (!BYEBAR.isSubstack()) return;

    document.querySelectorAll('[class*="modalViewer"]').forEach((viewer) => {
      Array.from(viewer.children).forEach(removeElement);
      if (!viewer.children.length && viewer.parentNode) {
        removeElement(viewer);
      }
    });

    document.querySelectorAll('[class^="background-"], [class^="overlay-"]').forEach((el) => {
      if (isSubstackScrim(el)) removeElement(el);
    });

    document.querySelectorAll('body > div, body > div > div').forEach((el) => {
      if (isSubstackScrim(el)) removeElement(el);
    });

    unlockPageScroll();
  }

  function looksLikeOverlay(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('header, nav, footer, main article')) {
      const tag = el.tagName;
      if (tag !== 'DIALOG' && el.getAttribute('role') !== 'dialog') return false;
    }

    const style = getComputedStyle(el);
    const fixed = style.position === 'fixed' || style.position === 'sticky';
    const highZ = parseInt(style.zIndex, 10) >= 100 || style.zIndex === 'auto';
    const text = (el.textContent || '').toLowerCase();
    const keywords = /subscribe|newsletter|sign\s*up|email\s*list|get\s+\d+%|discount|coupon|off\s+your|join\s+our/i;

    if (el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true') {
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

    const candidates = root.querySelectorAll(
      '[role="dialog"], [aria-modal="true"], [class*="popup" i], [class*="modal" i], [class*="overlay" i]'
    );

    candidates.forEach((el) => {
      if (el.getAttribute('data-byebar-hidden')) return;
      if (looksLikeOverlay(el)) removeElement(el);
    });
  }

  function nukeAll(root = document) {
    if (!siteEnabled() || !combinedSelector) return;

    let matches = [];
    try {
      matches = root.querySelectorAll(combinedSelector);
    } catch {
      return;
    }

    matches.forEach(removeElement);
    nukeSubstackLayers();
    heuristicScan(root);
  }

  function startObserver() {
    if (observer || !document.documentElement) return;

    observer = new MutationObserver(() => {
      if (pending || !siteEnabled()) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        nukeAll(document);
        if (settings.cookieDecline && BYEBAR.cookies) {
          BYEBAR.cookies.decline(document);
          BYEBAR.cookies.removeBanners?.(document);
        }
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-label', 'aria-modal', 'aria-hidden', 'data-intro-popup', 'open']
    });
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
    startObserver();
  }

  function loadSettings() {
    return new Promise((resolve) => {
      storage.get(DEFAULTS, (stored) => {
        applySettings(stored);
        resolve(settings);
      });
    });
  }

  storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' && area !== 'local') return;
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