import { BLOOMBERG_MODULE_VISIBILITY_RE, BLOOMBERG_PROMO_RE } from './constants.mjs';

export function hasBloombergModuleVisibilityClass(className) {
  return BLOOMBERG_MODULE_VISIBILITY_RE.test(className || '');
}

export function matchesBloombergPromoText(text) {
  const sample = (text || '').replace(/\s+/g, ' ').trim();
  if (!sample || sample.length > 500) return false;
  return BLOOMBERG_PROMO_RE.test(sample);
}

export function findBloombergPromoRoot(el, getComputedStyle = () => ({})) {
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
