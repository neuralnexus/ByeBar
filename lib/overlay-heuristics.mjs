import { OVERLAY_MANAGEMENT_RE, OVERLAY_PROMOTION_RE } from './constants.mjs';

function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

export function matchesPromotionalOverlayText(text) {
  const sample = normalizeText(text);
  if (!sample || sample.length > 2000) return false;
  if (OVERLAY_MANAGEMENT_RE.test(sample)) return false;
  return OVERLAY_PROMOTION_RE.test(sample);
}

export function findPromotionalOverlayRoot(el, getStyle = () => ({})) {
  if (!el) return null;

  let node = el;
  for (let depth = 0; depth < 10 && node; depth += 1) {
    const modal =
      node.tagName === 'DIALOG' ||
      node.getAttribute?.('role') === 'dialog' ||
      node.getAttribute?.('aria-modal') === 'true';
    const position = getStyle(node).position;
    if (modal || position === 'fixed' || position === 'sticky') return node;

    const parent = node.parentElement;
    if (!parent || parent.tagName === 'BODY' || parent.tagName === 'HTML') break;
    node = parent;
  }

  return el;
}

export function looksLikePromotionalOverlay(el, getStyle = () => ({}), viewport = { width: 0, height: 0 }) {
  if (!el || el.nodeType !== 1) return false;
  if (['HEADER', 'NAV', 'FOOTER'].includes(el.tagName)) return false;

  const label = [el.getAttribute?.('aria-label'), el.getAttribute?.('title'), el.textContent]
    .filter(Boolean)
    .join(' ');

  if (!matchesPromotionalOverlayText(label)) return false;

  const modal =
    el.tagName === 'DIALOG' ||
    el.getAttribute?.('role') === 'dialog' ||
    el.getAttribute?.('aria-modal') === 'true';
  if (el.querySelector?.('nav, [role="navigation"]')) return false;

  const style = getStyle(el);
  if (
    el.hidden ||
    el.getAttribute?.('aria-hidden') === 'true' ||
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0'
  ) {
    return false;
  }

  const rect = el.getBoundingClientRect?.();
  if (!rect) return false;

  const width = rect.width || 0;
  const height = rect.height || 0;
  const viewportWidth = viewport.width || 0;
  const viewportHeight = viewport.height || 0;
  if (width < 180 || height < 35 || viewportWidth <= 0 || viewportHeight <= 0) return false;

  const left = rect.left || 0;
  const top = rect.top || 0;
  const right = rect.right ?? left + width;
  const bottom = rect.bottom ?? top + height;
  const inViewport = right > 0 && bottom > 0 && left < viewportWidth && top < viewportHeight;
  if (!inViewport) return false;
  if (modal) return height >= 80;

  if (style.position !== 'fixed' && style.position !== 'sticky') return false;
  const nearEdge = left <= 32 || top <= 32 || right >= viewportWidth - 32 || bottom >= viewportHeight - 32;
  const isBar = width >= viewportWidth * 0.5 && nearEdge;
  const zIndex = Number.parseInt(style.zIndex, 10);
  const isPopup = width >= 240 && height >= 80 && nearEdge && Number.isFinite(zIndex) && zIndex >= 10;

  return isBar || isPopup;
}
