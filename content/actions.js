/**
 * Document-scoped action ledger, undo, local diagnostics, and focus safety.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const DEBUG_KEY = 'byebar.debug';
  const PROTOCOL = BYEBAR.lib.constants.MESSAGE_PROTOCOL_VERSION;
  const MAX_DECISIONS = 100;
  const MAX_UNDO_ACTIONS = 10;
  const documentId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const decisions = [];
  const suppressed = new WeakSet();
  const focusHistory = [];
  const undoHistory = [];
  let debugEnabled = false;
  let sequence = 0;
  let latestAction = null;
  let debugGeneration = 0;
  let activeSweepCounts = null;

  function createSweepCounts() {
    return {
      reversibleHides: 0,
      dismissActions: 0,
      cookieDeclines: 0,
      legalAccepts: 0
    };
  }

  function captureSweepResult(run) {
    const previous = activeSweepCounts;
    const counts = createSweepCounts();
    activeSweepCounts = counts;
    try {
      run();
    } finally {
      activeSweepCounts = previous;
    }
    return {
      outcome: Object.values(counts).some((count) => count > 0) ? 'applied' : 'no-op',
      counts: { ...counts }
    };
  }

  function nextId() {
    sequence += 1;
    return `${documentId}:${sequence}`;
  }

  function safeMeta(meta = {}) {
    return {
      feature: String(meta.feature || 'genericBlocking'),
      rule: String(meta.rule || 'generic'),
      operation: String(meta.operation || 'hide'),
      reason: String(meta.reason || 'matched-rule')
    };
  }

  function pushDecision(meta, result, reversible) {
    if (!debugEnabled) return;
    decisions.push({
      id: nextId(),
      sequence,
      at: Date.now(),
      ...safeMeta(meta),
      result,
      reversible: Boolean(reversible)
    });
    if (decisions.length > MAX_DECISIONS) decisions.splice(0, decisions.length - MAX_DECISIONS);
  }

  function deepActiveElement() {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }

  function isWithinAny(el, targets) {
    if (!el) return false;
    return targets.some((target) => {
      let node = el;
      while (node) {
        if (node === target) return true;
        if (node.assignedSlot) node = node.assignedSlot;
        else if (node.parentNode) node = node.parentNode;
        else node = node.getRootNode?.()?.host || null;
      }
      return false;
    });
  }

  function isFocusableCandidate(el, excluded = []) {
    if (!el?.isConnected || typeof el.focus !== 'function') return false;
    if (isWithinAny(el, excluded) || BYEBAR.visibility.isHidden(el)) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect?.();
    return Boolean(
      style.display !== 'none' && style.visibility !== 'hidden' && rect && rect.width > 0 && rect.height > 0
    );
  }

  function focusFallback(excluded = []) {
    if (!document.hasFocus()) return;
    for (let index = focusHistory.length - 1; index >= 0; index -= 1) {
      const candidate = focusHistory[index];
      if (!isFocusableCandidate(candidate, excluded)) continue;
      candidate.focus({ preventScroll: true });
      return;
    }

    const fallback = document.querySelector('main') || document.body;
    if (!fallback || isWithinAny(fallback, excluded)) return;
    const previousTabIndex = fallback.getAttribute('tabindex');
    fallback.setAttribute('tabindex', '-1');
    fallback.focus({ preventScroll: true });
    if (previousTabIndex === null) fallback.removeAttribute('tabindex');
    else fallback.setAttribute('tabindex', previousTabIndex);
  }

  function repairFocusAfterHide(previousFocus, targets) {
    if (!isWithinAny(previousFocus, targets)) return;
    focusFallback(targets);
  }

  function repairFocusAfterIrreversible() {
    const active = deepActiveElement();
    if (!active || !active.isConnected || BYEBAR.visibility.isHidden(active)) focusFallback();
  }

  document.addEventListener(
    'focusin',
    (event) => {
      const target = event.composedPath?.().find((node) => node?.nodeType === 1) || event.target;
      if (!target || BYEBAR.visibility.isHidden(target)) return;
      const existing = focusHistory.indexOf(target);
      if (existing >= 0) focusHistory.splice(existing, 1);
      focusHistory.push(target);
      if (focusHistory.length > 20) focusHistory.shift();
    },
    true
  );

  function begin(meta) {
    return {
      id: nextId(),
      at: Date.now(),
      meta: safeMeta(meta),
      targets: [],
      previousFocus: deepActiveElement()
    };
  }

  function hide(action, el, reason, options = {}) {
    if (
      !action ||
      !el ||
      (suppressed.has(el) && options.userInitiated !== true) ||
      BYEBAR.visibility.isHidden(el)
    ) {
      return false;
    }
    if (options.userInitiated === true) suppressed.delete(el);
    const hidden = BYEBAR.visibility.hide(el, reason, { ...options, actionId: action.id });
    if (hidden) {
      action.targets.push(el);
      if (activeSweepCounts) activeSweepCounts.reversibleHides += 1;
    }
    return hidden;
  }

  function pruneUndoHistory() {
    for (let index = undoHistory.length - 1; index >= 0; index -= 1) {
      if (!BYEBAR.visibility.hasAction(undoHistory[index].id)) undoHistory.splice(index, 1);
    }
    return undoHistory[undoHistory.length - 1] || null;
  }

  function commit(action) {
    if (!action?.targets.length) return false;
    repairFocusAfterHide(action.previousFocus, action.targets);
    const completed = {
      id: action.id,
      at: action.at,
      ...action.meta,
      reversible: true,
      canUndo: true
    };
    latestAction = completed;
    pruneUndoHistory();
    undoHistory.push(completed);
    while (undoHistory.length > MAX_UNDO_ACTIONS) {
      BYEBAR.visibility.forgetAction(undoHistory.shift().id);
    }
    pushDecision(action.meta, 'applied', true);
    return true;
  }

  function skip(meta, reason = 'not-safe') {
    pushDecision({ ...meta, reason }, 'skipped', false);
  }

  function recordIrreversible(meta) {
    const normalized = safeMeta(meta);
    const action = {
      id: nextId(),
      at: Date.now(),
      ...normalized,
      reversible: false,
      canUndo: false
    };
    const countKey = {
      dismiss: 'dismissActions',
      decline: 'cookieDeclines',
      accept: 'legalAccepts'
    }[normalized.operation];
    if (activeSweepCounts && countKey) activeSweepCounts[countKey] += 1;
    latestAction = action;
    pushDecision(normalized, 'applied', false);
    requestAnimationFrame(repairFocusAfterIrreversible);
    return action;
  }

  function isSuppressed(el) {
    return suppressed.has(el);
  }

  function pageState() {
    const latestReversibleAction = pruneUndoHistory();
    const action = latestAction
      ? {
          ...latestAction,
          canUndo: Boolean(latestAction.reversible && BYEBAR.visibility.hasAction(latestAction.id))
        }
      : null;
    const undoAction = latestReversibleAction
      ? {
          ...latestReversibleAction,
          canUndo: true
        }
      : null;
    return {
      ok: true,
      documentId,
      capabilities: ['sweep', 'pick'],
      picker: BYEBAR.picker?.state?.() || { active: false, busy: false, sessionId: '' },
      lastAction: action,
      undoAction,
      undoActionCount: undoHistory.length,
      debugEnabled,
      decisions: debugEnabled ? [...decisions] : []
    };
  }

  function undo(message) {
    if (message.documentId !== documentId) return { ok: false, error: { code: 'stale-document' } };
    if (BYEBAR.picker?.blocksAutomation?.()) {
      return { ok: false, error: { code: 'picker-active' } };
    }
    const latestReversibleAction = pruneUndoHistory();
    if (!latestReversibleAction || message.actionId !== latestReversibleAction.id) {
      return { ok: false, error: { code: 'not-latest-hide' } };
    }

    const restored = BYEBAR.visibility.restoreAction(latestReversibleAction.id);
    if (restored.length === 0) {
      undoHistory.pop();
      return { ok: false, error: { code: 'target-gone' } };
    }
    undoHistory.pop();
    restored.forEach((el) => suppressed.add(el));
    pushDecision({ ...latestReversibleAction, operation: 'undo', reason: 'user-request' }, 'applied', false);
    latestAction = {
      ...latestReversibleAction,
      canUndo: false,
      reversible: false,
      operation: 'undo'
    };
    return pageState();
  }

  async function sweep(message) {
    if (message.documentId !== documentId) return { ok: false, error: { code: 'stale-document' } };
    if (BYEBAR.picker?.blocksAutomation?.()) {
      return { ok: false, error: { code: 'picker-active' } };
    }
    const result = await BYEBAR.engine.sweepPage();
    return {
      ...pageState(),
      sweep: result
    };
  }

  async function startPicker(message) {
    if (message.documentId !== documentId) return { ok: false, error: { code: 'stale-document' } };
    if (!BYEBAR.picker?.start) return { ok: false, error: { code: 'picker-unavailable' } };
    const response = await BYEBAR.picker.start(message.sessionId);
    return response.ok ? pageState() : response;
  }

  function cancelPicker(message) {
    if (message.documentId !== documentId) return { ok: false, error: { code: 'stale-document' } };
    if (!BYEBAR.picker?.cancel) return { ok: false, error: { code: 'picker-unavailable' } };
    const response = BYEBAR.picker.cancel(message.sessionId);
    return response.ok ? pageState() : response;
  }

  BYEBAR.browser.onStorageChanged((changes, area) => {
    if (area !== 'local' || !changes[DEBUG_KEY]) return;
    debugGeneration += 1;
    debugEnabled = Boolean(changes[DEBUG_KEY].newValue?.enabled);
    if (!debugEnabled) decisions.length = 0;
  });

  const initialDebugGeneration = debugGeneration;
  const ready = BYEBAR.browser
    .localGet({ [DEBUG_KEY]: { schemaVersion: 1, enabled: false } })
    .then((stored) => {
      if (initialDebugGeneration === debugGeneration) {
        debugEnabled = stored?.[DEBUG_KEY]?.enabled === true;
      }
    })
    .catch(() => {});

  BYEBAR.browser.api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.type?.startsWith?.('byebar.page.')) return;
    if (message.protocol !== PROTOCOL) {
      sendResponse({ ok: false, error: { code: 'protocol-mismatch', message: 'Unsupported protocol' } });
      return;
    }
    void ready
      .then(async () => {
        if (message.type === 'byebar.page.getState') sendResponse(pageState());
        else if (message.type === 'byebar.page.undo') sendResponse(undo(message));
        else if (message.type === 'byebar.page.sweep') sendResponse(await sweep(message));
        else if (message.type === 'byebar.page.pick.start') sendResponse(await startPicker(message));
        else if (message.type === 'byebar.page.pick.cancel') sendResponse(cancelPicker(message));
        else if (message.type === 'byebar.page.debug.clear') {
          if (message.documentId !== documentId)
            sendResponse({ ok: false, error: { code: 'stale-document' } });
          else {
            decisions.length = 0;
            sendResponse(pageState());
          }
        } else {
          sendResponse({ ok: false, error: { code: 'unknown-message', message: 'Unknown request' } });
        }
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: { code: 'page-state-unavailable', message: error?.message || 'Page state unavailable' }
        });
      });
    return true;
  });

  BYEBAR.actions = {
    ready,
    begin,
    hide,
    commit,
    skip,
    recordIrreversible,
    captureSweepResult,
    isSuppressed,
    pageState
  };
})();
