/**
 * One-shot, document-scoped manual picker with isolated page UI.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const SESSION_ID_RE = /^[a-zA-Z0-9-]{1,128}$/;
  const START_TIMEOUT_MS = 5_000;
  const SESSION_TIMEOUT_MS = 60_000;
  const CLICK_TAIL_MS = 500;
  const SUCCESS_NOTICE_MS = 1_800;
  const eventOptions = { capture: true, passive: false };
  const activePointers = new Set();
  let mode = 'idle';
  let sessionId = '';
  let host = null;
  let shield = null;
  let outline = null;
  let coach = null;
  let coachTitle = null;
  let coachCopy = null;
  let candidate = null;
  let pressed = null;
  let highlightFrame = null;
  let sessionTimer = null;
  let routeTimer = null;
  let settleTimer = null;
  let noticeTimer = null;
  let settleResume = true;
  let startedUrl = '';
  let suppressEscapeKeyup = false;
  let sessionGeneration = 0;
  let lastPointerPoint = null;
  let startupCanResume = false;

  function isSessionActive() {
    return mode === 'starting' || mode === 'active';
  }

  function blocksAutomation() {
    return mode !== 'idle';
  }

  function capturesInput() {
    return Boolean(host && (mode === 'active' || mode === 'settling'));
  }

  function state() {
    return {
      active: isSessionActive(),
      busy: blocksAutomation(),
      sessionId: isSessionActive() ? sessionId : ''
    };
  }

  function activeTopLayerError() {
    if (document.fullscreenElement) return 'fullscreen-active';
    if (BYEBAR.shadow?.query?.('dialog:modal', document)) return 'native-modal-active';
    if (BYEBAR.shadow?.query?.(':popover-open', document)) return 'top-layer-active';
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
    const root = host.attachShadow({ mode: 'closed' });
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
        grid-template-columns: auto minmax(0, 1fr) auto;
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
      kbd {
        padding: 2px 5px;
        color: #052f2d;
        font: inherit;
        font-size: 10px;
        font-weight: 800;
        white-space: nowrap;
        background: #f6f3e8;
        border: 1px solid #45d7b5;
        border-radius: 5px;
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
        kbd { color: ButtonText; background: ButtonFace; border-color: ButtonText; }
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
    coachCopy.textContent = 'Point to one interruption, then click. Esc cancels.';
    copy.append(coachTitle, coachCopy);
    const key = document.createElement('kbd');
    key.textContent = 'Esc';
    key.setAttribute('aria-hidden', 'true');
    coach.append(mark, copy, key);
    root.append(style, shield, outline, coach);
    document.documentElement.append(host);
  }

  function clearLifecycleTimers() {
    clearTimeout(sessionTimer);
    clearInterval(routeTimer);
    sessionTimer = null;
    routeTimer = null;
  }

  function removeUi() {
    if (highlightFrame !== null) cancelAnimationFrame(highlightFrame);
    clearTimeout(settleTimer);
    clearTimeout(noticeTimer);
    highlightFrame = null;
    settleTimer = null;
    noticeTimer = null;
    host?.remove();
    host = null;
    shield = null;
    outline = null;
    coach = null;
    coachTitle = null;
    coachCopy = null;
    candidate = null;
    pressed = null;
    lastPointerPoint = null;
    activePointers.clear();
  }

  function finishIdle(resume = true) {
    mode = 'idle';
    sessionId = '';
    pressed = null;
    startupCanResume = false;
    if (resume) BYEBAR.engine?.resumeAutomation?.();
  }

  function completePointerSettle() {
    if (mode !== 'settling' || settleTimer !== null) return;
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
    candidate = null;
    if (outline) outline.hidden = true;
    if (settlePointer && host) {
      mode = 'settling';
      sessionId = '';
      pressed = null;
      settleResume = resume;
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
        const inner = hit.shadowRoot.elementFromPoint?.(x, y);
        if (!inner || inner === hit) break;
        hit = inner;
      }
    } catch {
      return null;
    } finally {
      host.style.setProperty('pointer-events', 'auto', 'important');
    }
    return hit;
  }

  function resolveAt(x, y) {
    const hit = hitTest(x, y);
    return BYEBAR.lib.pick.resolvePickCandidate(hit, {
      getStyle: getComputedStyle,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentRoot: document,
      pickerHost: host,
      fullscreenElement: document.fullscreenElement,
      isHidden: BYEBAR.visibility.isHidden
    });
  }

  function renderCandidate(next) {
    candidate = next;
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

  function scheduleCandidate(x, y) {
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
      target.getAttribute?.('role') === 'dialog' ||
      target.getAttribute?.('aria-modal') === 'true' ||
      (style.position === 'fixed' &&
        rect.width >= window.innerWidth * 0.75 &&
        rect.height >= window.innerHeight * 0.6)
    );
  }

  function commitCandidate(next, point = lastPointerPoint) {
    if (mode !== 'active' || !next?.target?.isConnected || !point) return false;
    if (activeTopLayerError() || !shieldOwnsPoint(point.x, point.y)) {
      stop('top-layer-changed');
      return false;
    }
    const current = resolveAt(point.x, point.y);
    if (!current || current.target !== next.target) {
      renderCandidate(current);
      if (coachCopy) coachCopy.textContent = 'That item changed. Pick another.';
      return false;
    }
    next = current;
    const action = BYEBAR.actions.begin({
      feature: 'manualHide',
      rule: 'manual-pick',
      operation: 'hide',
      reason: 'user-picked'
    });
    if (
      !BYEBAR.actions.hide(action, next.target, 'manual', {
        blocksScroll: blocksScroll(next.target, next.rect),
        userInitiated: true
      }) ||
      !BYEBAR.actions.commit(action)
    ) {
      renderCandidate(null);
      if (coachCopy) coachCopy.textContent = 'That item changed. Pick another.';
      return false;
    }
    BYEBAR.visibility.syncScrollLock();
    clearLifecycleTimers();
    mode = 'settling';
    settleResume = false;
    sessionId = '';
    renderCandidate(null);
    if (coach) coach.classList.add('success');
    if (coachTitle) coachTitle.textContent = 'Item hidden';
    if (coachCopy) coachCopy.textContent = 'Reopen ByeBar to undo.';
    settleTimer = setTimeout(() => {
      if (host) host.style.setProperty('pointer-events', 'none', 'important');
      if (shield) shield.style.pointerEvents = 'none';
      finishIdle(false);
      noticeTimer = setTimeout(removeUi, SUCCESS_NOTICE_MS);
    }, CLICK_TAIL_MS);
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
        activePointers.delete(event.pointerId);
        if (activePointers.size === 0) completePointerSettle();
      }
      return;
    }
    if (!event.isTrusted) {
      suppress(event);
      return;
    }
    if (event.type === 'pointermove') {
      suppress(event, false);
      scheduleCandidate(event.clientX, event.clientY);
      return;
    }
    suppress(event);
    if (event.type === 'pointerdown') {
      activePointers.add(event.pointerId);
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
    if (event.type === 'pointercancel') {
      activePointers.delete(event.pointerId);
      pressed = null;
      return;
    }
    if (event.type !== 'pointerup') return;
    if (!pressed || !validPrimaryPointer(event)) {
      pressed = null;
      activePointers.delete(event.pointerId);
      return;
    }
    const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 8;
    const next = moved ? null : resolveAt(event.clientX, event.clientY);
    const matches = next?.target === pressed.target && event.pointerId === pressed.pointerId;
    pressed = null;
    if (matches) commitCandidate(next, { x: event.clientX, y: event.clientY });
    activePointers.delete(event.pointerId);
    if (mode === 'settling' && activePointers.size === 0) completePointerSettle();
  }

  function handleCompatibilityEvent(event) {
    if (capturesInput()) suppress(event);
  }

  function handleKeydown(event) {
    if (!capturesInput()) return;
    if (mode !== 'active') return suppress(event);
    if (!event.isTrusted || event.isComposing) return suppress(event);
    if (event.key === 'Escape') {
      suppress(event);
      suppressEscapeKeyup = true;
      stop('escape');
    } else if (event.key === 'Enter' && candidate && lastPointerPoint) {
      suppress(event);
      commitCandidate(candidate, lastPointerPoint);
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

    removeUi();
    mode = 'starting';
    startupCanResume = false;
    sessionId = requestedSessionId;
    startedUrl = location.href;
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
    if (location.href !== startedUrl || document.visibilityState === 'hidden') {
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
      if (
        !host?.isConnected ||
        location.href !== startedUrl ||
        activeTopLayerError() ||
        !shieldCoversViewport()
      ) {
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
    if (effective?.enabled === false && mode === 'active') stop('paused');
  }

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
    activePointers.clear();
    if (mode === 'settling') completePointerSettle();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stop('page-hidden');
  });

  BYEBAR.picker = {
    start,
    cancel,
    state,
    blocksAutomation,
    onEffectiveSettingsChanged
  };
})();
