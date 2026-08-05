/**
 * Reversible visibility changes shared by all ByeBar blockers.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const hiddenByReason = new Map();
  const scrollBlockersByReason = new Map();
  const hiddenByAction = new Map();
  const displaySnapshots = new WeakMap();
  const variableSnapshots = new WeakMap();
  const displayStates = new WeakMap();
  const hiddenDisplayVariable = '--byebar-hidden-display-7c6f2a';
  const hiddenDisplayValue = `var(${hiddenDisplayVariable}, none)`;
  const maxDisplayRetries = 5;
  const disconnectedGraceMs = 30_000;
  const retentionCheckMs = 10_000;

  function elementsFor(map, reason) {
    if (!map.has(reason)) map.set(reason, new Set());
    return map.get(reason);
  }

  function reasonsFor(el) {
    return new Set((el.getAttribute('data-byebar-hidden') || '').split(/\s+/).filter(Boolean));
  }

  function ownsDisplayDeclaration(el) {
    return (
      el.style?.getPropertyValue('display') === hiddenDisplayValue &&
      el.style.getPropertyPriority('display') === 'important'
    );
  }

  function ownsVariableDeclaration(el) {
    return (
      el.style?.getPropertyValue(hiddenDisplayVariable) === 'none' &&
      el.style.getPropertyPriority(hiddenDisplayVariable) === 'important'
    );
  }

  function ownsHiddenDisplay(el) {
    return ownsDisplayDeclaration(el) && ownsVariableDeclaration(el);
  }

  function captureDisplay(el) {
    if (!el.style) return;
    const display = el.style.getPropertyValue('display');
    const priority = el.style.getPropertyPriority('display');
    if (!displaySnapshots.has(el)) {
      displaySnapshots.set(el, { value: display, priority });
    } else if (!ownsDisplayDeclaration(el)) {
      displaySnapshots.set(el, { value: display, priority });
    }
    const variable = el.style.getPropertyValue(hiddenDisplayVariable);
    const variablePriority = el.style.getPropertyPriority(hiddenDisplayVariable);
    if (!variableSnapshots.has(el)) {
      variableSnapshots.set(el, { value: variable, priority: variablePriority });
    } else if (!ownsVariableDeclaration(el)) {
      variableSnapshots.set(el, { value: variable, priority: variablePriority });
    }
  }

  function writeHiddenDisplay(el, state) {
    captureDisplay(el);
    if (ownsHiddenDisplay(el) || (state && state.retryCount >= maxDisplayRetries)) return;
    state?.observer.takeRecords();
    el.style.setProperty(hiddenDisplayVariable, 'none', 'important');
    captureDisplay(el);
    el.style.setProperty('display', hiddenDisplayValue, 'important');
    if (!ownsHiddenDisplay(el)) captureDisplay(el);
    if (state) {
      state.retryCount += 1;
      state.observer.takeRecords();
      clearTimeout(state.retryResetTimer);
      state.retryResetTimer = setTimeout(() => {
        state.retryCount = 0;
      }, 1000);
      if (!ownsHiddenDisplay(el)) scheduleHiddenDisplay(el);
    }
  }

  function forgetDisconnectedElement(el) {
    for (const [reason, elements] of hiddenByReason) {
      elements.delete(el);
      if (elements.size === 0) hiddenByReason.delete(reason);
    }
    for (const [reason, elements] of scrollBlockersByReason) {
      elements.delete(el);
      if (elements.size === 0) scrollBlockersByReason.delete(reason);
    }
    for (const [actionId, entries] of hiddenByAction) {
      for (const entry of entries) {
        if (entry.el === el) entries.delete(entry);
      }
      if (entries.size === 0) hiddenByAction.delete(actionId);
    }
    el.removeAttribute('data-byebar-hidden');
    stopObservingDisplay(el);
    restoreInlineDisplay(el);
  }

  function scheduleRetentionCheck(el, state) {
    state.retentionTimer = setTimeout(() => {
      state.retentionTimer = null;
      if (el.isConnected) {
        state.disconnectedAt = 0;
      } else if (!state.disconnectedAt) {
        state.disconnectedAt = Date.now();
      } else if (Date.now() - state.disconnectedAt >= disconnectedGraceMs) {
        forgetDisconnectedElement(el);
        return;
      }
      scheduleRetentionCheck(el, state);
    }, retentionCheckMs);
  }

  function scheduleHiddenDisplay(el) {
    let state = displayStates.get(el);
    if (!state) {
      state = observeDisplayChanges(el);
      writeHiddenDisplay(el, state);
      return;
    }
    captureDisplay(el);
    if (ownsHiddenDisplay(el) || state.pendingFrame !== null || state.retryCount >= maxDisplayRetries) {
      return;
    }
    state.pendingFrame = requestAnimationFrame(() => {
      state.pendingFrame = null;
      if (reasonsFor(el).size === 0) {
        stopObservingDisplay(el);
        return;
      }
      writeHiddenDisplay(el, state);
    });
  }

  function observeDisplayChanges(el) {
    if (!el?.style) return null;
    if (displayStates.has(el)) return displayStates.get(el);
    const state = {
      observer: null,
      pendingFrame: null,
      retryCount: 0,
      retryResetTimer: null,
      retentionTimer: null,
      disconnectedAt: 0
    };
    state.observer = new MutationObserver(() => scheduleHiddenDisplay(el));
    state.observer.observe(el, { attributes: true, attributeFilter: ['style'] });
    displayStates.set(el, state);
    scheduleRetentionCheck(el, state);
    return state;
  }

  function stopObservingDisplay(el) {
    const state = displayStates.get(el);
    if (!state) return;
    state.observer.disconnect();
    if (state.pendingFrame !== null) cancelAnimationFrame(state.pendingFrame);
    clearTimeout(state.retryResetTimer);
    clearTimeout(state.retentionTimer);
    displayStates.delete(el);
  }

  function ensureHidden(root) {
    if (!root) return;
    const hidden = BYEBAR.shadow?.queryAll
      ? BYEBAR.shadow.queryAll('[data-byebar-hidden]', root)
      : Array.from(root.querySelectorAll?.('[data-byebar-hidden]') || []);
    if (root.nodeType === 1 && root.hasAttribute?.('data-byebar-hidden') && !hidden.includes(root)) {
      hidden.unshift(root);
    }
    hidden.forEach((el) => {
      scheduleHiddenDisplay(el);
    });
  }

  function restoreInlineDisplay(el) {
    const snapshot = displaySnapshots.get(el);
    const variableSnapshot = variableSnapshots.get(el);
    if ((!snapshot && !variableSnapshot) || !el.style) return;

    if (variableSnapshot?.value) {
      el.style.setProperty(hiddenDisplayVariable, variableSnapshot.value, variableSnapshot.priority);
    } else {
      el.style.removeProperty(hiddenDisplayVariable);
    }
    if (snapshot?.value) {
      el.style.setProperty('display', snapshot.value, snapshot.priority);
    } else {
      el.style.removeProperty('display');
    }
    displaySnapshots.delete(el);
    variableSnapshots.delete(el);
  }

  function hide(el, reason, { blocksScroll = false, actionId = '' } = {}) {
    if (!el || el.nodeType !== 1 || !reason) return false;

    const reasons = reasonsFor(el);
    reasons.add(reason);
    el.setAttribute('data-byebar-hidden', [...reasons].join(' '));
    scheduleHiddenDisplay(el);
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
      stopObservingDisplay(el);
      restoreInlineDisplay(el);
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
      restored.push(el);
    }
    hiddenByAction.delete(actionId);
    syncScrollLock();
    return restored;
  }

  function forgetAction(actionId) {
    return hiddenByAction.delete(actionId);
  }

  function hasAction(actionId) {
    const entries = hiddenByAction.get(actionId);
    if (!entries) return false;
    for (const entry of entries) {
      if (!reasonsFor(entry.el).has(entry.reason)) entries.delete(entry);
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
        if (!reasonsFor(el).has(reason)) elements.delete(el);
      }
    }
    return false;
  }

  function syncScrollLock() {
    const html = document.documentElement;
    if (!html) return;

    const hiddenModal = hasConnectedScrollBlocker();
    const visibleModal = hiddenModal
      ? Array.from(document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')).some(
          isVisibleModal
        )
      : false;

    html.toggleAttribute('data-byebar-scroll-unlock', hiddenModal && !visibleModal);
  }

  BYEBAR.visibility = {
    hide,
    restore,
    restoreAction,
    forgetAction,
    restoreAll,
    hasAction,
    isHidden,
    ensureHidden,
    syncScrollLock
  };
})();
