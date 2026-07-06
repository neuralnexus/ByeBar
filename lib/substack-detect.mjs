import { SUBSTACK_HOST_PATTERNS } from './constants.mjs';

export function isSubstackHost(hostname) {
  return SUBSTACK_HOST_PATTERNS.some((re) => re.test(hostname || ''));
}

export const SUBSTACK_HTML_MARKERS = [
  /substackcdn\.com/i,
  /\b[a-z0-9-]+\.substack\.com\b/i,
  /https?:\/\/(?:www\.)?substack\.com\b/i
];

export const SUBSTACK_DOM_SELECTORS = [
  'link[href*="substackcdn.com"]',
  'link[href*=".substack.com"]',
  'script[src*="substackcdn.com"]',
  'script[src*="substack.com"]',
  '[class*="modalViewer"]'
];

export function isSubstackPageHtml(html) {
  if (!html || typeof html !== 'string') return false;
  return SUBSTACK_HTML_MARKERS.some((re) => re.test(html));
}

export function isSubstackDom(root) {
  if (!root?.querySelector) return false;
  return SUBSTACK_DOM_SELECTORS.some((selector) => root.querySelector(selector));
}

export function collectSubstackHtmlSample(doc) {
  if (!doc) return '';
  const headHtml = doc.head?.innerHTML || '';
  const earlyHtml = doc.documentElement?.innerHTML?.slice(0, 100000) || '';
  return `${headHtml}${earlyHtml}`;
}

export function isSubstackSite(hostname, { html = '', root = null } = {}) {
  return isSubstackHost(hostname) || isSubstackPageHtml(html) || isSubstackDom(root);
}
