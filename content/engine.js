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

  function nukeModalViewer() {
    if (!BYEBAR.isSubstack()) return;
    const viewer = document.querySelector('[class*="modalViewer"]');
    if (viewer?.children.length) {
      Array.from(viewer.children).forEach(removeElement);
    }
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
    nukeModalViewer();
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
        if (settings.cookieDecline && BYEBAR.cookies?.decline) {
          BYEBAR.cookies.decline(document);
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
    if (settings.cookieDecline && BYEBAR.cookies?.decline) {
      BYEBAR.cookies.decline(document);
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