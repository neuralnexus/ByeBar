/**
 * One-shot, document-scoped manual picker with isolated page UI.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const SESSION_ID_RE = /^[a-zA-Z0-9-]{1,128}$/;
  const START_TIMEOUT_MS = 5_000;
  const SESSION_TIMEOUT_MS = 60_000;
  const CLICK_TAIL_MS = 500;
  const POINTER_SETTLE_TIMEOUT_MS = 1_000;
  const SUCCESS_NOTICE_MS = 1_800;
  const HIDE_SETTLE_MS = 120;
  const CONTROL_CLICK_DEDUPE_MS = 750;
  const MAX_KEYBOARD_SCAN_ELEMENTS = 5_000;
  const MAX_TOP_LAYER_SCAN_ELEMENTS = 5_000;
  const KEYBOARD_SEED_SELECTOR = [
    'dialog',
    '[role~="dialog" i]',
    '[aria-modal="true"]',
    'button',
    'a[href]',
    'area[href]',
    'input',
    'select',
    'textarea',
    'summary',
    '[contenteditable="true"]',
    '[tabindex]'
  ].join(',');
  const eventOptions = { capture: true, passive: false };
  const activePointers = new Set();
  const pendingControlClicks = new Map();
  let mode = 'idle';
  let sessionId = '';
  let host = null;
  let pickerRoot = null;
  let shield = null;
  let outline = null;
  let coach = null;
  let coachTitle = null;
  let coachCopy = null;
  let coachControls = null;
  let previousTargetButton = null;
  let nextTargetButton = null;
  let hideTargetButton = null;
  let cancelButton = null;
  let candidate = null;
  let pressed = null;
  let highlightFrame = null;
  let sessionTimer = null;
  let routeTimer = null;
  let settleTimer = null;
  let pointerSettleTimer = null;
  let noticeTimer = null;
  let hideSettleTimer = null;
  let controlClickTimer = null;
  let settleResume = true;
  let startedRoute = null;
  let navigationGeneration = 0;
  let suppressEscapeKeyup = false;
  let sessionGeneration = 0;
  let lastPointerPoint = null;
  let pointerInteractionDeadline = 0;
  let startupCanResume = false;
  let returnFocus = null;
  let hiddenFocusTarget = null;
  let keyboardCandidateCount = 0;
  let keyboardCandidateIndex = -1;
  let pendingHide = null;
  let controlPress = null;
  const hasRole =
    BYEBAR.lib.aria?.hasRole ||
    ((el, role) =>
      String(el?.getAttribute?.('role') || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .includes(role));

  function isSessionActive() {
    return mode === 'starting' || mode === 'active' || mode === 'verifying';
  }

  function blocksAutomation() {
    return mode !== 'idle';
  }

  function capturesInput() {
    return Boolean(host && (mode === 'active' || mode === 'verifying' || mode === 'settling'));
  }

  function available() {
    const probe = document.documentElement || document.body || document.createElement?.('div');
    return BYEBAR.shadow?.canInspectClosedRoots?.(probe) === true && captureRouteIdentity() !== null;
  }

  function state() {
    return {
      active: isSessionActive(),
      available: available(),
      busy: blocksAutomation(),
      sessionId: isSessionActive() ? sessionId : ''
    };
  }

  function captureRouteIdentity() {
    try {
      const entry = window.navigation?.currentEntry;
      const navigationId = entry?.id ?? null;
      const navigationKey = entry?.key ?? null;
      const navigationIndex = entry?.index ?? null;
      if (!entry || (navigationId === null && navigationKey === null && navigationIndex === null))
        return null;
      return { navigationGeneration, navigationId, navigationKey, navigationIndex };
    } catch {
      return null;
    }
  }

  function routeIsCurrent() {
    if (!startedRoute) return false;
    const current = captureRouteIdentity();
    return Boolean(
      current &&
      current.navigationGeneration === startedRoute.navigationGeneration &&
      current.navigationId === startedRoute.navigationId &&
      current.navigationKey === startedRoute.navigationKey &&
      current.navigationIndex === startedRoute.navigationIndex
    );
  }

  function activeTopLayerError() {
    if (document.fullscreenElement) return 'fullscreen-active';
    if (BYEBAR.shadow?.findIncludingClosed) {
      const result = BYEBAR.shadow.findIncludingClosed(
        ['dialog:modal', ':popover-open'],
        document,
        MAX_TOP_LAYER_SCAN_ELEMENTS
      );
      if (result.element) {
        return result.selector === 'dialog:modal' ? 'native-modal-active' : 'top-layer-active';
      }
      return result.exhausted ? 'top-layer-active' : '';
    }
    if (BYEBAR.shadow?.queryIncludingClosed?.('dialog:modal', document)) return 'native-modal-active';
    if (BYEBAR.shadow?.queryIncludingClosed?.(':popover-open', document)) return 'top-layer-active';
    return '';
  }

  function shieldOwnsPoint(x, y) {
    if (!host || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    try {
      return document.elementFromPoint(x, y) === host;
    } catch {
      return false;
    }
  }

  function shieldCoversViewport() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (!host || width < 3 || height < 3) return false;
    const xPoints = [1, Math.floor(width / 2), width - 2];
    const yPoints = [1, Math.floor(height / 2), height - 2];
    return xPoints.every((x) => yPoints.every((y) => shieldOwnsPoint(x, y)));
  }

  function setHostStyle(el) {
    const values = {
      all: 'initial',
      display: 'block',
      position: 'fixed',
      inset: '0',
      width: 'auto',
      height: 'auto',
      margin: '0',
      padding: '0',
      border: '0',
      opacity: '1',
      visibility: 'visible',
      'pointer-events': 'auto',
      'z-index': '2147483647',
      contain: 'strict',
      isolation: 'isolate',
      transform: 'none',
      transition: 'none',
      animation: 'none'
    };
    for (const [property, value] of Object.entries(values)) {
      el.style.setProperty(property, value, 'important');
    }
  }

  function createUi() {
    if (!document.documentElement) throw new Error('Picker host unavailable');
    host?.remove();
    host = document.createElement('div');
    host.setAttribute('data-byebar-picker-root', '');
    setHostStyle(host);
    pickerRoot = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        color-scheme: light;
        direction: ltr;
        font: 13px/1.35 "Avenir Next", "Segoe UI Variable", "Trebuchet MS", sans-serif;
      }
      *, *::before, *::after { box-sizing: border-box; }
      .shield {
        position: fixed;
        inset: 0;
        z-index: 0;
        cursor: crosshair;
        pointer-events: auto;
        touch-action: none;
        background: transparent;
      }
      .outline {
        position: fixed;
        z-index: 1;
        pointer-events: none;
        background: rgb(69 215 181 / 13%);
        border: 3px solid #ff7358;
        outline: 1px solid #f6f3e8;
        outline-offset: 1px;
        border-radius: 7px;
      }
      .outline[hidden] { display: none; }
      .coach {
        position: fixed;
        top: max(12px, env(safe-area-inset-top));
        left: 50%;
        z-index: 2;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 10px;
        align-items: center;
        width: min(500px, calc(100vw - 24px));
        min-height: 50px;
        padding: 8px 12px;
        color: #f6f3e8;
        background: linear-gradient(145deg, #0a514c, #052f2d);
        border: 1px solid #45d7b5;
        border-top: 3px solid #ff7358;
        border-radius: 14px;
        box-shadow: 3px 3px 0 #052f2d, 0 10px 28px rgb(5 47 45 / 24%);
        pointer-events: none;
        transform: translateX(-50%);
        animation: byebar-picker-in 140ms ease-out both;
      }
      .mark {
        width: 11px;
        height: 11px;
        background: #45d7b5;
        border: 2px solid #f6f3e8;
        border-radius: 50%;
      }
      .copy { display: grid; min-width: 0; }
      strong { color: #fffef9; font-size: 13px; }
      small { color: #b9f0df; font-size: 11px; }
      .controls {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
        pointer-events: auto;
      }
      .controls[hidden] { display: none; }
      button {
        min-height: 44px;
        padding: 6px 8px;
        color: #052f2d;
        font: inherit;
        font-size: 10px;
        font-weight: 800;
        background: #f6f3e8;
        border: 1px solid #45d7b5;
        border-radius: 8px;
        cursor: pointer;
      }
      button[data-action="hide"] { background: #ff7358; border-color: #ff7358; }
      button[data-action="cancel"] { color: #f6f3e8; background: #0a514c; }
      button:disabled { cursor: not-allowed; filter: grayscale(.4); opacity: .48; }
      button:focus-visible {
        outline: 2px solid #fffef9;
        outline-offset: 2px;
      }
      .coach.success { border-color: #45d7b5; border-top-color: #45d7b5; }
      .coach.success .mark { background: #ff7358; }
      @keyframes byebar-picker-in { from { opacity: 0; transform: translate(-50%, -5px); } }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation: none !important; transition: none !important; }
      }
      @media (forced-colors: active) {
        .coach { color: CanvasText; background: Canvas; border: 2px solid CanvasText; box-shadow: none; }
        strong, small { color: CanvasText; }
        .mark { background: Highlight; border-color: Canvas; }
        button { color: ButtonText; background: ButtonFace; border-color: ButtonText; }
        .outline { background: transparent; border: 3px solid Highlight; outline-color: CanvasText; }
      }
    `;
    shield = document.createElement('div');
    shield.className = 'shield';
    outline = document.createElement('div');
    outline.className = 'outline';
    outline.hidden = true;
    coach = document.createElement('section');
    coach.className = 'coach';
    coach.setAttribute('role', 'status');
    coach.setAttribute('aria-live', 'polite');
    coach.setAttribute('aria-atomic', 'true');
    coach.tabIndex = -1;
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'copy';
    coachTitle = document.createElement('strong');
    coachTitle.textContent = 'Pick to hide';
    coachCopy = document.createElement('small');
    coachCopy.textContent = 'Point and click, or choose Next target. Esc cancels.';
    copy.append(coachTitle, coachCopy);
    coachControls = document.createElement('div');
    coachControls.className = 'controls';
    const createControl = (label, action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.action = action;
      return button;
    };
    previousTargetButton = createControl('Previous', 'previous');
    nextTargetButton = createControl('Next target', 'next');
    hideTargetButton = createControl('Hide target', 'hide');
    cancelButton = createControl('Cancel', 'cancel');
    hideTargetButton.disabled = true;
    coachControls.append(previousTargetButton, nextTargetButton, hideTargetButton, cancelButton);
    coach.append(mark, copy, coachControls);
    pickerRoot.append(style, shield, outline, coach);
    document.documentElement.append(host);
  }

  function clearLifecycleTimers() {
    clearTimeout(sessionTimer);
    clearInterval(routeTimer);
    sessionTimer = null;
    routeTimer = null;
  }

  function trackPointer(pointerId) {
    if (activePointers.size === 0) {
      pointerInteractionDeadline = Date.now() + POINTER_SETTLE_TIMEOUT_MS;
    }
    activePointers.add(pointerId);
  }

  function releasePointer(pointerId) {
    activePointers.delete(pointerId);
    if (activePointers.size === 0) pointerInteractionDeadline = 0;
  }

  function clearTrackedPointers() {
    activePointers.clear();
    pointerInteractionDeadline = 0;
  }

  function rollbackPendingHide() {
    clearTimeout(hideSettleTimer);
    hideSettleTimer = null;
    if (!pendingHide) return null;
    const pending = pendingHide;
    pendingHide = null;
    BYEBAR.visibility.restoreAction(pending.action.id);
    hiddenFocusTarget = null;
    return pending;
  }

  function removeUi() {
    rollbackPendingHide();
    if (highlightFrame !== null) cancelAnimationFrame(highlightFrame);
    clearTimeout(settleTimer);
    clearTimeout(pointerSettleTimer);
    clearTimeout(noticeTimer);
    clearTimeout(controlClickTimer);
    highlightFrame = null;
    settleTimer = null;
    pointerSettleTimer = null;
    noticeTimer = null;
    controlClickTimer = null;
    pendingControlClicks.clear();
    host?.remove();
    host = null;
    pickerRoot = null;
    shield = null;
    outline = null;
    coach = null;
    coachTitle = null;
    coachCopy = null;
    coachControls = null;
    previousTargetButton = null;
    nextTargetButton = null;
    hideTargetButton = null;
    cancelButton = null;
    candidate = null;
    pressed = null;
    controlPress = null;
    lastPointerPoint = null;
    keyboardCandidateCount = 0;
    keyboardCandidateIndex = -1;
    clearTrackedPointers();
  }

  function isWithinTarget(element, target) {
    let node = element;
    while (node) {
      if (node === target) return true;
      node = BYEBAR.lib.pick.composedParent(node);
    }
    return false;
  }

  function canRestoreFocus(element) {
    if (!element?.isConnected || typeof element.focus !== 'function') return false;
    if (hiddenFocusTarget && isWithinTarget(element, hiddenFocusTarget)) return false;
    if (BYEBAR.visibility.isHidden(element)) return false;
    let node = element;
    while (node) {
      if (
        node.inert === true ||
        node.hasAttribute?.('inert') ||
        node.getAttribute?.('aria-hidden') === 'true'
      ) {
        return false;
      }
      node = BYEBAR.lib.pick.composedParent(node);
    }
    try {
      if (element.matches?.(':disabled')) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect?.();
      return Boolean(
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        (!rect || (rect.width > 0 && rect.height > 0))
      );
    } catch {
      return false;
    }
  }

  function deepActiveElement() {
    let active = document.activeElement;
    const visited = new Set();
    while (active && !visited.has(active)) {
      visited.add(active);
      const nested = BYEBAR.shadow?.openOrClosedRoot?.(active)?.activeElement;
      if (!nested) break;
      active = nested;
    }
    return active;
  }

  function focusPageTarget(target) {
    if (!canRestoreFocus(target)) return false;
    const temporaryTabIndex = !target.hasAttribute?.('tabindex');
    if (temporaryTabIndex) target.setAttribute?.('tabindex', '-1');
    try {
      target.focus({ preventScroll: true });
    } catch {
      if (temporaryTabIndex && target.getAttribute?.('tabindex') === '-1') {
        target.removeAttribute?.('tabindex');
      }
      return false;
    }
    if (deepActiveElement() !== target) {
      if (temporaryTabIndex && target.getAttribute?.('tabindex') === '-1') {
        target.removeAttribute?.('tabindex');
      }
      return false;
    }
    if (temporaryTabIndex) {
      target.addEventListener(
        'blur',
        () => {
          if (target.getAttribute('tabindex') === '-1') target.removeAttribute('tabindex');
        },
        { once: true }
      );
    }
    return true;
  }

  function restorePageFocus(beforeCommit = false) {
    if (!returnFocus || (mode !== 'idle' && !beforeCommit) || !document.hasFocus()) return;
    const rootFocus = returnFocus === document.body || returnFocus === document.documentElement;
    const fallback = document.querySelector('main') || document.body;
    const targets = rootFocus ? [fallback] : [returnFocus, fallback];
    for (const target of new Set(targets.filter(Boolean))) {
      if (!focusPageTarget(target)) continue;
      returnFocus = null;
      hiddenFocusTarget = null;
      return;
    }
  }

  function finishIdle(resume = true) {
    mode = 'idle';
    sessionId = '';
    startedRoute = null;
    pressed = null;
    startupCanResume = false;
    if (resume) BYEBAR.engine?.resumeAutomation?.();
    restorePageFocus();
  }

  function completePointerSettle() {
    if (mode !== 'settling' || settleTimer !== null) return;
    clearTimeout(pointerSettleTimer);
    pointerSettleTimer = null;
    pointerInteractionDeadline = 0;
    settleTimer = setTimeout(() => {
      removeUi();
      finishIdle(settleResume);
    }, CLICK_TAIL_MS);
  }

  function stop(reason = 'cancelled', settlePointer = activePointers.size > 0) {
    if (mode === 'idle') return;
    const resume = mode === 'settling' ? settleResume : mode === 'starting' ? startupCanResume : true;
    sessionGeneration += 1;
    clearLifecycleTimers();
    rollbackPendingHide();
    candidate = null;
    if (outline) outline.hidden = true;
    if (settlePointer && host) {
      mode = 'settling';
      sessionId = '';
      pressed = null;
      settleResume = resume;
      if (!pointerInteractionDeadline) {
        pointerInteractionDeadline = Date.now() + POINTER_SETTLE_TIMEOUT_MS;
      }
      if (pointerSettleTimer === null) {
        pointerSettleTimer = setTimeout(
          () => {
            pointerSettleTimer = null;
            clearTrackedPointers();
            completePointerSettle();
          },
          Math.max(0, pointerInteractionDeadline - Date.now())
        );
      }
      return;
    }
    removeUi();
    finishIdle(resume);
    void reason;
  }

  function hitTest(x, y) {
    if (!host || !shield) return null;
    host.style.setProperty('pointer-events', 'none', 'important');
    let hit;
    try {
      hit = document.elementsFromPoint(x, y).find((el) => el !== host) || null;
      for (let depth = 0; depth < 8 && hit?.shadowRoot; depth += 1) {
        const root = hit.shadowRoot;
        const inner = root.elementFromPoint?.(x, y);
        if (!inner || inner === hit || inner.getRootNode?.() !== root) break;
        hit = inner;
      }
    } catch {
      return null;
    } finally {
      host.style.setProperty('pointer-events', 'auto', 'important');
    }
    return hit;
  }

  function resolveElement(hit, scan = null) {
    return BYEBAR.lib.pick.resolvePickCandidate(hit, {
      getStyle: getComputedStyle,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentRoot: document,
      pickerHost: host,
      fullscreenElement: document.fullscreenElement,
      isHidden: BYEBAR.visibility.isHidden,
      getShadowRoot: (el) => BYEBAR.shadow.openOrClosedRoot(el),
      canInspectClosedRoots: (el) => BYEBAR.shadow.canInspectClosedRoots(el),
      scan
    });
  }

  function targetRemainsSafe(target) {
    return BYEBAR.lib.pick.isSafePickTarget(target, {
      documentRoot: document,
      pickerHost: host,
      fullscreenElement: document.fullscreenElement,
      getShadowRoot: (el) => BYEBAR.shadow.openOrClosedRoot(el),
      canInspectClosedRoots: (el) => BYEBAR.shadow.canInspectClosedRoots(el)
    });
  }

  function resolveAt(x, y) {
    return resolveElement(hitTest(x, y));
  }

  function renderCandidate(next) {
    candidate = next;
    if (hideTargetButton) hideTargetButton.disabled = !next;
    if (!outline || !next) {
      if (outline) outline.hidden = true;
      return;
    }
    const left = Math.max(0, next.rect.left);
    const top = Math.max(0, next.rect.top);
    const right = Math.min(window.innerWidth, next.rect.right ?? next.rect.left + next.rect.width);
    const bottom = Math.min(window.innerHeight, next.rect.bottom ?? next.rect.top + next.rect.height);
    outline.style.left = `${left}px`;
    outline.style.top = `${top}px`;
    outline.style.width = `${Math.max(0, right - left)}px`;
    outline.style.height = `${Math.max(0, bottom - top)}px`;
    outline.hidden = false;
  }

  function collectKeyboardCandidates() {
    const candidates = [];
    const targets = new Set();
    const scan = { remaining: MAX_KEYBOARD_SCAN_ELEMENTS, landmarkCache: new WeakMap() };
    const add = (seed) => {
      const resolved = resolveElement(seed, scan);
      if (!resolved || targets.has(resolved.target)) return;
      targets.add(resolved.target);
      candidates.push(resolved);
    };
    const all = BYEBAR.shadow?.collectElements?.(document, MAX_KEYBOARD_SCAN_ELEMENTS) || [];
    for (const element of all) {
      try {
        if (element.matches?.(KEYBOARD_SEED_SELECTOR)) add(element);
      } catch {
        /* Ignore selector support gaps in older engines. */
      }
      const style = getComputedStyle(element);
      if (
        style.position === 'fixed' ||
        style.position === 'sticky' ||
        element.tagName === 'DIALOG' ||
        hasRole(element, 'dialog') ||
        element.getAttribute?.('aria-modal') === 'true'
      ) {
        add(element);
      }
    }
    return candidates.sort(
      (left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left
    );
  }

  function cycleKeyboardCandidate(direction) {
    const candidates = collectKeyboardCandidates();
    keyboardCandidateCount = candidates.length;
    if (candidates.length === 0) {
      keyboardCandidateIndex = -1;
      renderCandidate(null);
      if (coachCopy) coachCopy.textContent = 'No safe keyboard target found. Point to an item or cancel.';
      return;
    }
    const currentIndex = candidates.findIndex((entry) => entry.target === candidate?.target);
    const base = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
    keyboardCandidateIndex = (base + direction + candidates.length) % candidates.length;
    renderCandidate(candidates[keyboardCandidateIndex]);
    if (coachCopy) {
      coachCopy.textContent = `Target ${keyboardCandidateIndex + 1} of ${keyboardCandidateCount}. Enter hides; Esc cancels.`;
    }
  }

  function scheduleCandidate(x, y) {
    if (keyboardCandidateIndex >= 0) {
      keyboardCandidateIndex = -1;
      keyboardCandidateCount = 0;
      if (coachCopy) coachCopy.textContent = 'Point and click, or choose Next target. Esc cancels.';
    }
    lastPointerPoint = { x, y };
    if (highlightFrame !== null) cancelAnimationFrame(highlightFrame);
    highlightFrame = requestAnimationFrame(() => {
      highlightFrame = null;
      if (mode === 'active') renderCandidate(resolveAt(x, y));
    });
  }

  function blocksScroll(target, rect) {
    const style = getComputedStyle(target);
    return Boolean(
      target.tagName === 'DIALOG' ||
      hasRole(target, 'dialog') ||
      target.getAttribute?.('aria-modal') === 'true' ||
      (style.position === 'fixed' &&
        rect.width >= window.innerWidth * 0.75 &&
        rect.height >= window.innerHeight * 0.6)
    );
  }

  function resolveCommitCandidate(next, point) {
    if (point) return resolveAt(point.x, point.y);
    const refreshed = resolveElement(next.target);
    if (!refreshed) return null;
    const left = Math.max(0, refreshed.rect.left);
    const top = Math.max(0, refreshed.rect.top);
    const right = Math.min(
      window.innerWidth,
      refreshed.rect.right ?? refreshed.rect.left + refreshed.rect.width
    );
    const bottom = Math.min(
      window.innerHeight,
      refreshed.rect.bottom ?? refreshed.rect.top + refreshed.rect.height
    );
    if (right <= left || bottom <= top) return null;
    const hit = hitTest(left + (right - left) / 2, top + (bottom - top) / 2);
    return isWithinTarget(hit, refreshed.target) ? refreshed : resolveElement(hit);
  }

  function restorePickerAfterFailedHide() {
    const failed = rollbackPendingHide();
    if (!failed || mode !== 'verifying') return;
    mode = 'active';
    if (coach) coach.classList.remove('success');
    if (coachControls) coachControls.hidden = false;
    if (coachTitle) coachTitle.textContent = 'Pick to hide';
    if (coachCopy) coachCopy.textContent = 'That item would not stay hidden. Pick another.';
    renderCandidate(failed.target.isConnected ? resolveElement(failed.target) : null);
    coach?.focus({ preventScroll: true });
  }

  function finishSuccessfulHide() {
    BYEBAR.visibility.syncScrollLock();
    clearLifecycleTimers();
    mode = 'settling';
    settleResume = false;
    sessionId = '';
    renderCandidate(null);
    if (coach) coach.classList.add('success');
    if (coachControls) coachControls.hidden = true;
    if (coachTitle) coachTitle.textContent = 'Item hidden';
    if (coachCopy) coachCopy.textContent = 'Reopen ByeBar to undo.';
    settleTimer = setTimeout(() => {
      if (host) host.style.setProperty('pointer-events', 'none', 'important');
      if (shield) shield.style.pointerEvents = 'none';
      finishIdle(false);
      noticeTimer = setTimeout(() => {
        removeUi();
        restorePageFocus();
      }, SUCCESS_NOTICE_MS);
    }, CLICK_TAIL_MS);
  }

  function finalizePendingHide(expected) {
    hideSettleTimer = null;
    if (pendingHide !== expected || mode !== 'verifying') return;
    const pageIsStable = () =>
      routeIsCurrent() &&
      document.visibilityState !== 'hidden' &&
      host?.isConnected &&
      !activeTopLayerError() &&
      shieldCoversViewport();
    const hideIsValid = () =>
      pendingHide === expected &&
      mode === 'verifying' &&
      BYEBAR.engine.siteEnabled() &&
      pageIsStable() &&
      BYEBAR.visibility.isActionRetained(expected.action.id) &&
      targetRemainsSafe(expected.target);
    const rejectHide = () => {
      if (pendingHide !== expected || mode !== 'verifying') return;
      if (!BYEBAR.engine.siteEnabled()) stop('paused');
      else if (!pageIsStable()) stop('page-changed');
      else restorePickerAfterFailedHide();
    };

    if (!hideIsValid()) {
      rejectHide();
      return;
    }
    restorePageFocus(true);
    if (!hideIsValid() || !BYEBAR.actions.commit(expected.action, hideIsValid)) {
      rejectHide();
      return;
    }
    pendingHide = null;
    finishSuccessfulHide();
  }

  function commitCandidate(next, point = lastPointerPoint) {
    if (mode !== 'active' || !next?.target?.isConnected) return false;
    if (!BYEBAR.engine.siteEnabled()) {
      stop('paused');
      return false;
    }
    if (!routeIsCurrent()) {
      stop('page-changed');
      return false;
    }
    if (activeTopLayerError() || (point ? !shieldOwnsPoint(point.x, point.y) : !shieldCoversViewport())) {
      stop('top-layer-changed');
      return false;
    }
    const current = resolveCommitCandidate(next, point);
    if (!current || current.target !== next.target) {
      renderCandidate(current);
      if (coachCopy) coachCopy.textContent = 'That item changed. Pick another.';
      return false;
    }
    next = current;
    if (!BYEBAR.engine.siteEnabled()) {
      stop('paused');
      return false;
    }
    if (!routeIsCurrent()) {
      stop('page-changed');
      return false;
    }
    const action = BYEBAR.actions.begin({
      feature: 'manualHide',
      rule: 'manual-pick',
      operation: 'hide',
      reason: 'user-picked'
    });
    hiddenFocusTarget = next.target;
    if (
      !BYEBAR.actions.hide(action, next.target, 'manual', {
        blocksScroll: blocksScroll(next.target, next.rect),
        userInitiated: true,
        trackCopies: true
      })
    ) {
      hiddenFocusTarget = null;
      renderCandidate(null);
      if (coachCopy) coachCopy.textContent = 'That item changed. Pick another.';
      return false;
    }
    mode = 'verifying';
    pendingHide = { action, target: next.target };
    renderCandidate(null);
    if (coachControls) coachControls.hidden = true;
    if (coachTitle) coachTitle.textContent = 'Checking item';
    if (coachCopy) coachCopy.textContent = 'Confirming that the page keeps it hidden.';
    const expected = pendingHide;
    hideSettleTimer = setTimeout(() => finalizePendingHide(expected), HIDE_SETTLE_MS);
    return true;
  }

  function suppress(event, preventDefault = true) {
    if (preventDefault && event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }

  function validPrimaryPointer(event) {
    return Boolean(
      event.isTrusted &&
      event.isPrimary !== false &&
      event.button === 0 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    );
  }

  function pickerControls() {
    return [previousTargetButton, nextTargetButton, hideTargetButton, cancelButton].filter(Boolean);
  }

  function controlAtPoint(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return (
      pickerControls().find((control) => {
        const rect = control.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      }) || null
    );
  }

  function controlForEvent(event) {
    const pointed = controlAtPoint(event.clientX, event.clientY);
    if (pointed) return pointed;
    const active = pickerRoot?.activeElement;
    return pickerControls().includes(active) ? active : null;
  }

  function clearControlClickDedupe() {
    clearTimeout(controlClickTimer);
    controlClickTimer = null;
    pendingControlClicks.clear();
  }

  function suppressNextControlClick(control) {
    pendingControlClicks.set(control, (pendingControlClicks.get(control) || 0) + 1);
    clearTimeout(controlClickTimer);
    controlClickTimer = setTimeout(clearControlClickDedupe, CONTROL_CLICK_DEDUPE_MS);
  }

  function consumesControlClick(control) {
    const count = pendingControlClicks.get(control) || 0;
    if (count === 0) return false;
    if (count === 1) pendingControlClicks.delete(control);
    else pendingControlClicks.set(control, count - 1);
    if (pendingControlClicks.size === 0) {
      clearTimeout(controlClickTimer);
      controlClickTimer = null;
    }
    return true;
  }

  function activateControl(control) {
    if (!control || control.disabled || mode !== 'active') return;
    const action = control.dataset.action;
    if (action === 'previous') cycleKeyboardCandidate(-1);
    else if (action === 'next') cycleKeyboardCandidate(1);
    else if (action === 'hide' && candidate) commitCandidate(candidate, null);
    else if (action === 'cancel') stop('coach-cancel');
  }

  function handlePointer(event) {
    if (!capturesInput()) return;
    if (mode === 'settling') {
      suppress(event);
      if (!event.isTrusted) return;
      if (
        event.type === 'pointerup' ||
        event.type === 'pointercancel' ||
        event.type === 'lostpointercapture'
      ) {
        releasePointer(event.pointerId);
        if (activePointers.size === 0) completePointerSettle();
      }
      return;
    }
    if (mode === 'verifying') {
      suppress(event);
      if (!event.isTrusted) return;
      if (event.type === 'pointerdown') trackPointer(event.pointerId);
      else if (
        event.type === 'pointerup' ||
        event.type === 'pointercancel' ||
        event.type === 'lostpointercapture'
      ) {
        releasePointer(event.pointerId);
      }
      return;
    }
    if (!event.isTrusted) {
      suppress(event);
      return;
    }
    if (controlPress?.pointerId === event.pointerId && event.type !== 'pointerdown') {
      suppress(event);
      if (event.type === 'pointermove') return;
      const press = controlPress;
      controlPress = null;
      if (event.type === 'pointerup') {
        const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8;
        const matches = controlAtPoint(event.clientX, event.clientY) === press.control;
        if (!moved && matches && validPrimaryPointer(event) && press.pointerType !== 'mouse') {
          suppressNextControlClick(press.control);
          activateControl(press.control);
        }
      }
      releasePointer(event.pointerId);
      if (mode === 'settling' && activePointers.size === 0) completePointerSettle();
      return;
    }
    const control = controlAtPoint(event.clientX, event.clientY);
    if (control) {
      suppress(event);
      if (event.type === 'pointerdown') {
        trackPointer(event.pointerId);
        controlPress = validPrimaryPointer(event)
          ? {
              control,
              pointerId: event.pointerId,
              pointerType: event.pointerType,
              x: event.clientX,
              y: event.clientY
            }
          : null;
      } else if (
        event.type === 'pointerup' ||
        event.type === 'pointercancel' ||
        event.type === 'lostpointercapture'
      ) {
        releasePointer(event.pointerId);
        controlPress = null;
        pressed = null;
      }
      return;
    }
    if (event.type === 'pointermove') {
      suppress(event, false);
      scheduleCandidate(event.clientX, event.clientY);
      return;
    }
    suppress(event);
    if (event.type === 'pointerdown') {
      trackPointer(event.pointerId);
      keyboardCandidateIndex = -1;
      keyboardCandidateCount = 0;
      if (!validPrimaryPointer(event)) {
        pressed = null;
        return;
      }
      const next = resolveAt(event.clientX, event.clientY);
      lastPointerPoint = { x: event.clientX, y: event.clientY };
      renderCandidate(next);
      pressed = next
        ? { target: next.target, pointerId: event.pointerId, x: event.clientX, y: event.clientY }
        : null;
      return;
    }
    if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
      releasePointer(event.pointerId);
      if (!pressed || pressed.pointerId === event.pointerId) pressed = null;
      return;
    }
    if (event.type !== 'pointerup') return;
    if (!pressed || !validPrimaryPointer(event)) {
      pressed = null;
      releasePointer(event.pointerId);
      return;
    }
    const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 8;
    const next = moved ? null : resolveAt(event.clientX, event.clientY);
    const matches = next?.target === pressed.target && event.pointerId === pressed.pointerId;
    pressed = null;
    if (matches) commitCandidate(next, { x: event.clientX, y: event.clientY });
    releasePointer(event.pointerId);
    if (mode === 'settling' && activePointers.size === 0) completePointerSettle();
  }

  function handleCompatibilityEvent(event) {
    if (!capturesInput()) return;
    if (mode === 'active' && event.type === 'click' && event.isTrusted) {
      const control = controlForEvent(event);
      if (control) {
        suppress(event);
        if (consumesControlClick(control)) return;
        activateControl(control);
        return;
      }
    }
    suppress(event);
  }

  function handleKeydown(event) {
    if (!capturesInput()) return;
    if (!event.isTrusted || event.isComposing) return suppress(event);
    if (mode === 'verifying' && event.key === 'Escape') {
      suppress(event);
      suppressEscapeKeyup = true;
      stop('escape');
      return;
    }
    if (mode !== 'active') return suppress(event);
    if (event.key === 'Escape') {
      suppress(event);
      suppressEscapeKeyup = true;
      stop('escape');
      return;
    }
    const activeControl = pickerControls().includes(pickerRoot?.activeElement)
      ? pickerRoot.activeElement
      : null;
    if ((event.key === 'Enter' || event.key === ' ') && activeControl) {
      suppress(event);
      activateControl(activeControl);
    } else if (
      event.key === 'Tab' ||
      event.key === 'ArrowRight' ||
      event.key === 'ArrowDown' ||
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowUp'
    ) {
      suppress(event);
      const backward = event.shiftKey || event.key === 'ArrowLeft' || event.key === 'ArrowUp';
      cycleKeyboardCandidate(backward ? -1 : 1);
    } else if ((event.key === 'Enter' || event.key === ' ') && candidate) {
      suppress(event);
      commitCandidate(candidate, keyboardCandidateIndex >= 0 ? null : lastPointerPoint);
    } else suppress(event);
  }

  function handleKeyup(event) {
    if (event.isTrusted && event.key === 'Escape' && suppressEscapeKeyup) {
      suppressEscapeKeyup = false;
      suppress(event);
    } else if (capturesInput()) suppress(event);
  }

  function handleFocusEvent(event) {
    if (capturesInput()) suppress(event, false);
    else if (mode === 'idle' && event.type === 'focus' && event.target === window && returnFocus) {
      requestAnimationFrame(restorePageFocus);
    }
  }

  async function loadSettingsWithTimeout() {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('Settings load timed out');
        error.code = 'settings-timeout';
        reject(error);
      }, START_TIMEOUT_MS);
    });
    try {
      return await Promise.race([BYEBAR.engine.loadSettings(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function start(requestedSessionId) {
    if (!SESSION_ID_RE.test(requestedSessionId || '')) {
      return { ok: false, error: { code: 'invalid-picker-session' } };
    }
    if (!available()) return { ok: false, error: { code: 'picker-unavailable' } };
    if (isSessionActive()) {
      return sessionId === requestedSessionId
        ? { ok: true }
        : { ok: false, error: { code: 'picker-active' } };
    }
    if (mode === 'settling') return { ok: false, error: { code: 'picker-busy' } };
    if (window.top !== window) return { ok: false, error: { code: 'not-top-frame' } };
    if (document.visibilityState === 'hidden') return { ok: false, error: { code: 'page-hidden' } };
    const topLayerError = activeTopLayerError();
    if (topLayerError) return { ok: false, error: { code: topLayerError } };

    returnFocus = deepActiveElement();
    hiddenFocusTarget = null;
    removeUi();
    mode = 'starting';
    startupCanResume = false;
    sessionId = requestedSessionId;
    startedRoute = captureRouteIdentity();
    const generation = ++sessionGeneration;
    try {
      await loadSettingsWithTimeout();
      if (generation === sessionGeneration && mode === 'starting') startupCanResume = true;
    } catch (error) {
      if (generation === sessionGeneration && mode === 'starting')
        stop(error?.code || 'settings-unavailable');
      return { ok: false, error: { code: error?.code || 'settings-unavailable' } };
    }
    if (generation !== sessionGeneration || mode !== 'starting' || sessionId !== requestedSessionId) {
      return { ok: false, error: { code: 'picker-cancelled' } };
    }
    if (!routeIsCurrent() || document.visibilityState === 'hidden') {
      stop('page-changed');
      return { ok: false, error: { code: 'page-changed' } };
    }
    if (!BYEBAR.engine.siteEnabled()) {
      stop('paused');
      return { ok: false, error: { code: 'paused' } };
    }
    const currentTopLayerError = activeTopLayerError();
    if (currentTopLayerError) {
      stop(currentTopLayerError);
      return { ok: false, error: { code: currentTopLayerError } };
    }
    try {
      createUi();
    } catch {
      stop('picker-unavailable');
      return { ok: false, error: { code: 'picker-unavailable' } };
    }
    if (!shieldCoversViewport()) {
      stop('top-layer-active');
      return { ok: false, error: { code: 'top-layer-active' } };
    }
    mode = 'active';
    coach?.focus({ preventScroll: true });
    sessionTimer = setTimeout(() => stop('timeout'), SESSION_TIMEOUT_MS);
    routeTimer = setInterval(() => {
      if (!host?.isConnected || !routeIsCurrent() || activeTopLayerError() || !shieldCoversViewport()) {
        stop('page-changed');
      }
    }, 500);
    return { ok: true };
  }

  function cancel(requestedSessionId, reason = 'popup') {
    if (!isSessionActive()) return { ok: true };
    if (requestedSessionId !== sessionId) {
      return { ok: false, error: { code: 'stale-picker-session' } };
    }
    stop(reason);
    return { ok: true };
  }

  function onEffectiveSettingsChanged(effective) {
    if (effective?.enabled === false && isSessionActive()) stop('paused');
  }

  function onRouteChanged() {
    navigationGeneration += 1;
    if (mode !== 'idle') stop('page-changed');
  }

  window.navigation?.addEventListener?.('currententrychange', onRouteChanged);

  window.addEventListener('pointermove', handlePointer, eventOptions);
  window.addEventListener('pointerdown', handlePointer, eventOptions);
  window.addEventListener('pointerup', handlePointer, eventOptions);
  window.addEventListener('pointercancel', handlePointer, eventOptions);
  window.addEventListener('lostpointercapture', handlePointer, eventOptions);
  [
    'pointerover',
    'pointerout',
    'pointerenter',
    'pointerleave',
    'mousedown',
    'mouseup',
    'mousemove',
    'mouseover',
    'mouseout',
    'mouseenter',
    'mouseleave',
    'click',
    'dblclick',
    'auxclick',
    'contextmenu',
    'touchstart',
    'touchmove',
    'touchend',
    'touchcancel',
    'dragstart',
    'drop',
    'selectstart',
    'wheel',
    'keypress',
    'beforeinput',
    'input',
    'compositionstart',
    'compositionupdate',
    'compositionend',
    'copy',
    'cut',
    'paste'
  ].forEach((type) => window.addEventListener(type, handleCompatibilityEvent, eventOptions));
  window.addEventListener('keydown', handleKeydown, { capture: true });
  window.addEventListener('keyup', handleKeyup, { capture: true });
  ['focus', 'blur', 'focusin', 'focusout'].forEach((type) => {
    window.addEventListener(type, handleFocusEvent, { capture: true });
  });
  window.addEventListener(
    'scroll',
    () => {
      if (mode === 'active' && candidate?.target?.isConnected) {
        renderCandidate({ target: candidate.target, rect: candidate.target.getBoundingClientRect() });
      }
    },
    { capture: true, passive: true }
  );
  window.addEventListener(
    'resize',
    () => {
      if (mode === 'active' && candidate?.target?.isConnected) {
        renderCandidate({ target: candidate.target, rect: candidate.target.getBoundingClientRect() });
      }
    },
    { passive: true }
  );
  window.addEventListener('pagehide', () => stop('pagehide'));
  window.addEventListener('hashchange', () => stop('page-changed'));
  window.addEventListener('popstate', () => stop('page-changed'));
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) stop('fullscreen-active');
  });
  window.addEventListener('blur', () => {
    clearTrackedPointers();
    if (mode === 'settling') completePointerSettle();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stop('page-hidden');
  });

  BYEBAR.picker = {
    available,
    start,
    cancel,
    state,
    blocksAutomation,
    onEffectiveSettingsChanged
  };
})();
