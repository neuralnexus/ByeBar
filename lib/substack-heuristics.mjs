import { hasRole } from './aria.mjs';

export const SUBSTACK_MODAL_TEXT_RE = /join\s+.+\s+on\s+substack|the home for great writing/i;
export const SUBSTACK_ACTION_TEXT_RE = /get the app|sign in.*get the app/i;

export const SUBSTACK_PANEL_CLASS_RE = /\bpanel-[A-Za-z0-9_-]+\b/;
export const SUBSTACK_SCRIM_CLASS_RE = /\b(?:background|overlay)-[A-Za-z0-9_-]+\b/;

export function matchesSubstackSignupText(text, onSubstackPage = false) {
  const sample = (text || '').replace(/\s+/g, ' ').trim();
  if (!sample || sample.length > 2000) return false;
  return SUBSTACK_MODAL_TEXT_RE.test(sample) || (onSubstackPage && SUBSTACK_ACTION_TEXT_RE.test(sample));
}

export function hasSubstackSignupActions(el, onSubstackPage = false) {
  if (!onSubstackPage || !el?.querySelector) return false;
  const text = el.textContent || '';
  return Boolean(el.querySelector('button, a[role~="button" i]') && SUBSTACK_ACTION_TEXT_RE.test(text));
}

export function isSubstackRadixDialog(el, onSubstackPage = false) {
  if (!el || el.nodeType !== 1) return false;
  if (!hasRole(el, 'dialog')) return false;

  const hasModalChrome =
    el.getAttribute('data-testid') === 'modal' ||
    Boolean(el.querySelector?.('[data-modal-role="header"], [data-modal-role="footer"]'));

  if (!hasModalChrome) return false;

  return (
    matchesSubstackSignupText(el.textContent || '', onSubstackPage) ||
    hasSubstackSignupActions(el, onSubstackPage)
  );
}

export function isInsideModalViewer(el) {
  if (!el?.closest) return false;
  const cls = typeof el.className === 'string' ? el.className : '';
  if (cls.includes('modalViewer')) return true;
  return Boolean(el.closest('[class*="modalViewer"]'));
}

function isPositionedScrim(el, getComputedStyle = () => ({}), viewport = {}) {
  const style = getComputedStyle(el);
  if (style.position !== 'fixed' && style.position !== 'absolute') return false;

  const rect = el.getBoundingClientRect?.();
  if (!rect) return false;
  const viewportWidth = viewport.width || (typeof window !== 'undefined' ? window.innerWidth : 0);
  const viewportHeight = viewport.height || (typeof window !== 'undefined' ? window.innerHeight : 0);
  if (viewportWidth <= 0 || viewportHeight <= 0) return false;
  return rect.width >= viewportWidth * 0.85 && rect.height >= viewportHeight * 0.85;
}

export function isSubstackRadixBackdrop(el, onSubstackPage = false) {
  if (!el || el.nodeType !== 1) return false;
  if (hasRole(el, 'dialog')) return false;
  if ((el.textContent || '').trim().length > 0) return false;

  const id = el.id || '';
  if (id.startsWith('radix-') && el.getAttribute('data-state') === 'open') {
    return true;
  }

  const cls = typeof el.className === 'string' ? el.className : '';
  if (!SUBSTACK_SCRIM_CLASS_RE.test(cls) && !/modalScrim|modal-scrim|ModalScrim/i.test(cls)) {
    return false;
  }

  return onSubstackPage || isInsideModalViewer(el);
}

export function looksLikeSubstackSignupModal(el, onSubstackPage = false) {
  if (!el || el.nodeType !== 1) return false;
  if (!hasRole(el, 'dialog') && el.getAttribute('aria-modal') !== 'true') {
    return false;
  }
  if (onSubstackPage && /subscribe/i.test(el.getAttribute?.('aria-label') || '')) return true;

  if (isSubstackRadixDialog(el, onSubstackPage)) return true;

  return matchesSubstackSignupText(el.textContent || '', onSubstackPage);
}

export function isSubstackModalScrim(
  el,
  getComputedStyle = () => ({}),
  onSubstackPage = false,
  viewport = {}
) {
  if (!el || el.nodeType !== 1) return false;
  const cls = typeof el.className === 'string' ? el.className : '';
  const id = el.id || '';
  if ((el.textContent || '').trim().length > 0) return false;
  const radixBackdrop = id.startsWith('radix-') && el.getAttribute('data-state') === 'open';
  const classBackdrop = SUBSTACK_SCRIM_CLASS_RE.test(cls) || /modalScrim|modal-scrim|ModalScrim/i.test(cls);
  if (!radixBackdrop && !classBackdrop) {
    return false;
  }

  if (!onSubstackPage && !isInsideModalViewer(el)) return false;

  return isPositionedScrim(el, getComputedStyle, viewport);
}
