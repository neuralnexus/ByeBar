/**
 * Reversible visibility changes shared by all ByeBar blockers.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const hiddenByReason = new Map();
  const scrollBlockersByReason = new Map();
  const hiddenByAction = new Map();
  const shadowDisplaySnapshots = new WeakMap();

  function elementsFor(map, reason) {
    if (!map.has(reason)) map.set(reason, new Set());
    return map.get(reason);
  }

  function reasonsFor(el) {
    return new Set((el.getAttribute('data-byebar-hidden') || '').split(/\s+/).filter(Boolean));
  }

  function hideInsideShadowRoot(el) {
    const root = el.getRootNode?.();
    if (!root || root.nodeType !== 11 || !root.host || !el.style) return;

    const display = el.style.getPropertyValue('display');
    const priority = el.style.getPropertyPriority('display');
    if (!shadowDisplaySnapshots.has(el)) {
      shadowDisplaySnapshots.set(el, {
        value: display,
        priority
      });
    } else if (display !== 'none' || priority !== 'important') {
      shadowDisplaySnapshots.set(el, { value: display, priority });
    }
    if (display === 'none' && priority === 'important') {
      return;
    }
    el.style.setProperty('display', 'none', 'important');
  }

  function ensureHidden(el) {
    if (!el?.hasAttribute?.('data-byebar-hidden')) return;
    hideInsideShadowRoot(el);
  }

  function restoreShadowDisplay(el) {
    const snapshot = shadowDisplaySnapshots.get(el);
    if (!snapshot || !el.style) return;

    if (snapshot.value) {
      el.style.setProperty('display', snapshot.value, snapshot.priority);
    } else {
      el.style.removeProperty('display');
    }
    shadowDisplaySnapshots.delete(el);
  }

  function hide(el, reason, { blocksScroll = false, actionId = '' } = {}) {
    if (!el || el.nodeType !== 1 || !reason) return false;

    const reasons = reasonsFor(el);
    reasons.add(reason);
    el.setAttribute('data-byebar-hidden', [...reasons].join(' '));
    hideInsideShadowRoot(el);
    elementsFor(hiddenByReason, reason).add(el);
    if (actionId) {
      const entries = elementsFor(hiddenByAction, actionId);
      if (![...entries].some((entry) => entry.el === el && entry.reason === reason)) {
        entries.add({ el, reason });
      }
    }

    if (blocksScroll) {
      elementsFor(scrollBlockersByReason, reason).add(el);
    }

    return true;
  }

  function removeReason(el, reason) {
    const reasons = reasonsFor(el);
    reasons.delete(reason);

    if (reasons.size > 0) {
      el.setAttribute('data-byebar-hidden', [...reasons].join(' '));
    } else {
      el.removeAttribute('data-byebar-hidden');
      restoreShadowDisplay(el);
    }
  }

  function restore(reason) {
    hiddenByReason.get(reason)?.forEach((el) => removeReason(el, reason));
    hiddenByReason.delete(reason);
    scrollBlockersByReason.delete(reason);
    for (const [actionId, entries] of hiddenByAction) {
      for (const entry of entries) {
        if (entry.reason === reason) entries.delete(entry);
      }
      if (entries.size === 0) hiddenByAction.delete(actionId);
    }
    syncScrollLock();
  }

  function reasonUsedByAnotherAction(el, reason, excludedActionId) {
    for (const [actionId, entries] of hiddenByAction) {
      if (actionId === excludedActionId) continue;
      if ([...entries].some((entry) => entry.el === el && entry.reason === reason)) return true;
    }
    return false;
  }

  function restoreAction(actionId) {
    const entries = hiddenByAction.get(actionId);
    if (!entries) return [];

    const restored = [];
    for (const { el, reason } of entries) {
      if (!reasonUsedByAnotherAction(el, reason, actionId)) {
        removeReason(el, reason);
        hiddenByReason.get(reason)?.delete(el);
        scrollBlockersByReason.get(reason)?.delete(el);
      }
      if (el.isConnected) restored.push(el);
    }
    hiddenByAction.delete(actionId);
    syncScrollLock();
    return restored;
  }

  function hasAction(actionId) {
    const entries = hiddenByAction.get(actionId);
    if (!entries) return false;
    for (const entry of entries) {
      if (!entry.el.isConnected || !reasonsFor(entry.el).has(entry.reason)) entries.delete(entry);
    }
    if (entries.size === 0) hiddenByAction.delete(actionId);
    return entries.size > 0;
  }

  function restoreAll() {
    for (const [reason, elements] of hiddenByReason) {
      elements.forEach((el) => removeReason(el, reason));
    }
    hiddenByReason.clear();
    scrollBlockersByReason.clear();
    hiddenByAction.clear();
    syncScrollLock();
  }

  function isHidden(el) {
    return Boolean(
      BYEBAR.shadow?.closestDeep?.(el, '[data-byebar-hidden]') || el?.closest?.('[data-byebar-hidden]')
    );
  }

  function isVisibleModal(el) {
    if (isHidden(el)) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function hasConnectedScrollBlocker() {
    for (const [reason, elements] of scrollBlockersByReason) {
      for (const el of elements) {
        if (el.isConnected && reasonsFor(el).has(reason)) return true;
        if (!el.isConnected) elements.delete(el);
      }
    }
    return false;
  }

  function pruneDisconnected() {
    for (const [reason, elements] of hiddenByReason) {
      elements.forEach((el) => {
        if (!el.isConnected) elements.delete(el);
      });
      if (elements.size === 0) hiddenByReason.delete(reason);
    }
    for (const [actionId, entries] of hiddenByAction) {
      for (const entry of entries) {
        if (!entry.el.isConnected) entries.delete(entry);
      }
      if (entries.size === 0) hiddenByAction.delete(actionId);
    }
  }

  function syncScrollLock() {
    pruneDisconnected();
    const html = document.documentElement;
    if (!html) return;

    const hiddenModal = hasConnectedScrollBlocker();
    const visibleModal = hiddenModal
      ? Array.from(
          document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"], [aria-modal="true"]')
        ).some(isVisibleModal)
      : false;

    html.toggleAttribute('data-byebar-scroll-unlock', hiddenModal && !visibleModal);
  }

  BYEBAR.visibility = {
    hide,
    restore,
    restoreAction,
    restoreAll,
    hasAction,
    isHidden,
    ensureHidden,
    syncScrollLock
  };
})();
