import { hostKey } from './host.mjs';

export const NETSUITE_EXTFORMS_HOST_RE = /\.extforms\.netsuite\.com$/i;
export const NETSUITE_LEAD_PATH_RE = /externalleadpage/i;
export const NETSUITE_DEFAULT_BASE_URL = 'https://www.netsuite.com/';

export const EXTERNAL_LEAD_PATH_RE =
  /externalleadpage|\/(?:lp|lead|leads|demo|contact|request|get-started|free-trial|signup|register)(?:\/|$|\?)/i;

export const EXTERNAL_LEAD_HOST_RE =
  /(?:^|[.-])(?:extforms|forms|lp|go|get|pages|landing|info|leads|marketing|secure-forms|go2)(?:[.-])/i;

export const SEARCH_REFERRER_RE =
  /^https?:\/\/(?:[^/]+\.)?(?:google\.|bing\.com|yahoo\.com|duckduckgo\.com|ecosia\.org|startpage\.com)/i;

export const NETSUITE_SCRIPT_ALERT_RE =
  /cannot read properties of null|addEventListener|pageInit|customform|nlapiPageInit|suitescript|unexpected error/i;

export const NETSUITE_ORACLE_BRANDING_RE = /oracle\s*netsuite|logos-ons|logo-ons-text-color/i;

export const LEAD_FORM_ACTION_RE =
  /externalleadpage|\/(?:lp|lead|demo|contact|request|get-started)|hubspot|marketo|pardot|salesforce|pardot/i;

export const LEAD_FORM_CLASS_RE = /hs-form|mktoForm|pardot-form|lead-form|gform_wrapper/i;

