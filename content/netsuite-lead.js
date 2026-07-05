/**
 * ByeBar ; redirect broken NetSuite external lead forms to the brand site.
 */
(() => {
  if (window.__byeBarNetSuiteLead) return;

  const NETSUITE_EXTFORMS_HOST_RE = /\.extforms\.netsuite\.com$/i;
  const NETSUITE_LEAD_PATH_RE = /externalleadpage/i;
  const NETSUITE_DEFAULT_BASE_URL = 'https://www.netsuite.com/';
  const NETSUITE_SCRIPT_ALERT_RE =
    /cannot read properties of null|addEventListener|pageInit|customform|nlapiPageInit|suitescript|unexpected error/i;
  const NETSUITE_ORACLE_BRANDING_RE = /oracle\s*netsuite|logos-ons|logo-ons-text-color/i;
  const BLOCKED_REDIRECT_HOSTS = [
    /^extforms\.netsuite\.com$/i,
    /\.extforms\.netsuite\.com$/i,
    /^google\./i,
    /^www\.google\./i,
    /^bing\.com$/i,
    /^www\.bing\.com$/i,
    /^yahoo\.com$/i,
    /^www\.yahoo\.com$/i,
    /^duckduckgo\.com$/i,
    /^www\.duckduckgo\.com$/i,
    /^facebook\.com$/i,
    /^www\.facebook\.com$/i,
    /^t\.co$/i,
    /^linkedin\.com$/i,
    /^www\.linkedin\.com$/i,
    /^instagram\.com$/i,
    /^www\.instagram\.com$/i,
    /^doubleclick\.net$/i,
    /googlesyndication\.com$/i
  ];

  function isNetSuiteExtLeadUrl(url) {
    try {
      const parsed = new URL(url);
      const path = `${parsed.pathname}${parsed.search}`;
      return NETSUITE_EXTFORMS_HOST_RE.test(parsed.hostname) && NETSUITE_LEAD_PATH_RE.test(path);
    } catch {
      return false;
    }
  }

  if (!isNetSuiteExtLeadUrl(location.href)) return;

  const BYEBAR = window.ByeBar;
  const { storageGet, onStorageChanged } = BYEBAR?.browser || {};
  if (!storageGet) return;

  const DEFAULTS = {
    enabled: true,
    netsuiteLeadRedirect: true,
    siteOverrides: {}
  };

  let shouldRedirect = true;
  let redirected = false;

  function hostKey(hostname) {
    return (hostname || '').replace(/^www\./i, '');
  }

  function isBlockedRedirectHost(hostname) {
    const key = hostKey(hostname);
    if (!key) return true;
    return BLOCKED_REDIRECT_HOSTS.some((re) => re.test(key));
  }

  function normalizeRedirectTarget(url) {
    try {
      const parsed = new URL(url);
      if (isBlockedRedirectHost(parsed.hostname)) return null;
      if (NETSUITE_EXTFORMS_HOST_RE.test(parsed.hostname)) return null;
      return `${parsed.protocol}//${parsed.hostname}/`;
    } catch {
      return null;
    }
  }

  function isNetSuiteScriptAlert(message) {
    return NETSUITE_SCRIPT_ALERT_RE.test(message || '');
  }

  function looksLikeLeadCaptureForm(doc) {
    const form =
      doc.querySelector?.('form#main_form') || doc.querySelector?.('form[action*="externalleadpage" i]');
    if (!form) return false;

    return Boolean(
      form.querySelector?.('input[name="email"], input#email, input[type="email"], [data-fieldtype="email"]')
    );
  }

  function hasOracleNetSuiteBranding(doc) {
    const html = doc.documentElement?.outerHTML || '';
    return NETSUITE_ORACLE_BRANDING_RE.test(html);
  }

  function resolveBaseDomain(doc) {
    const referrer = document.referrer || '';
    if (referrer) {
      try {
        const fromReferrer = normalizeRedirectTarget(referrer);
        if (fromReferrer && !isBlockedRedirectHost(new URL(referrer).hostname)) {
          return fromReferrer;
        }
      } catch {
        /* ignore */
      }
    }

    const canonical = doc.querySelector?.('link[rel="canonical"]')?.href;
    const canonicalTarget = normalizeRedirectTarget(canonical || '');
    if (canonicalTarget) return canonicalTarget;

    const ogUrl =
      doc.querySelector?.('meta[property="og:url"]')?.content ||
      doc.querySelector?.('meta[name="twitter:url"]')?.content;
    const ogTarget = normalizeRedirectTarget(ogUrl || '');
    if (ogTarget) return ogTarget;

    const logoSelectors = ['header a[href^="http"]', '.header-left a[href^="http"]', '.logo a[href^="http"]'];
    for (const selector of logoSelectors) {
      for (const anchor of doc.querySelectorAll?.(selector) || []) {
        const normalized = normalizeRedirectTarget(anchor.href || '');
        if (normalized) return normalized;
      }
    }

    for (const anchor of doc.querySelectorAll?.('a[href^="http"]') || []) {
      const normalized = normalizeRedirectTarget(anchor.href || '');
      if (normalized) return normalized;
    }

    if (hasOracleNetSuiteBranding(doc)) {
      return NETSUITE_DEFAULT_BASE_URL;
    }

    return NETSUITE_DEFAULT_BASE_URL;
  }

  function maybeRedirect(doc = document) {
    if (redirected || !shouldRedirect) return;
    if (!looksLikeLeadCaptureForm(doc)) return;

    const target = resolveBaseDomain(doc);
    if (!target) return;

    try {
      if (new URL(target).hostname === location.hostname) return;
    } catch {
      return;
    }

    redirected = true;
    location.replace(target);
  }

  function updateFromSettings(settings) {
    const key = hostKey(location.hostname);
    const siteOn = key in settings.siteOverrides ? settings.siteOverrides[key] : settings.enabled;
    shouldRedirect = Boolean(siteOn && settings.netsuiteLeadRedirect);
    if (shouldRedirect) {
      maybeRedirect(document);
    }
  }

  const nativeAlert = window.alert;
  window.alert = function patchedAlert(message) {
    if (isNetSuiteScriptAlert(message)) {
      maybeRedirect(document);
      return;
    }
    return nativeAlert.apply(window, arguments);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => maybeRedirect(document), { once: true });
  } else {
    maybeRedirect(document);
  }

  window.__byeBarNetSuiteLead = true;

  void storageGet(DEFAULTS).then(updateFromSettings);
  onStorageChanged(() => {
    void storageGet(DEFAULTS).then(updateFromSettings);
  });

  (window.ByeBar = window.ByeBar || {}).netsuiteLead = {
    get shouldRedirect() {
      return shouldRedirect;
    }
  };
})();
