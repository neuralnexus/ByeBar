import { BLOOMBERG_MODULE_VISIBILITY_RE, BLOOMBERG_PROMO_RE } from './constants.mjs';

export function hasBloombergModuleVisibilityClass(className) {
  return BLOOMBERG_MODULE_VISIBILITY_RE.test(className || '');
}

export function matchesBloombergPromoText(text) {
  const sample = (text || '').replace(/\s+/g, ' ').trim();
  if (!sample || sample.length > 500) return false;
  return BLOOMBERG_PROMO_RE.test(sample);
}

export function looksLikeBloombergPromo(
  el,
  getComputedStyle = () => ({}),
  viewport = { width: 0, height: 0 }
) {
  if (!el || !matchesBloombergPromoText(el.textContent || '')) return false;
  if (['HEADER', 'NAV', 'FOOTER'].includes(el.tagName)) return false;

  const style = getComputedStyle(el);
  if (
    el.hidden ||
    el.getAttribute?.('aria-hidden') === 'true' ||
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0'
  ) {
    return false;
  }
  const positioned =
    style.position === 'fixed' ||
    style.position === 'sticky' ||
    (style.position === 'absolute' && Number.parseInt(style.zIndex, 10) >= 50);
  if (!positioned || viewport.width <= 0 || viewport.height <= 0) return false;

  const rect = el.getBoundingClientRect?.();
  if (!rect) return false;
  const right = rect.right ?? rect.left + rect.width;
  const bottom = rect.bottom ?? rect.top + rect.height;
  const inViewport = right > 0 && bottom > 0 && rect.left < viewport.width && rect.top < viewport.height;
  return inViewport && rect.width >= viewport.width * 0.4 && rect.height > 0 && rect.height <= 200;
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
    if (
      (style.position === 'fixed' || style.position === 'sticky') &&
      !['HEADER', 'NAV', 'FOOTER'].includes(tag)
    ) {
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