export const NETSUITE_REDIRECT_BLOCKLIST = [
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

const META_URL_RE =
  /<meta[^>]+(?:property|name)=["'](?:og:url|twitter:url)["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:url|twitter:url)["'][^>]*>/i;

const CANONICAL_RE =
  /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>|<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i;

const HTTP_HREF_RE = /href=["'](https?:\/\/[^"'#]+)["']/gi;

export function isNetSuiteExtLeadUrl(url) {
  return isExternalLeadUrl(url) && NETSUITE_EXTFORMS_HOST_RE.test(safeHostname(url));
}

export function isExternalLeadUrl(url) {
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

export function isSearchReferrer(referrer) {
  return SEARCH_REFERRER_RE.test(referrer || '');
}

export function shouldRedirectNetSuiteLead(settings, hostname) {
  const key = hostKey(hostname);
  const siteOn =
    key && settings?.siteOverrides && key in settings.siteOverrides
      ? settings.siteOverrides[key]
      : settings?.enabled;
  return Boolean(siteOn && settings?.netsuiteLeadRedirect);
}

export function isBlockedRedirectHost(hostname) {
  const key = hostKey(hostname);
  if (!key) return true;
  return NETSUITE_REDIRECT_BLOCKLIST.some((re) => re.test(key));
}

export function isAdOrSearchReferrer(hostname) {
  return isBlockedRedirectHost(hostname);
}

export function isFormInfraHost(hostname) {
  const key = hostKey(hostname);
  if (!key) return true;
  if (NETSUITE_EXTFORMS_HOST_RE.test(key)) return true;
  return EXTERNAL_LEAD_HOST_RE.test(`${key}.`);
}

export function normalizeRedirectTarget(url, currentHostname = '') {
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

export function isNetSuiteScriptAlert(message) {
  return NETSUITE_SCRIPT_ALERT_RE.test(message || '');
}

export function hasOracleNetSuiteBranding(html) {
  return NETSUITE_ORACLE_BRANDING_RE.test(html || '');
}

export function looksLikeLeadCaptureHtml(html, url = '') {
  const sample = html || '';
  const hasEmailField =
    /(?:name|id)=["']email["']/i.test(sample) ||
    /data-fieldtype=["']email["']/i.test(sample) ||
    /type=["']email["']/i.test(sample);
  if (!hasEmailField) return false;

  const hasLeadForm =
    /id=["']main_form["']/i.test(sample) ||
    /action=["'][^"']*externalleadpage/i.test(sample) ||
    LEAD_FORM_ACTION_RE.test(sample) ||
    LEAD_FORM_CLASS_RE.test(sample);

  if (hasLeadForm) return true;
  if (url && isExternalLeadUrl(url)) return true;

  return /<form\b/i.test(sample) && /type=["']submit["']/i.test(sample);
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function brandHostnameFromHtml(html) {
  const fromCanonical = firstUrlFromHtmlPatterns(html, [CANONICAL_RE]);
  if (fromCanonical) {
    try {
      return new URL(fromCanonical).hostname;
    } catch {
      /* ignore */
    }
  }

  const fromMeta = firstUrlFromHtmlPatterns(html, [META_URL_RE]);
  if (fromMeta) {
    try {
      return new URL(fromMeta).hostname;
    } catch {
      /* ignore */
    }
  }

  return '';
}

export function isExternalLeadContext({ html = '', url = '', referrer = '', currentHostname = '' } = {}) {
  if (!looksLikeLeadCaptureHtml(html, url)) return false;

  const pageHost = currentHostname || safeHostname(url);
  if (!pageHost) return false;

  if (isExternalLeadUrl(url)) return true;
  if (isSearchReferrer(referrer)) return true;
  if (isFormInfraHost(pageHost)) return true;

  const brandHost = brandHostnameFromHtml(html);
  if (brandHost && hostKey(brandHost) !== hostKey(pageHost)) return true;

  return false;
}

function firstUrlFromHtmlPatterns(html, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (!match) continue;
    const candidate = match[1] || match[2];
    const normalized = normalizeRedirectTarget(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function externalUrlsFromHtml(html) {
  const urls = [];
  for (const match of html.matchAll(HTTP_HREF_RE)) {
    urls.push(match[1]);
  }
  return urls;
}

export function resolveBaseDomainFromHtml(html, referrer = '', currentHostname = '') {
  if (referrer) {
    const fromReferrer = normalizeRedirectTarget(referrer, currentHostname);
    if (fromReferrer && !isAdOrSearchReferrer(new URL(referrer).hostname)) {
      return fromReferrer;
    }
  }

  const fromCanonical = firstUrlFromHtmlPatterns(html, [CANONICAL_RE]);
  if (fromCanonical) return fromCanonical;

  const fromMeta = firstUrlFromHtmlPatterns(html, [META_URL_RE]);
  if (fromMeta) return fromMeta;

  for (const url of externalUrlsFromHtml(html)) {
    const normalized = normalizeRedirectTarget(url, currentHostname);
    if (normalized) return normalized;
  }

  if (hasOracleNetSuiteBranding(html)) {
    return NETSUITE_DEFAULT_BASE_URL;
  }

  return null;
}

export function resolveBaseDomainFromDocument(doc, referrer = '') {
  if (!doc) return null;

  const currentHostname = safeHostname(doc.defaultView?.location?.href || '');

  if (referrer) {
    try {
      const fromReferrer = normalizeRedirectTarget(referrer, currentHostname);
      if (fromReferrer && !isAdOrSearchReferrer(new URL(referrer).hostname)) {
        return fromReferrer;
      }
    } catch {
      /* ignore */
    }
  }

  const canonical = doc.querySelector?.('link[rel="canonical"]')?.href;
  const canonicalTarget = normalizeRedirectTarget(canonical || '', currentHostname);
  if (canonicalTarget) return canonicalTarget;

  const ogUrl =
    doc.querySelector?.('meta[property="og:url"]')?.content ||
    doc.querySelector?.('meta[name="twitter:url"]')?.content;
  const ogTarget = normalizeRedirectTarget(ogUrl || '', currentHostname);
  if (ogTarget) return ogTarget;

  const logoSelectors = ['header a[href^="http"]', '.header-left a[href^="http"]', '.logo a[href^="http"]'];
  for (const selector of logoSelectors) {
    const anchors = doc.querySelectorAll?.(selector) || [];
    for (const anchor of anchors) {
      const normalized = normalizeRedirectTarget(anchor.href || '', currentHostname);
      if (normalized) return normalized;
    }
  }

  const anchors = doc.querySelectorAll?.('a[href^="http"]') || [];
  for (const anchor of anchors) {
    const normalized = normalizeRedirectTarget(anchor.href || '', currentHostname);
    if (normalized) return normalized;
  }

  const html = doc.documentElement?.outerHTML || '';
  if (hasOracleNetSuiteBranding(html)) {
    return NETSUITE_DEFAULT_BASE_URL;
  }

  return null;
}
