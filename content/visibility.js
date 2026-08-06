/**
 * Reversible visibility changes shared by all ByeBar blockers.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const hiddenByReason = new Map();
  const scrollBlockersByReason = new Map();
  const hiddenByAction = new Map();
  const forgottenActions = new Set();
  const activeCopyTokens = new Map();
  const retiredCopyTokens = new Set();
  const displaySnapshots = new WeakMap();
  const variableSnapshots = new WeakMap();
  const retainedCopyMarkers = new WeakMap();
  const displayStates = new WeakMap();
  const observedCopyRoots = new WeakSet();
  const hiddenDisplayVariable = '--byebar-hidden-display-7c6f2a';
  const hiddenDisplayValue = `var(${hiddenDisplayVariable}, none)`;
  const actionCopyAttribute = 'data-byebar-action-copy-7c6f2a';
  const actionCopyVariablePrefix = '--byebar-action-active-7c6f2a-';
  const actionCopyVariableNonce = (
    globalThis.crypto?.randomUUID?.().replaceAll('-', '') ||
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  ).toLowerCase();
  const actionCopyVariablePattern = /^--byebar-action-active-7c6f2a-[a-z0-9]+-\d+$/;
  const actionCopyMarkerVersion = 3;
  const maxDisplayRetries = 5;
  const disconnectedGraceMs = 30_000;
  const retentionCheckMs = 10_000;
  const copyDiscoveryChunkSize = 500;
  const copyDiscoveryStepMs = 250;
  const copyDiscoveryCycleMs = 2_000;
  let copySequence = 0;
  let copyObserver = null;
  let rootVariableObserver = null;
  let rootVariableElement = null;
  let copyDiscoveryTimer = null;
  let copyDiscoveryFrames = null;

  function elementsFor(map, reason) {
    if (!map.has(reason)) map.set(reason, new Set());
    return map.get(reason);
  }

  function reasonsFor(el) {
    return new Set((el.getAttribute('data-byebar-hidden') || '').split(/\s+/).filter(Boolean));
  }

  function copyMarkerFor(el) {
    return parseCopyMarker(el?.getAttribute?.(actionCopyAttribute)) || retainedCopyMarkers.get(el) || null;
  }

  function markerDisplayValue(marker) {
    const fallback = marker?.snapshot?.display?.value || 'revert-layer';
    return marker ? `var(${marker.activeVariable}, ${fallback})` : hiddenDisplayValue;
  }

  function ownsDisplayDeclaration(el, marker = copyMarkerFor(el)) {
    return (
      el.style?.getPropertyValue('display') === markerDisplayValue(marker) &&
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

  function seedDisplaySnapshots(el, snapshot) {
    if (!el?.style || !snapshot) return;
    if (!displaySnapshots.has(el)) displaySnapshots.set(el, { ...snapshot.display });
    if (!variableSnapshots.has(el)) variableSnapshots.set(el, { ...snapshot.variable });
  }

  function updateCopyMarkerSnapshot(el, marker) {
    if (!marker || !displaySnapshots.has(el) || !variableSnapshots.has(el)) return;
    const snapshot = {
      display: displaySnapshots.get(el),
      variable: variableSnapshots.get(el)
    };
    retainedCopyMarkers.set(el, { ...marker, snapshot });
    const value = serializeCopyMarker(
      marker.token,
      marker.reason,
      marker.activeVariable,
      snapshot,
      marker.previous
    );
    const currentValue = el.getAttribute(actionCopyAttribute);
    const currentMarker = parseCopyMarker(currentValue);
    if (
      currentMarker?.token === marker.token &&
      currentMarker.reason === marker.reason &&
      currentMarker.activeVariable === marker.activeVariable &&
      currentValue !== value
    ) {
      el.setAttribute(actionCopyAttribute, value);
    }
  }

  function captureDisplay(el) {
    if (!el.style) return;
    const marker = copyMarkerFor(el);
    seedDisplaySnapshots(el, marker?.snapshot);
    const display = el.style.getPropertyValue('display');
    const priority = el.style.getPropertyPriority('display');
    let changed = false;
    if (!displaySnapshots.has(el)) {
      displaySnapshots.set(el, { value: display, priority });
      changed = true;
    } else if (!ownsDisplayDeclaration(el)) {
      displaySnapshots.set(el, { value: display, priority });
      changed = true;
    }
    const variable = el.style.getPropertyValue(hiddenDisplayVariable);
    const variablePriority = el.style.getPropertyPriority(hiddenDisplayVariable);
    if (!variableSnapshots.has(el)) {
      variableSnapshots.set(el, { value: variable, priority: variablePriority });
      changed = true;
    } else if (!ownsVariableDeclaration(el)) {
      variableSnapshots.set(el, { value: variable, priority: variablePriority });
      changed = true;
    }
    if (changed) updateCopyMarkerSnapshot(el, marker);
  }

  function inlineDisplaySnapshot(el) {
    return {
      display: {
        value: el.style?.getPropertyValue('display') || '',
        priority: el.style?.getPropertyPriority('display') || ''
      },
      variable: {
        value: el.style?.getPropertyValue(hiddenDisplayVariable) || '',
        priority: el.style?.getPropertyPriority(hiddenDisplayVariable) || ''
      }
    };
  }

  function applyInlineDisplaySnapshot(el, snapshot, { display = true, variable = true } = {}) {
    if (!el?.style || !snapshot) return;
    if (variable) {
      if (snapshot.variable.value) {
        el.style.setProperty(hiddenDisplayVariable, snapshot.variable.value, snapshot.variable.priority);
      } else el.style.removeProperty(hiddenDisplayVariable);
    }
    if (display) {
      if (snapshot.display.value) {
        el.style.setProperty('display', snapshot.display.value, snapshot.display.priority);
      } else el.style.removeProperty('display');
    }
  }

  function propertySnapshot(style, property) {
    return {
      value: style?.getPropertyValue(property) || '',
      priority: style?.getPropertyPriority(property) || ''
    };
  }

  function applyPropertySnapshot(style, property, snapshot) {
    if (!style || !snapshot) return;
    if (snapshot.value) style.setProperty(property, snapshot.value, snapshot.priority);
    else style.removeProperty(property);
  }

  function ownsRootVariable(entry, root = entry.rootElement) {
    return Boolean(
      root?.style?.getPropertyValue(entry.activeVariable) === hiddenDisplayValue &&
      root.style.getPropertyPriority(entry.activeVariable) === 'important'
    );
  }

  function restoreRootVariable(entry) {
    const root = entry.rootElement;
    if (!root?.style || !entry.rootSnapshot) return;
    if (!ownsRootVariable(entry, root)) {
      entry.rootSnapshot = propertySnapshot(root.style, entry.activeVariable);
      return;
    }
    applyPropertySnapshot(root.style, entry.activeVariable, entry.rootSnapshot);
  }

  function stopRootVariableObserver() {
    rootVariableObserver?.disconnect();
    rootVariableObserver = null;
    rootVariableElement = null;
  }

  function startRootVariableObserver() {
    const root = document.documentElement;
    if (!root?.style) return;
    if (rootVariableObserver && rootVariableElement === root) return;
    stopRootVariableObserver();
    rootVariableElement = root;
    rootVariableObserver = new MutationObserver(ensureRootVariables);
    rootVariableObserver.observe(root, { attributes: true, attributeFilter: ['style'] });
  }

  function ensureRootVariables() {
    const root = document.documentElement;
    if (!root?.style || activeCopyTokens.size === 0) return;
    startRootVariableObserver();
    for (const entry of activeCopyTokens.values()) {
      if (entry.rootElement !== root) {
        restoreRootVariable(entry);
        entry.rootElement = root;
        entry.rootSnapshot = propertySnapshot(root.style, entry.activeVariable);
      } else if (!ownsRootVariable(entry, root)) {
        entry.rootSnapshot = propertySnapshot(root.style, entry.activeVariable);
      } else continue;
      root.style.setProperty(entry.activeVariable, hiddenDisplayValue, 'important');
    }
  }

  function activateRootVariable(entry) {
    const root = document.documentElement;
    if (!root?.style) return;
    entry.rootElement = root;
    entry.rootSnapshot = propertySnapshot(root.style, entry.activeVariable);
    startRootVariableObserver();
    root.style.setProperty(entry.activeVariable, hiddenDisplayValue, 'important');
  }

  function serializeCopyMarker(token, reason, activeVariable, snapshot, previous) {
    // The marker travels with detached clones, so restoration cannot depend on retained JS history.
    return JSON.stringify({
      v: actionCopyMarkerVersion,
      t: token,
      r: reason,
      a: activeVariable,
      d: [snapshot.display.value, snapshot.display.priority],
      c: [snapshot.variable.value, snapshot.variable.priority],
      p: previous
    });
  }

  function parseCopyMarker(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      const marker = JSON.parse(value);
      if (
        marker?.v !== actionCopyMarkerVersion ||
        typeof marker.t !== 'string' ||
        !marker.t ||
        typeof marker.r !== 'string' ||
        !marker.r ||
        typeof marker.a !== 'string' ||
        !marker.a.startsWith(actionCopyVariablePrefix) ||
        !actionCopyVariablePattern.test(marker.a) ||
        !Array.isArray(marker.d) ||
        marker.d.length !== 2 ||
        !marker.d.every((part) => typeof part === 'string') ||
        !Array.isArray(marker.c) ||
        marker.c.length !== 2 ||
        !marker.c.every((part) => typeof part === 'string') ||
        (marker.p !== null && typeof marker.p !== 'string')
      ) {
        return null;
      }
      return {
        token: marker.t,
        reason: marker.r,
        activeVariable: marker.a,
        snapshot: {
          display: { value: marker.d[0], priority: marker.d[1] },
          variable: { value: marker.c[0], priority: marker.c[1] }
        },
        previous: marker.p
      };
    } catch {
      return null;
    }
  }

  function markerContainsToken(value, token) {
    const visited = new Set();
    let current = value;
    for (let depth = 0; depth < 100 && current && !visited.has(current); depth += 1) {
      visited.add(current);
      const marker = parseCopyMarker(current);
      if (!marker) return false;
      if (marker.token === token) return true;
      current = marker.previous;
    }
    return false;
  }

  function activeEntryForMarker(marker) {
    if (!marker) return null;
    const entry = activeCopyTokens.get(marker.token);
    return entry?.reason === marker.reason && entry.activeVariable === marker.activeVariable ? entry : null;
  }

  function markerChain(value) {
    const markers = [];
    const visited = new Set();
    let current = value;
    for (let depth = 0; depth < 100 && current && !visited.has(current); depth += 1) {
      visited.add(current);
      const marker = parseCopyMarker(current);
      if (!marker) break;
      markers.push(marker);
      current = marker.previous;
    }
    return markers;
  }

  function retainActiveMarkerCopies(el) {
    let top = null;
    markerChain(el?.getAttribute?.(actionCopyAttribute)).forEach((marker, index) => {
      const entry = activeEntryForMarker(marker);
      if (!entry) return;
      entry.copies.add(el);
      if (index === 0) top = { entry, marker };
    });
    if (top) retainedCopyMarkers.set(el, top.marker);
    return top;
  }

  function refreshRetainedCopyMarker(el) {
    let markers = markerChain(el?.getAttribute?.(actionCopyAttribute));
    if (markers.length === 0) {
      const retained = retainedCopyMarkers.get(el);
      if (retained) markers = [retained, ...markerChain(retained.previous)];
    }
    const active = markers.find((marker) => activeEntryForMarker(marker));
    if (active) retainedCopyMarkers.set(el, active);
    else retainedCopyMarkers.delete(el);
  }

  function transitionOwnedDisplay(el) {
    const state = displayStates.get(el);
    state?.observer.takeRecords();
    el.style.setProperty('display', markerDisplayValue(copyMarkerFor(el)), 'important');
    state?.observer.takeRecords();
    scheduleHiddenDisplay(el);
  }

  function markerElements(root = document) {
    const matches = Array.from(root.querySelectorAll?.(`[${actionCopyAttribute}]`) || []);
    if (root.nodeType === 1 && root.hasAttribute?.(actionCopyAttribute) && !matches.includes(root)) {
      matches.unshift(root);
    }
    return [...new Set(matches)];
  }

  function actionCopies(entry) {
    if (!entry.copyToken) return [entry.el];
    return [...new Set([entry.el, ...entry.copies])];
  }

  function reasonOwnedByActiveAction(el, reason, excludedToken = '', excludedEntry = null) {
    for (const entries of hiddenByAction.values()) {
      for (const entry of entries) {
        if (
          entry === excludedEntry ||
          entry.reason !== reason ||
          (excludedToken && entry.copyToken === excludedToken)
        ) {
          continue;
        }
        if (entry.el === el || entry.copies?.has(el)) return true;
        if (
          entry.copyToken &&
          activeCopyTokens.has(entry.copyToken) &&
          markerContainsToken(el.getAttribute?.(actionCopyAttribute), entry.copyToken)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function restoreCopyMarkers(el, force = false) {
    const visited = new Set();
    for (let depth = 0; depth < 100; depth += 1) {
      const value = el?.getAttribute?.(actionCopyAttribute);
      if (!value || visited.has(value)) return;
      visited.add(value);
      const marker = parseCopyMarker(value);
      const activeEntry = activeEntryForMarker(marker);
      if (!marker) return;
      if (!force && activeEntry) {
        retainedCopyMarkers.set(el, marker);
        return;
      }
      if (retiredCopyTokens.has(marker.token)) BYEBAR.actions?.suppress?.(el);

      seedDisplaySnapshots(el, marker.snapshot);
      captureDisplay(el);
      const ownsDisplay = ownsDisplayDeclaration(el, marker);
      const ownsVariable = ownsVariableDeclaration(el);
      if (!reasonOwnedByActiveAction(el, marker.reason, marker.token)) {
        removeReason(el, marker.reason, { restoreDisplay: false });
      }
      if ((ownsDisplay || ownsVariable) && reasonsFor(el).size === 0) {
        const snapshot = {
          display: displaySnapshots.get(el) || marker.snapshot.display,
          variable: variableSnapshots.get(el) || marker.snapshot.variable
        };
        applyInlineDisplaySnapshot(el, snapshot, {
          display: ownsDisplay,
          variable: ownsVariable
        });
      }
      if (reasonsFor(el).size === 0) {
        stopObservingDisplay(el);
        displaySnapshots.delete(el);
        variableSnapshots.delete(el);
        retainedCopyMarkers.delete(el);
      }
      if (marker.previous === null) {
        el.removeAttribute(actionCopyAttribute);
        retainedCopyMarkers.delete(el);
      } else el.setAttribute(actionCopyAttribute, marker.previous);
      if (reasonsFor(el).size > 0) {
        if (ownsDisplay) transitionOwnedDisplay(el);
        else scheduleHiddenDisplay(el);
      }
    }
  }

  function reconcileCopyElement(el) {
    if (!el?.hasAttribute?.(actionCopyAttribute)) return false;
    restoreCopyMarkers(el);
    const retained = retainActiveMarkerCopies(el);
    if (!retained) return false;
    const { entry, marker } = retained;
    seedDisplaySnapshots(el, marker.snapshot);
    const reasons = reasonsFor(el);
    reasons.add(marker.reason);
    el.setAttribute('data-byebar-hidden', [...reasons].join(' '));
    elementsFor(hiddenByReason, marker.reason).add(el);
    let scrollChanged = false;
    if (entry.blocksScroll) {
      const blockers = elementsFor(scrollBlockersByReason, marker.reason);
      const previousSize = blockers.size;
      blockers.add(el);
      scrollChanged = blockers.size !== previousSize;
    }
    scheduleHiddenDisplay(el);
    return scrollChanged;
  }

  function reconcileCopyMarkers(root) {
    if (!root) return;
    let scrollChanged = false;
    markerElements(root).forEach((el) => {
      if (reconcileCopyElement(el)) scrollChanged = true;
    });
    if (scrollChanged) syncScrollLock();
  }

  function observeCopyRoot(root) {
    if (!copyObserver || !root || observedCopyRoots.has(root)) return;
    observedCopyRoots.add(root);
    try {
      copyObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [actionCopyAttribute]
      });
    } catch {
      /* Ignore roots that cannot be observed. */
    }
  }

  function inspectableShadowRoot(el) {
    try {
      return BYEBAR.shadow?.openOrClosedRoot?.(el) || el?.shadowRoot || null;
    } catch {
      return null;
    }
  }

  function runCopyDiscovery() {
    copyDiscoveryTimer = null;
    ensureRootVariables();
    if (copyDiscoveryFrames === null) {
      const root = document.documentElement || document.firstElementChild;
      copyDiscoveryFrames = root ? [{ next: root, single: true }] : [];
    }
    let inspected = 0;
    let scrollChanged = false;
    while (copyDiscoveryFrames.length > 0 && inspected < copyDiscoveryChunkSize) {
      const frame = copyDiscoveryFrames[copyDiscoveryFrames.length - 1];
      const element = frame.next;
      if (!element) {
        copyDiscoveryFrames.pop();
        continue;
      }
      frame.next = frame.single ? null : element.nextElementSibling;
      inspected += 1;
      if (reconcileCopyElement(element)) scrollChanged = true;

      if (element.firstElementChild) {
        copyDiscoveryFrames.push({ next: element.firstElementChild, single: false });
      }
      const shadowRoot = inspectableShadowRoot(element);
      if (shadowRoot) {
        observeCopyRoot(shadowRoot);
        if (shadowRoot.firstElementChild) {
          copyDiscoveryFrames.push({ next: shadowRoot.firstElementChild, single: false });
        }
      }
    }
    if (scrollChanged) syncScrollLock();
    if (copyDiscoveryFrames.length > 0) {
      copyDiscoveryTimer = setTimeout(runCopyDiscovery, copyDiscoveryStepMs);
      return;
    }
    copyDiscoveryFrames = null;
    copyDiscoveryTimer = setTimeout(runCopyDiscovery, copyDiscoveryCycleMs);
  }

  function startCopyDiscovery() {
    if (copyDiscoveryTimer !== null || copyDiscoveryFrames !== null) return;
    runCopyDiscovery();
  }

  function startCopyObserver() {
    if (copyObserver) return;
    copyObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        if (record.type === 'attributes') {
          reconcileCopyElement(record.target);
          return;
        }
        const treeChanged = record.addedNodes.length > 0 || record.removedNodes?.length > 0;
        record.addedNodes.forEach((node) => {
          if (node.nodeType !== 1 && node.nodeType !== 11) return;
          if (node.nodeType === 11) observeCopyRoot(node);
          const shadowRoot = node.nodeType === 1 ? inspectableShadowRoot(node) : null;
          if (shadowRoot) observeCopyRoot(shadowRoot);
          reconcileCopyMarkers(node);
        });
        if (treeChanged) syncScrollLock();
      });
    });
    observeCopyRoot(document);
    startCopyDiscovery();
  }

  function retireCopyEntry(entry) {
    if (!entry.copyToken) return new Set([entry.el]);
    const copies = new Set(actionCopies(entry));
    const ownedDisplays = new Set([...copies].filter((el) => ownsDisplayDeclaration(el)));
    activeCopyTokens.delete(entry.copyToken);
    retiredCopyTokens.add(entry.copyToken);
    restoreRootVariable(entry);
    if (activeCopyTokens.size === 0) stopRootVariableObserver();
    copies.forEach((el) => {
      restoreCopyMarkers(el);
      refreshRetainedCopyMarker(el);
    });
    copies.forEach((el) => {
      if (!reasonOwnedByActiveAction(el, entry.reason, '', entry)) removeReason(el, entry.reason);
      if (reasonsFor(el).size === 0) return;
      if (ownedDisplays.has(el)) transitionOwnedDisplay(el);
      else scheduleHiddenDisplay(el);
    });
    entry.copies.clear();
    syncScrollLock();
    return copies;
  }

  function writeHiddenDisplay(el, state) {
    captureDisplay(el);
    if (ownsHiddenDisplay(el) || (state && state.retryCount >= maxDisplayRetries)) return;
    state?.observer.takeRecords();
    el.style.setProperty(hiddenDisplayVariable, 'none', 'important');
    captureDisplay(el);
    el.style.setProperty('display', markerDisplayValue(copyMarkerFor(el)), 'important');
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

  function connectedActionCopy(entry, excluded) {
    return actionCopies(entry).find(
      (candidate) =>
        candidate !== excluded && candidate.isConnected && reasonsFor(candidate).has(entry.reason)
    );
  }

  function forgetDisconnectedElement(el) {
    for (const [actionId, entries] of hiddenByAction) {
      for (const entry of entries) {
        if (entry.el === el) {
          const replacement = connectedActionCopy(entry, el);
          if (replacement) {
            entry.el = replacement;
            entry.copies.delete(el);
          } else {
            retireCopyEntry(entry);
            entries.delete(entry);
          }
        } else entry.copies?.delete(el);
      }
      if (entries.size === 0) {
        hiddenByAction.delete(actionId);
        forgottenActions.delete(actionId);
      }
    }
    for (const [reason, elements] of hiddenByReason) {
      elements.delete(el);
      if (elements.size === 0) hiddenByReason.delete(reason);
    }
    for (const [reason, elements] of scrollBlockersByReason) {
      elements.delete(el);
      if (elements.size === 0) scrollBlockersByReason.delete(reason);
    }
    if (el.hasAttribute?.(actionCopyAttribute)) restoreCopyMarkers(el, true);
    el.removeAttribute('data-byebar-hidden');
    stopObservingDisplay(el);
    restoreInlineDisplay(el);
    syncScrollLock();
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
    if (copyObserver) {
      if (root.nodeType === 11) observeCopyRoot(root);
      const shadowRoot = root.nodeType === 1 ? inspectableShadowRoot(root) : null;
      if (shadowRoot) observeCopyRoot(shadowRoot);
      reconcileCopyMarkers(root);
    }
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
    retainedCopyMarkers.delete(el);
  }

  function hide(el, reason, { blocksScroll = false, actionId = '', trackCopies = false } = {}) {
    if (!el || el.nodeType !== 1 || !reason) return false;

    const entries = actionId ? elementsFor(hiddenByAction, actionId) : null;
    const existingEntry = entries
      ? [...entries].find((entry) => entry.el === el && entry.reason === reason)
      : null;
    const sequence = trackCopies && actionId && !existingEntry ? ++copySequence : 0;
    const copyToken = existingEntry?.copyToken || (sequence ? `${actionId}:${sequence}` : '');
    const activeVariable =
      existingEntry?.activeVariable ||
      (copyToken ? `${actionCopyVariablePrefix}${actionCopyVariableNonce}-${sequence}` : '');
    const entry =
      existingEntry ||
      (entries
        ? {
            el,
            reason,
            copyToken,
            activeVariable,
            blocksScroll,
            copies: new Set(),
            rootElement: null,
            rootSnapshot: null
          }
        : null);
    if (entry) entry.blocksScroll ||= blocksScroll;
    if (entries && !existingEntry) entries.add(entry);
    if (copyToken && !existingEntry) {
      const ownsPreviousDisplay = ownsDisplayDeclaration(el);
      const snapshot = inlineDisplaySnapshot(el);
      const previousCopyMarker = el.getAttribute(actionCopyAttribute);
      seedDisplaySnapshots(el, snapshot);
      activeCopyTokens.set(copyToken, entry);
      activateRootVariable(entry);
      el.setAttribute(
        actionCopyAttribute,
        serializeCopyMarker(copyToken, reason, activeVariable, snapshot, previousCopyMarker)
      );
      retainActiveMarkerCopies(el);
      if (ownsPreviousDisplay) transitionOwnedDisplay(el);
      startCopyObserver();
    }
    const reasons = reasonsFor(el);
    reasons.add(reason);
    el.setAttribute('data-byebar-hidden', [...reasons].join(' '));
    scheduleHiddenDisplay(el);
    elementsFor(hiddenByReason, reason).add(el);

    if (blocksScroll) {
      elementsFor(scrollBlockersByReason, reason).add(el);
      syncScrollLock();
    }

    return true;
  }

  function removeReason(el, reason, { restoreDisplay = true } = {}) {
    const reasons = reasonsFor(el);
    reasons.delete(reason);
    const hidden = hiddenByReason.get(reason);
    hidden?.delete(el);
    if (hidden?.size === 0) hiddenByReason.delete(reason);
    const blockers = scrollBlockersByReason.get(reason);
    const scrollChanged = blockers?.delete(el) === true;
    if (blockers?.size === 0) scrollBlockersByReason.delete(reason);

    if (reasons.size > 0) {
      el.setAttribute('data-byebar-hidden', [...reasons].join(' '));
    } else {
      el.removeAttribute('data-byebar-hidden');
      stopObservingDisplay(el);
      if (restoreDisplay) restoreInlineDisplay(el);
    }
    if (scrollChanged) syncScrollLock();
  }

  function restore(reason) {
    for (const [actionId, entries] of hiddenByAction) {
      for (const entry of entries) {
        if (entry.reason === reason) {
          retireCopyEntry(entry);
          entries.delete(entry);
        }
      }
      if (entries.size === 0) {
        hiddenByAction.delete(actionId);
        forgottenActions.delete(actionId);
      }
    }
    hiddenByReason.get(reason)?.forEach((el) => removeReason(el, reason));
    hiddenByReason.delete(reason);
    scrollBlockersByReason.delete(reason);
    syncScrollLock();
  }

  function restoreAction(actionId) {
    const entries = hiddenByAction.get(actionId);
    if (!entries) return [];

    const restored = new Set();
    for (const entry of entries) {
      const { el, reason } = entry;
      retireCopyEntry(entry).forEach((copy) => restored.add(copy));
      if (!reasonOwnedByActiveAction(el, reason, '', entry)) {
        removeReason(el, reason);
      }
      restored.add(el);
    }
    hiddenByAction.delete(actionId);
    forgottenActions.delete(actionId);
    syncScrollLock();
    return [...restored];
  }

  function forgetAction(actionId) {
    const entries = hiddenByAction.get(actionId);
    if (!entries) return false;
    const retained = new Set([...entries].filter((entry) => entry.copyToken));
    if (retained.size > 0) {
      // Undo expiry must not retire copy ownership before the hidden target itself expires.
      hiddenByAction.set(actionId, retained);
      forgottenActions.add(actionId);
    } else hiddenByAction.delete(actionId);
    return true;
  }

  function hasAction(actionId) {
    if (forgottenActions.has(actionId)) return false;
    const entries = hiddenByAction.get(actionId);
    if (!entries) return false;
    for (const entry of entries) {
      if (!actionCopies(entry).some((el) => reasonsFor(el).has(entry.reason))) {
        retireCopyEntry(entry);
        entries.delete(entry);
      }
    }
    if (entries.size === 0) {
      hiddenByAction.delete(actionId);
      forgottenActions.delete(actionId);
    }
    return entries.size > 0;
  }

  function isActionRetained(actionId) {
    const entries = hiddenByAction.get(actionId);
    if (!entries || entries.size === 0) return false;
    for (const entry of entries) {
      let retained = entry.el;
      if (!retained.isConnected && entry.copyToken) {
        retained = connectedActionCopy(entry, retained) || retained;
        if (retained !== entry.el) entry.el = retained;
      }
      if (!retained.isConnected || !reasonsFor(retained).has(entry.reason) || !ownsHiddenDisplay(retained)) {
        return false;
      }
      try {
        if (getComputedStyle(retained).display !== 'none') return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  function restoreAll() {
    for (const entries of hiddenByAction.values()) {
      entries.forEach((entry) => retireCopyEntry(entry));
    }
    for (const [reason, elements] of hiddenByReason) {
      elements.forEach((el) => removeReason(el, reason));
    }
    hiddenByReason.clear();
    scrollBlockersByReason.clear();
    hiddenByAction.clear();
    forgottenActions.clear();
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
    let hasBlocker = false;
    for (const [reason, elements] of scrollBlockersByReason) {
      for (const el of elements) {
        if (el.isConnected && reasonsFor(el).has(reason)) hasBlocker = true;
        else elements.delete(el);
      }
      if (elements.size === 0) scrollBlockersByReason.delete(reason);
    }
    for (const entry of activeCopyTokens.values()) {
      if (!entry.blocksScroll) continue;
      const copy = actionCopies(entry).find(
        (candidate) => candidate.isConnected && reasonsFor(candidate).has(entry.reason)
      );
      if (!copy) continue;
      elementsFor(scrollBlockersByReason, entry.reason).add(copy);
      hasBlocker = true;
    }
    return hasBlocker;
  }

  function syncScrollLock() {
    const html = document.documentElement;
    if (!html) return;

    const hiddenModal = hasConnectedScrollBlocker();
    const visibleModal = hiddenModal
      ? Array.from(document.querySelectorAll('dialog[open], [role~="dialog" i], [aria-modal="true"]')).some(
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
    isActionRetained,
    isHidden,
    ensureHidden,
    syncScrollLock
  };
})();
