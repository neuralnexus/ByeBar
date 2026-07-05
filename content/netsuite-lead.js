/**
 * ByeBar ; redirect broken external lead forms to the brand site.
 */
(() => {
  if (window.__byeBarLeadForm) return;

  const NETSUITE_EXTFORMS_HOST_RE = /\.extforms\.netsuite\.com$/i;
  const NETSUITE_LEAD_PATH_RE = /externalleadpage/i;
  const NETSUITE_DEFAULT_BASE_URL = 'https://www.netsuite.com/';
  const EXTERNAL_LEAD_HOST_RE =
    /(?:^|[.-])(?:extforms|forms|lp|go|get|pages|landing|info|leads|marketing|secure-forms|go2)(?:[.-])/i;
  const SEARCH_REFERRER_RE =
    /^https?:\/\/(?:[^/]+\.)?(?:google\.|bing\.com|yahoo\.com|duckduckgo\.com|ecosia\.org|startpage\.com)/i;
  const NETSUITE_SCRIPT_ALERT_RE =
    /cannot read properties of null|addEventListener|pageInit|customform|nlapiPageInit|suitescript|unexpected error/i;
  const NETSUITE_ORACLE_BRANDING_RE = /oracle\s*netsuite|logos-ons|logo-ons-text-color/i;
  const LEAD_FORM_ACTION_RE =
    /externalleadpage|\/(?:lp|lead|demo|contact|request|get-started)|hubspot|marketo|pardot|salesforce/i;
  const LEAD_FORM_CLASS_RE = /hs-form|mktoForm|pardot-form|lead-form|gform_wrapper/i;
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

  function isFormInfraHost(hostname) {
    const key = hostKey(hostname);
    if (!key) return true;
    if (NETSUITE_EXTFORMS_HOST_RE.test(key)) return true;
    return EXTERNAL_LEAD_HOST_RE.test(`${key}.`);
  }

  function isExternalLeadUrl(url) {
    try {
      const parsed = new URL(url);
      const path = `${parsed.pathname}${parsed.search}`;
      if (NETSUITE_EXTFORMS_HOST_RE.test(parsed.hostname) && NETSUITE_LEAD_PATH_RE.test(path)) {
        return true;
      }
      return EXTERNAL_LEAD_HOST_RE.test(`${parsed.hostname}.`);
    } catch {
      return false;
    }
  }

  function isSearchReferrer(referrer) {
    return SEARCH_REFERRER_RE.test(referrer || '');
  }

  function normalizeRedirectTarget(url, currentHostname = location.hostname) {
    try {
      const parsed = new URL(url);
      if (isBlockedRedirectHost(parsed.hostname)) return null;
      if (isFormInfraHost(parsed.hostname)) return null;
      if (currentHostname && hostKey(parsed.hostname) === hostKey(currentHostname)) return null;
      return `${parsed.protocol}//${parsed.hostname}/`;
    } catch {
      return null;
    }
  }

  function isNetSuiteScriptAlert(message) {
    return NETSUITE_SCRIPT_ALERT_RE.test(message || '');
  }

  function looksLikeLeadCaptureForm(doc) {
    const html = doc.documentElement?.outerHTML || '';
    const hasEmailField =
      doc.querySelector?.(
        'form input[name="email"], form input#email, form input[type="email"], form [data-fieldtype="email"]'
      ) ||
      /(?:name|id)=["']email["']/i.test(html) ||
      /type=["']email["']/i.test(html);

    if (!hasEmailField) return false;

    const form =
      doc.querySelector?.('form#main_form') ||
      doc.querySelector?.('form[action*="externalleadpage" i]') ||
      doc.querySelector?.('form');

    if (!form) return false;

    const formHtml = form.outerHTML || '';
    return Boolean(
      form.id === 'main_form' ||
      /externalleadpage/i.test(form.getAttribute('action') || '') ||
      LEAD_FORM_ACTION_RE.test(formHtml) ||
      LEAD_FORM_CLASS_RE.test(formHtml) ||
      isExternalLeadUrl(location.href) ||
      (form.querySelector?.('input[type="submit"], button[type="submit"]') &&
        isFormInfraHost(location.hostname))
    );
  }

  function brandHostnameFromDocument(doc) {
    const canonical = doc.querySelector?.('link[rel="canonical"]')?.href;
    const canonicalTarget = normalizeRedirectTarget(canonical || '');
    if (canonicalTarget) {
      try {
        return new URL(canonicalTarget).hostname;
      } catch {
        /* ignore */
      }
    }

    const ogUrl =
      doc.querySelector?.('meta[property="og:url"]')?.content ||
      doc.querySelector?.('meta[name="twitter:url"]')?.content;
    const ogTarget = normalizeRedirectTarget(ogUrl || '');
    if (ogTarget) {
      try {
        return new URL(ogTarget).hostname;
      } catch {
        /* ignore */
      }
    }

    return '';
  }

  function isExternalLeadContext(doc = document) {
    if (!looksLikeLeadCaptureForm(doc)) return false;
    if (isExternalLeadUrl(location.href)) return true;
    if (isSearchReferrer(document.referrer)) return true;
    if (isFormInfraHost(location.hostname)) return true;

    const brandHost = brandHostnameFromDocument(doc);
    if (brandHost && hostKey(brandHost) !== hostKey(location.hostname)) return true;

    return false;
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

    return null;
  }

  function maybeRedirect(doc = document) {
    if (redirected || !shouldRedirect) return;
    if (!isExternalLeadContext(doc)) return;

    const target = resolveBaseDomain(doc);
    if (!target) return;

    try {
      if (hostKey(new URL(target).hostname) === hostKey(location.hostname)) return;
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

  if (isExternalLeadUrl(location.href) || isFormInfraHost(location.hostname)) {
    const nativeAlert = window.alert;
    window.alert = function patchedAlert(message) {
      if (isNetSuiteScriptAlert(message)) {
        maybeRedirect(document);
        return;
      }
      return nativeAlert.apply(window, arguments);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => maybeRedirect(document), { once: true });
  } else {
    maybeRedirect(document);
  }

  window.__byeBarLeadForm = true;

  void storageGet(DEFAULTS).then(updateFromSettings);
  onStorageChanged(() => {
    void storageGet(DEFAULTS).then(updateFromSettings);
  });

  (window.ByeBar = window.ByeBar || {}).leadForm = {
    get shouldRedirect() {
      return shouldRedirect;
    }
  };
})();
