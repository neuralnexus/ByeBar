export const SUBSTACK_MODAL_TEXT_RE =
  /join\s+.+\s+on\s+substack|the home for great writing|get the app|sign in.*get the app/i;

export const SUBSTACK_PANEL_CLASS_RE = /\bpanel-[A-Za-z0-9_-]+\b/;

export function isSubstackRadixDialog(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.getAttribute('role') !== 'dialog') return false;

  const id = el.id || '';
  const cls = typeof el.className === 'string' ? el.className : '';

  if (el.getAttribute('data-testid') === 'modal') return true;
  if (id.startsWith('radix-')) return true;
  if (SUBSTACK_PANEL_CLASS_RE.test(cls)) return true;
  if (el.querySelector?.('[data-modal-role="header"], [data-modal-role="footer"]')) return true;

  return false;
}

export function isSubstackRadixBackdrop(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.getAttribute('role') === 'dialog') return false;

  const id = el.id || '';
  const cls = typeof el.className === 'string' ? el.className : '';

  if (id.startsWith('radix-') && el.getAttribute('data-state') === 'open') return true;
  if (/\bbackground-[A-Za-z0-9_-]+\b/.test(cls)) return true;
  if (/\boverlay-[A-Za-z0-9_-]+\b/.test(cls)) return true;

  return false;
}

export function matchesSubstackSignupText(text) {
  const sample = (text || '').replace(/\s+/g, ' ').trim();
  if (!sample || sample.length > 2000) return false;
  return SUBSTACK_MODAL_TEXT_RE.test(sample);
}

export function looksLikeSubstackSignupModal(el) {
  if (!el || el.nodeType !== 1) return false;

  if (isSubstackRadixDialog(el)) {
    const text = el.textContent || '';
    if (matchesSubstackSignupText(text)) return true;
    return Boolean(el.querySelector?.('button, a[role="button"]') && /get the app|sign in/i.test(text));
  }

  if (el.getAttribute('role') !== 'dialog' && el.getAttribute('aria-modal') !== 'true') {
    return false;
  }

  return matchesSubstackSignupText(el.textContent || '');
}
