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

export function findSpinnerRoot(el, getComputedStyle = () => ({})) {
  if (!el) return null;

  let node = el;

  for (let depth = 0; depth < 12 && node; depth++) {
    const cls = typeof node.className === 'string' ? node.className : '';
    const id = node.id || '';

    if (node.classList?.contains('react-responsive-modal-root')) {
      return node;
    }

    if (hasSpinnerClassHint(id, cls)) {
      return node;
    }

    const style = getComputedStyle(node);
    const highZ = parseInt(style.zIndex, 10) >= 200;
    const positioned = style.position === 'fixed' || style.position === 'absolute';

    if (positioned && highZ && matchesSpinnerText(node.textContent || '')) {
      return node;
    }

    if (
      (node.getAttribute?.('role') === 'dialog' || node.getAttribute?.('aria-modal') === 'true') &&
      matchesSpinnerText(node.textContent || '')
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

  return el;
}
