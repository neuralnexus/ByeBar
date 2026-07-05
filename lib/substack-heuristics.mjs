export const SUBSTACK_MODAL_TEXT_RE =
  /join\s+.+\s+on\s+substack|the home for great writing|get the app|sign in.*get the app/i;

export const SUBSTACK_PANEL_CLASS_RE = /\bpanel-[A-Za-z0-9_-]+\b/;
export const SUBSTACK_SCRIM_CLASS_RE = /\b(?:background|overlay)-[A-Za-z0-9_-]+\b/;

export function matchesSubstackSignupText(text) {
  const sample = (text || '').replace(/\s+/g, ' ').trim();
  if (!sample || sample.length > 2000) return false;
  return SUBSTACK_MODAL_TEXT_RE.test(sample);
}

export function hasSubstackSignupActions(el) {
  if (!el?.querySelector) return false;
  const text = el.textContent || '';
  return Boolean(el.querySelector('button, a[role="button"]') && /get the app|sign in/i.test(text));
}

export function isSubstackRadixDialog(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.getAttribute('role') !== 'dialog') return false;

  const hasModalChrome =
    el.getAttribute('data-testid') === 'modal' ||
    Boolean(el.querySelector?.('[data-modal-role="header"], [data-modal-role="footer"]'));

  if (!hasModalChrome) return false;

  return matchesSubstackSignupText(el.textContent || '') || hasSubstackSignupActions(el);
}

export function isInsideModalViewer(el) {
  if (!el?.closest) return false;
  const cls = typeof el.className === 'string' ? el.className : '';
  if (cls.includes('modalViewer')) return true;
  return Boolean(el.closest('[class*="modalViewer"]'));
}

export function isSubstackRadixBackdrop(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.getAttribute('role') === 'dialog') return false;
  if ((el.textContent || '').trim().length > 0) return false;

  const id = el.id || '';
  if (id.startsWith('radix-') && el.getAttribute('data-state') === 'open') {
    return true;
  }

  const cls = typeof el.className === 'string' ? el.className : '';
  if (!SUBSTACK_SCRIM_CLASS_RE.test(cls) && !/modalScrim|modal-scrim|ModalScrim/i.test(cls)) {
    return false;
  }

  return isInsideModalViewer(el);
}

export function looksLikeSubstackSignupModal(el) {
  if (!el || el.nodeType !== 1) return false;

  if (isSubstackRadixDialog(el)) return true;

  if (el.getAttribute('role') !== 'dialog' && el.getAttribute('aria-modal') !== 'true') {
    return false;
  }

  return matchesSubstackSignupText(el.textContent || '');
}

export function isSubstackModalScrim(el, getComputedStyle = () => ({})) {
  if (!el || el.nodeType !== 1) return false;
  if (isSubstackRadixBackdrop(el)) return true;

  const cls = typeof el.className === 'string' ? el.className : '';
  if ((el.textContent || '').trim().length > 0) return false;
  if (!SUBSTACK_SCRIM_CLASS_RE.test(cls) && !/modalScrim|modal-scrim|ModalScrim/i.test(cls)) {
    return false;
  }

  if (!isInsideModalViewer(el)) return false;

  const style = getComputedStyle(el);
  const positioned = style.position === 'fixed' || style.position === 'absolute';
  if (!positioned) return false;

  return true;
}
