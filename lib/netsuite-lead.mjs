import { hostKey } from './host.mjs';

export const NETSUITE_EXTFORMS_HOST_RE = /\.extforms\.netsuite\.com$/i;
export const NETSUITE_LEAD_PATH_RE = /externalleadpage/i;
export const NETSUITE_DEFAULT_BASE_URL = 'https://www.netsuite.com/';

export const NETSUITE_SCRIPT_ALERT_RE =
  /cannot read properties of null|addEventListener|pageInit|customform|nlapiPageInit|suitescript|unexpected error/i;

export const NETSUITE_ORACLE_BRANDING_RE = /oracle\s*netsuite|logos-ons|logo-ons-text-color/i;

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
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    return NETSUITE_EXTFORMS_HOST_RE.test(parsed.hostname) && NETSUITE_LEAD_PATH_RE.test(path);
  } catch {
    return false;
  }
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

export function normalizeRedirectTarget(url) {
  try {
    const parsed = new URL(url);
    if (isBlockedRedirectHost(parsed.hostname)) return null;
    if (NETSUITE_EXTFORMS_HOST_RE.test(parsed.hostname)) return null;
    return `${parsed.protocol}//${parsed.hostname}/`;
  } catch {
    return null;
  }
}

export function isNetSuiteScriptAlert(message) {
  return NETSUITE_SCRIPT_ALERT_RE.test(message || '');
}

export function looksLikeLeadCaptureHtml(html) {
  const sample = html || '';
  if (!NETSUITE_LEAD_PATH_RE.test(sample) && !/id=["']main_form["']/i.test(sample)) {
    return false;
  }
  const hasEmailField =
    /(?:name|id)=["']email["']/i.test(sample) ||
    /data-fieldtype=["']email["']/i.test(sample) ||
    /type=["']email["']/i.test(sample);
  const hasLeadForm =
    /id=["']main_form["']/i.test(sample) || /action=["'][^"']*externalleadpage/i.test(sample);
  return Boolean(hasLeadForm && hasEmailField);
}

export function hasOracleNetSuiteBranding(html) {
  return NETSUITE_ORACLE_BRANDING_RE.test(html || '');
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

export function resolveBaseDomainFromHtml(html, referrer = '') {
  if (referrer) {
    const fromReferrer = normalizeRedirectTarget(referrer);
    if (fromReferrer && !isAdOrSearchReferrer(new URL(referrer).hostname)) {
      return fromReferrer;
    }
  }

  const fromCanonical = firstUrlFromHtmlPatterns(html, [CANONICAL_RE]);
  if (fromCanonical) return fromCanonical;

  const fromMeta = firstUrlFromHtmlPatterns(html, [META_URL_RE]);
  if (fromMeta) return fromMeta;

  for (const url of externalUrlsFromHtml(html)) {
    const normalized = normalizeRedirectTarget(url);
    if (normalized) return normalized;
  }

  if (hasOracleNetSuiteBranding(html)) {
    return NETSUITE_DEFAULT_BASE_URL;
  }

  return NETSUITE_DEFAULT_BASE_URL;
}

export function resolveBaseDomainFromDocument(doc, referrer = '') {
  if (!doc) return null;

  if (referrer) {
    try {
      const fromReferrer = normalizeRedirectTarget(referrer);
      if (fromReferrer && !isAdOrSearchReferrer(new URL(referrer).hostname)) {
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
    const anchors = doc.querySelectorAll?.(selector) || [];
    for (const anchor of anchors) {
      const normalized = normalizeRedirectTarget(anchor.href || '');
      if (normalized) return normalized;
    }
  }

  const anchors = doc.querySelectorAll?.('a[href^="http"]') || [];
  for (const anchor of anchors) {
    const normalized = normalizeRedirectTarget(anchor.href || '');
    if (normalized) return normalized;
  }

  const html = doc.documentElement?.outerHTML || '';
  if (hasOracleNetSuiteBranding(html)) {
    return NETSUITE_DEFAULT_BASE_URL;
  }

  return NETSUITE_DEFAULT_BASE_URL;
}
