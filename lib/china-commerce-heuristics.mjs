import {
  CHINA_COMMERCE_HOST_PATTERNS,
  SPINNER_ACTION_RE,
  SPINNER_CLASS_RE,
  SPINNER_LANGUAGE_RE
} from './constants.mjs';

export function isChinaCommerceHost(hostname) {
  return CHINA_COMMERCE_HOST_PATTERNS.some((re) => re.test(hostname || ''));
}

export function matchesSpinnerText(text) {
  const sample = (text || '').replace(/\s+/g, ' ').trim();
  if (sample.length < 8 || sample.length > 2000) return false;
  return SPINNER_LANGUAGE_RE.test(sample) && SPINNER_ACTION_RE.test(sample);
}

export function hasSpinnerClassHint(id, className) {
  const haystack = `${id || ''} ${className || ''}`.toLowerCase();
  return SPINNER_CLASS_RE.test(haystack);
}

export function looksLikeSpinnerOverlay(el, getComputedStyle = () => ({})) {
  if (!el || !matchesSpinnerText(el.textContent || '')) return false;

  const modal = el.getAttribute?.('role') === 'dialog' || el.getAttribute?.('aria-modal') === 'true';
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
  const rect = el.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  const positioned =
    style.position === 'fixed' ||
    style.position === 'sticky' ||
    (style.position === 'absolute' && Number.parseInt(style.zIndex, 10) >= 100);
  if (!modal && !positioned) return false;

  const className = typeof el.className === 'string' ? el.className : '';
  return modal || hasSpinnerClassHint(el.id || '', className);
}

export function findSpinnerRoot(el, getComputedStyle = () => ({})) {
  if (!el) return null;

  let node = el;
  let hintedRoot = null;

  for (let depth = 0; depth < 12 && node; depth++) {
    const cls = typeof node.className === 'string' ? node.className : '';
    const id = node.id || '';

    const hasSpinnerText = matchesSpinnerText(node.textContent || '');

    if (hasSpinnerClassHint(id, cls) && hasSpinnerText) {
      hintedRoot = node;
    }

    if (node.classList?.contains('react-responsive-modal-root') && hasSpinnerText) {
      return node;
    }

    const style = getComputedStyle(node);
    const highZ = parseInt(style.zIndex, 10) >= 200;
    const positioned = style.position === 'fixed' || style.position === 'absolute';

    if (positioned && highZ && hasSpinnerText) {
      return node;
    }

    if (
      (node.getAttribute?.('role') === 'dialog' || node.getAttribute?.('aria-modal') === 'true') &&
      hasSpinnerText
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

  return hintedRoot || (matchesSpinnerText(el.textContent || '') ? el : null);
}
