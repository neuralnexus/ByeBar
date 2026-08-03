/**
 * ByeBar terms-of-service modals: auto-accept confirmed visible controls.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const clicked = new WeakSet();
  const actedModals = new WeakSet();

  function queryAll(selector, root = document) {
    return BYEBAR.shadow?.queryAll(selector, root) || Array.from(root.querySelectorAll(selector));
  }

  function composedParent(el) {
    return el?.parentElement || el?.getRootNode?.()?.host || null;
  }

  function hasHiddenAncestor(el) {
    let node = el;
    while (node?.nodeType === 1) {
      if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true')
        return true;
      const style = getComputedStyle(node);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number.parseFloat(style.opacity || '1') <= 0.01 ||
        style.pointerEvents === 'none'
      ) {
        return true;
      }
      node = composedParent(node);
    }
    return false;
  }

  function isVisible(el) {
    if (!el || BYEBAR.visibility.isHidden(el)) return false;
    if (hasHiddenAncestor(el)) return false;
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const right = rect.right || rect.left + rect.width;
    const bottom = rect.bottom || rect.top + rect.height;
    return right > 0 && bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
  }

  function textMatchesAccept(text) {
    return BYEBAR.lib.tos.textMatchesAccept(text, BYEBAR.TOS_ACCEPT_TEXT);
  }

  function closestTosModal(el) {
    if (!el) return null;
    const known =
      BYEBAR.shadow?.closestDeep(el, BYEBAR.TOS_BANNER_ANCESTORS) ||
      el.closest?.(BYEBAR.TOS_BANNER_ANCESTORS);
    if (known) return known;
    const dialogSelector = 'dialog, [role="dialog"], [aria-modal="true"]';
    return BYEBAR.shadow?.closestDeep(el, dialogSelector) || el.closest?.(dialogSelector);
  }

  function clickElement(el) {
    if (!el || clicked.has(el)) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    clicked.add(el);
    try {
      el.click();
      return true;
    } catch {
      try {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      } catch {
        clicked.delete(el);
        return false;
      }
    }
  }

  function recordAttempt(modal, meta) {
    actedModals.add(modal);
    BYEBAR.actions.recordIrreversible(meta);
  }

  function clickIfAccept(el) {
    if (!el || clicked.has(el)) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;

    const label =
      el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.value || '';

    if (!textMatchesAccept(label)) return false;

    return clickElement(el);
  }

  function looksLikeTosModal(el) {
    if (!el || el.nodeType !== 1 || !isVisible(el)) return false;

    const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';

    const text = (el.textContent || '').slice(0, 4000);
    if (!BYEBAR.lib.tos.matchesTosModalText(text)) return false;

    const style = getComputedStyle(el);
    const modal = el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true';
    const hasClassHint = cls.includes('tos-modal') || cls.includes('terms-modal');
    const positioned =
      style.position === 'fixed' ||
      style.position === 'sticky' ||
      style.position === 'absolute' ||
      parseInt(style.zIndex, 10) >= 100;

    if (!positioned && !modal && !hasClassHint) return false;

    const rect = el.getBoundingClientRect();
    return rect.width >= 200 && rect.height >= 80;
  }

  function acceptViaSelectors(root = document) {
    for (const el of queryAll(BYEBAR.TOS_ACCEPT_SELECTORS.join(','), root)) {
      if (!isVisible(el)) continue;
      const modal = closestTosModal(el);
      if (!modal || actedModals.has(modal) || BYEBAR.wasUserOpened?.(modal) || !looksLikeTosModal(modal)) {
        continue;
      }
      if (clickIfAccept(el)) {
        recordAttempt(modal, {
          feature: 'tosAccept',
          rule: 'known-legal-dialog',
          operation: 'accept',
          reason: 'vendor-accept-selector'
        });
        return true;
      }
    }

    return false;
  }

  function acceptViaTextScan(root = document) {
    const controls = queryAll(
      'button, a[role="button"], input[type="button"], input[type="submit"], [role="button"]',
      root
    );
    for (const el of controls) {
      if (!isVisible(el)) continue;
      const modal = closestTosModal(el);
      if (!modal || actedModals.has(modal) || BYEBAR.wasUserOpened?.(modal) || !looksLikeTosModal(modal)) {
        continue;
      }
      if (clickIfAccept(el)) {
        recordAttempt(modal, {
          feature: 'tosAccept',
          rule: 'confirmed-legal-dialog',
          operation: 'accept',
          reason: 'accept-label'
        });
        return true;
      }
    }

    return false;
  }

  function accept(root = document) {
    if (!BYEBAR.engine?.featureEnabled?.('tosAccept')) return false;

    const accepted = acceptViaSelectors(root) || acceptViaTextScan(root);
    return accepted;
  }

  BYEBAR.tos = { accept, closestModal: closestTosModal };
})();
