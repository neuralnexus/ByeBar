/**
 * Substack page detection (mirror of lib/substack-detect.mjs).
 */
(() => {
  const SUBSTACK_HOST_PATTERNS = [/\.substack\.com$/i, /^substack\.com$/i];

  const SUBSTACK_HTML_MARKERS = [
    /substackcdn\.com/i,
    /\b[a-z0-9-]+\.substack\.com\b/i,
    /https?:\/\/(?:www\.)?substack\.com\b/i
  ];

  const SUBSTACK_DOM_SELECTORS = [
    'link[href*="substackcdn.com"]',
    'link[href*=".substack.com"]',
    'script[src*="substackcdn.com"]',
    'script[src*="substack.com"]',
    '[class*="modalViewer"]'
  ];

  function isSubstackHost(hostname) {
    return SUBSTACK_HOST_PATTERNS.some((re) => re.test(hostname || ''));
  }

  function isSubstackPageHtml(html) {
    if (!html || typeof html !== 'string') return false;
    return SUBSTACK_HTML_MARKERS.some((re) => re.test(html));
  }

  function isSubstackDom(root) {
    if (!root?.querySelector) return false;
    return SUBSTACK_DOM_SELECTORS.some((selector) => root.querySelector(selector));
  }

  function collectSubstackHtmlSample(doc = document) {
    if (!doc) return '';
    const headHtml = doc.head?.innerHTML || '';
    const earlyHtml = doc.documentElement?.innerHTML?.slice(0, 100000) || '';
    return `${headHtml}${earlyHtml}`;
  }

  function isSubstackSite(hostname, { html = '', root = null } = {}) {
    return isSubstackHost(hostname) || isSubstackPageHtml(html) || isSubstackDom(root);
  }

  function markSubstackPage() {
    document.documentElement?.setAttribute('data-byebar-substack', '');
  }

  let cached = null;

  function detectSubstackPage() {
    if (cached === true) return true;

    const detected = isSubstackSite(location.hostname, {
      html: collectSubstackHtmlSample(),
      root: document
    });

    if (detected) {
      cached = true;
      markSubstackPage();
    }

    return detected;
  }

  function recheckSubstackPage() {
    return detectSubstackPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', detectSubstackPage, { once: true });
  }

  const globalScope = typeof globalThis !== 'undefined' ? globalThis : window;
  globalScope.ByeBar = globalScope.ByeBar || {};
  globalScope.ByeBar.substackDetect = {
    isSubstackHost,
    isSubstackPageHtml,
    isSubstackDom,
    isSubstackSite,
    detectSubstackPage,
    recheckSubstackPage,
    markSubstackPage
  };
})();
