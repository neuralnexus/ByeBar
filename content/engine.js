/**
 * Settings-aware overlay engine using the canonical bundled heuristics.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const LIB = BYEBAR.lib;
  const DEFAULTS = BYEBAR.settings.DEFAULT_SETTINGS;
  const { storageGet, onStorageChanged } = BYEBAR.browser;
  const dismissed = new WeakSet();
  const dismissAttempts = new WeakMap();
  const userAllowed = new WeakSet();
  const pendingRoots = new Set();
  let settings = { ...DEFAULTS };
  let resolved = BYEBAR.settings.resolveSettingsForHost(settings, location.hostname);
  let observer = null;
  let shadowScanTimer = null;
  let pending = false;
  let interactionCapture = null;
  const activePointers = new Set();
  const activeKeys = new Set();
  let settingsGeneration = 0;
  let settingsLoaded = false;
  const metrics = { mutationFlushes: 0, mutationRoots: 0 };

  const genericCandidateSelector = ['[role="dialog"]', '[aria-modal="true"]', ...BYEBAR.GENERIC_REMOVE].join(
    ','
  );
  const interactionCandidateSelector = [
    genericCandidateSelector,
    BYEBAR.COOKIE_BANNER_ANCESTORS,
    BYEBAR.TOS_BANNER_ANCESTORS
  ]
    .filter(Boolean)
    .join(',');
  const mutationAncestorSelector = [
    genericCandidateSelector,
    BYEBAR.COOKIE_BANNER_ANCESTORS,
    BYEBAR.TOS_BANNER_ANCESTORS
  ]
    .filter(Boolean)
    .join(',');
  const relevantClassMutation =
    /popup|modal|overlay|backdrop|scrim|newsletter|subscribe|optin|opt-in|discount|coupon|sticky|bottom|cookie|gdpr|consent|onetrust|truste|usercentrics|didomi|cky-|cmp|klaviyo|mailchimp|om-holder|optinmonster|poptin|privy|sumo|lottery|turntable|spin-?wheel|coupon-?spin|lucky-?wheel|fortune-wheel|vue-coupon|_showOn(?:Mobile|Desktop)/i;

  function addInteractionContainers(candidates, element) {
    if (!element) return;
    const enclosing =
      BYEBAR.shadow?.closestDeep?.(element, interactionCandidateSelector) ||
      element.closest?.(interactionCandidateSelector);
    if (enclosing) candidates.add(enclosing);
    const cookieBanner = BYEBAR.cookies?.closestBanner?.(element);
    if (cookieBanner) candidates.add(cookieBanner);
    const tosModal = BYEBAR.tos?.closestModal?.(element);
    if (tosModal) candidates.add(tosModal);
  }

  function allowInteractionCandidate(candidate) {
    if (!candidate || !isVisiblyInteractive(candidate)) return;
    userAllowed.add(candidate);
    const overlay = LIB.overlay.findPromotionalOverlayRoot(candidate, getComputedStyle);
    if (overlay) userAllowed.add(overlay);
  }

  function collectInteractionCandidates(root = document) {
    const candidates = new Set(queryMatches(interactionCandidateSelector, root));
    const controls = queryMatches(
      'button, a[role="button"], input[type="button"], input[type="submit"], [role="button"]',
      root
    );
    if (root?.nodeType === 1 && !controls.includes(root)) controls.unshift(root);
    controls.forEach((element) => addInteractionContainers(candidates, element));
    return candidates;
  }

  function classifyInteractionChanges(capture) {
    const candidates = new Set();
    capture.changed.forEach((root) => {
      const scope = root?.nodeType === 1 || root?.nodeType === 11 ? root : root?.parentElement;
      if (!scope) return;
      collectInteractionCandidates(scope).forEach((candidate) => candidates.add(candidate));
    });
    capture.changed.clear();
    candidates.forEach((candidate) => {
      if (capture.initiallyVisible.has(candidate) || !isVisiblyInteractive(candidate)) return;
      allowInteractionCandidate(candidate);
    });
  }

  function applyInteractionCapture(capture) {
    if (interactionCapture !== capture) return;
    interactionCapture = null;
    capture.observer.disconnect();
    classifyInteractionChanges(capture);
  }

  function beginTrustedInteractionCapture(event) {
    if (!event.isTrusted || !document.documentElement) return;
    if (event.type === 'keydown') {
      if (event.repeat) return;
      activeKeys.add(event.code || event.key);
    } else if (event.type === 'pointerdown') {
      activePointers.add(event.pointerId);
    }
    if (interactionCapture) applyInteractionCapture(interactionCapture);
    const changed = new Set();
    const initiallyVisible = new Set(
      [...collectInteractionCandidates()].filter((candidate) => isVisiblyInteractive(candidate))
    );
    const eventTarget = event.composedPath?.().find((node) => node?.nodeType === 1) || event.target;
    const interactedContainers = new Set();
    addInteractionContainers(interactedContainers, eventTarget);
    interactedContainers.forEach(allowInteractionCandidate);
    const capture = {
      changed,
      initiallyVisible,
      observer: null,
      finishScheduled: false
    };
    capture.observer = new MutationObserver((records) => {
      records.forEach((record) => {
        if (record.type === 'childList') record.addedNodes.forEach((node) => changed.add(node));
        else changed.add(record.target);
      });
      classifyInteractionChanges(capture);
      if (capture.finishScheduled) applyInteractionCapture(capture);
    });
    const observe = (scope) => {
      try {
        capture.observer.observe(scope, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: BYEBAR.shadow?.observedAttributes
        });
      } catch {
        /* ignore roots that cannot be observed */
      }
    };
    if (BYEBAR.shadow?.walkRoots) BYEBAR.shadow.walkRoots(document.documentElement, observe);
    else observe(document.documentElement);
    interactionCapture = capture;
  }

  function finishTrustedInteractionCapture(event) {
    if (!event.isTrusted) return;
    let releasedInput = false;
    if (event.type === 'keyup') {
      activeKeys.delete(event.code || event.key);
      releasedInput = true;
    } else if (event.type === 'pointerup' || event.type === 'pointercancel') {
      activePointers.delete(event.pointerId);
      releasedInput = true;
    } else if (event.type === 'click' && (activePointers.size > 0 || activeKeys.size > 0)) {
      return;
    }
    if (releasedInput && (activePointers.size > 0 || activeKeys.size > 0)) return;
    if (!interactionCapture) beginTrustedInteractionCapture(event);
    const capture = interactionCapture;
    if (!capture || capture.finishScheduled) return;
    capture.finishScheduled = true;
    setTimeout(() => applyInteractionCapture(capture), 0);
  }
  window.addEventListener('pointerdown', beginTrustedInteractionCapture, { capture: true, passive: true });
  window.addEventListener('keydown', beginTrustedInteractionCapture, { capture: true });
  window.addEventListener('pointerup', finishTrustedInteractionCapture, { capture: true, passive: true });
  window.addEventListener('pointercancel', finishTrustedInteractionCapture, {
    capture: true,
    passive: true
  });
  window.addEventListener('keyup', finishTrustedInteractionCapture, { capture: true });
  window.addEventListener('click', finishTrustedInteractionCapture, { capture: true });
  window.addEventListener('blur', () => {
    activePointers.clear();
    activeKeys.clear();
    if (interactionCapture) applyInteractionCapture(interactionCapture);
  });
  BYEBAR.wasUserOpened = (el) => Boolean(el && userAllowed.has(el));

  function hostKey() {
    return LIB.host.hostKey(location.hostname);
  }

  function siteEnabled() {
    return resolved.effective.enabled;
  }

  function featureEnabled(feature) {
    return Boolean(resolved.effective[feature]);
  }

  function queryMatches(selector, root = document) {
    if (!selector || !root) return [];
    const matches = BYEBAR.shadow?.queryAll
      ? BYEBAR.shadow.queryAll(selector, root)
      : Array.from(root.querySelectorAll?.(selector) || []);

    if (root.nodeType === 1) {
      try {
        const normalized = BYEBAR.safari?.normalizeSelector?.(selector) || selector;
        if (root.matches(normalized) && !matches.includes(root)) matches.unshift(root);
      } catch {
        /* ignore unsupported selectors */
      }
    }
    return matches;
  }

  function isModal(el) {
    return (
      el?.tagName === 'DIALOG' ||
      el?.getAttribute?.('role') === 'dialog' ||
      el?.getAttribute?.('aria-modal') === 'true'
    );
  }

  function blocksPageScroll(el) {
    if (isModal(el)) return true;
    const rect = el?.getBoundingClientRect?.();
    return Boolean(rect && rect.width >= window.innerWidth * 0.75 && rect.height >= window.innerHeight * 0.6);
  }

  function pageHasInteractionLock() {
    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) return false;
    const htmlStyle = getComputedStyle(html);
    const bodyStyle = getComputedStyle(body);
    return Boolean(
      htmlStyle.overflow === 'hidden' ||
      bodyStyle.overflow === 'hidden' ||
      bodyStyle.position === 'fixed' ||
      document.querySelector('[inert], body > [aria-hidden="true"]')
    );
  }

  function isVisiblyInteractive(el) {
    let node = el;
    while (node?.nodeType === 1) {
      if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true')
        return false;
      const style = getComputedStyle(node);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number.parseFloat(style.opacity || '1') <= 0.01 ||
        style.pointerEvents === 'none'
      ) {
        return false;
      }
      node = node.parentElement || node.getRootNode?.()?.host || null;
    }
    const rect = el?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  }
  BYEBAR.isVisiblyInteractive = isVisiblyInteractive;

  function isVisibleControl(control) {
    if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true') return false;
    return isVisiblyInteractive(control);
  }

  function tryDismiss(el, meta) {
    if (!el?.querySelectorAll || dismissed.has(el)) return false;
    for (const control of el.querySelectorAll('button, [role="button"]')) {
      const label = LIB.text.normalizeText(
        control.getAttribute('aria-label') ||
          control.getAttribute('title') ||
          control.textContent ||
          control.value ||
          ''
      );
      if (!/^(close|dismiss|no thanks|not now)$/i.test(label) || !isVisibleControl(control)) continue;
      dismissed.add(el);
      try {
        control.click();
        BYEBAR.actions.recordIrreversible({ ...meta, operation: 'dismiss', reason: 'close-control' });
        const attempts = (dismissAttempts.get(el) || 0) + 1;
        dismissAttempts.set(el, attempts);
        if (attempts < 2) {
          setTimeout(() => {
            if (!el.isConnected || !isVisibleControl(el)) return;
            dismissed.delete(el);
            nukeAll(el.getRootNode?.() || document);
          }, 2000);
        }
        return true;
      } catch {
        dismissed.delete(el);
        return false;
      }
    }
    return false;
  }

  function hideOverlay(el, reason, meta, action = null) {
    if (
      !el ||
      dismissed.has(el) ||
      userAllowed.has(el) ||
      BYEBAR.actions.isSuppressed(el) ||
      BYEBAR.visibility.isHidden(el)
    ) {
      return false;
    }
    if (tryDismiss(el, meta)) return false;

    if (el.tagName === 'DIALOG' && el.open && typeof el.close === 'function') {
      dismissed.add(el);
      el.close();
      BYEBAR.actions.recordIrreversible({ ...meta, operation: 'dismiss', reason: 'native-dialog' });
      return false;
    }
    if (isModal(el) || blocksPageScroll(el) || pageHasInteractionLock()) {
      BYEBAR.actions.skip(meta, 'interaction-lock');
      return false;
    }

    const transaction = action || BYEBAR.actions.begin(meta);
    const hidden = BYEBAR.actions.hide(transaction, el, reason);
    if (hidden && !action) BYEBAR.actions.commit(transaction);
    return hidden;
  }

  function hideAssociatedScrims(overlay, reason, meta, action) {
    const selector =
      '[class*="backdrop" i], [class*="scrim" i], [class*="modal-overlay" i], [class*="popup-overlay" i]';
    let branch = overlay;
    let parent = overlay?.parentElement;

    for (let depth = 0; depth < 3 && parent; depth += 1) {
      Array.from(parent.children).forEach((sibling) => {
        if (sibling === branch) return;
        const candidates = [];
        try {
          if (sibling.matches(selector)) candidates.push(sibling);
          sibling.querySelectorAll(selector).forEach((el) => candidates.push(el));
        } catch {
          return;
        }

        candidates.forEach((candidate) => {
          if (BYEBAR.visibility.isHidden(candidate) || LIB.text.normalizeText(candidate.textContent)) return;
          const style = getComputedStyle(candidate);
          const rect = candidate.getBoundingClientRect();
          if (style.position !== 'fixed' && style.position !== 'absolute') return;
          if (rect.width < window.innerWidth * 0.85 || rect.height < window.innerHeight * 0.85) return;
          BYEBAR.actions.hide(action, candidate, reason, { blocksScroll: true });
        });
      });

      branch = parent;
      if (parent.tagName === 'BODY' || parent.tagName === 'HTML') break;
      parent = parent.parentElement;
    }
    return action;
  }

  function nukeSubstackLayers(root = document, onSubstack = BYEBAR.isSubstack()) {
    const meta = {
      feature: 'genericBlocking',
      rule: 'substack-signup',
      operation: 'hide',
      reason: 'confirmed-signup-modal'
    };
    const action = BYEBAR.actions.begin(meta);
    const modalSelector = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      ...BYEBAR.SITE_RULES.substack.remove
    ].join(',');
    let hiddenAny = false;

    queryMatches(modalSelector, root).forEach((el) => {
      let overlay = el;
      if (!LIB.substack.looksLikeSubstackSignupModal(el, onSubstack)) {
        if (!LIB.substack.matchesSubstackSignupText(el.textContent || '', onSubstack)) return;
        overlay = LIB.overlay.findPromotionalOverlayRoot(el, getComputedStyle);
        const style = getComputedStyle(overlay);
        if (style.position !== 'fixed' && style.position !== 'sticky') return;
      }
      if (hideOverlay(overlay, 'substack', meta, action)) hiddenAny = true;
    });

    if (hiddenAny) {
      const scope = root === document ? root : root.parentElement || root;
      const scrimSelector =
        'div[class^="background-"], div[class*=" background-"], div[class^="overlay-"], div[class*=" overlay-"], [class*="modalScrim"], [class*="modal-scrim"], [class*="ModalScrim"], [id^="radix-"][data-state="open"]:not([role="dialog"])';
      queryMatches(scrimSelector, scope).forEach((el) => {
        if (
          LIB.substack.isSubstackModalScrim(el, getComputedStyle, onSubstack, {
            width: window.innerWidth,
            height: window.innerHeight
          })
        ) {
          BYEBAR.actions.hide(action, el, 'substack', { blocksScroll: true });
        }
      });
      BYEBAR.actions.commit(action);
    }
    return hiddenAny;
  }

  function nukeBloombergPromos(root = document) {
    if (!BYEBAR.isBloomberg?.()) return false;
    let hiddenAny = false;
    const seen = new Set();
    const selector =
      '[class*="_showOnMobile"], [class*="_showOnDesktop"], a[href*="/subscriptions"], [role="banner"], div, section';

    queryMatches(selector, root).forEach((el) => {
      if (
        !LIB.bloomberg.looksLikeBloombergPromo(el, getComputedStyle, {
          width: window.innerWidth,
          height: window.innerHeight
        })
      ) {
        return;
      }
      const promoRoot = LIB.bloomberg.findBloombergPromoRoot(el, getComputedStyle);
      if (!promoRoot || seen.has(promoRoot)) return;
      seen.add(promoRoot);
      const meta = {
        feature: 'genericBlocking',
        rule: 'bloomberg-promo',
        operation: 'hide',
        reason: 'positioned-subscription-strip'
      };
      if (hideOverlay(promoRoot, 'bloomberg', meta)) hiddenAny = true;
    });
    return hiddenAny;
  }

  function heuristicScan(root = document) {
    const seen = new Set();
    queryMatches(genericCandidateSelector, root).forEach((candidate) => {
      const overlay = LIB.overlay.findPromotionalOverlayRoot(candidate, getComputedStyle);
      if (!overlay || seen.has(overlay)) return;
      seen.add(overlay);
      if (!isModal(overlay) && overlay.closest?.('header, nav, footer')) return;
      if (
        !LIB.overlay.looksLikePromotionalOverlay(overlay, getComputedStyle, {
          width: window.innerWidth,
          height: window.innerHeight
        })
      ) {
        return;
      }

      const meta = {
        feature: 'genericBlocking',
        rule: 'generic-promotion',
        operation: 'hide',
        reason: 'copy-and-geometry-match'
      };
      const action = BYEBAR.actions.begin(meta);
      if (!hideOverlay(overlay, 'generic', meta, action)) return;
      hideAssociatedScrims(overlay, 'generic', meta, action);
      BYEBAR.actions.commit(action);
    });
  }

  function nukeAll(root = document) {
    if (!siteEnabled()) return;
    if (featureEnabled('genericBlocking')) {
      const onSubstack = BYEBAR.substackDetect?.recheckSubstackPage?.() ?? BYEBAR.isSubstack();
      nukeSubstackLayers(root, onSubstack);
      nukeBloombergPromos(root);
      BYEBAR.chinaCommerce?.nukeSpinners?.(root);
      heuristicScan(root);
    }
    BYEBAR.visibility.syncScrollLock();
  }

  function runRootPasses(root) {
    if (!root || (root !== document && root.isConnected === false)) return;
    BYEBAR.visibility.ensureHidden(root);
    nukeAll(root);
    if (featureEnabled('cookieDecline')) BYEBAR.cookies?.decline?.(root);
    if (featureEnabled('tosAccept')) BYEBAR.tos?.accept?.(root);
  }

  function flushMutations() {
    pending = false;
    const roots = [...pendingRoots];
    pendingRoots.clear();
    metrics.mutationFlushes += 1;
    metrics.mutationRoots += roots.length;
    roots.forEach((root) => {
      BYEBAR.shadow?.watchShadowRoots?.(observer, root, runRootPasses);
      runRootPasses(root);
    });
    BYEBAR.visibility.syncScrollLock();
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver((records) => {
      if (!siteEnabled()) return;
      records.forEach((record) => {
        if (record.type === 'childList') {
          record.addedNodes.forEach((node) => BYEBAR.visibility.ensureHidden(node));
          record.removedNodes.forEach((node) => {
            const destination = node.getRootNode?.();
            if (destination?.nodeType !== 11 || !destination.host) return;
            BYEBAR.shadow?.watchShadowRoots?.(observer, destination, runRootPasses);
            BYEBAR.visibility.ensureHidden(node);
          });
        }
        if (record.type === 'attributes' && record.attributeName === 'style') {
          if (record.target.hasAttribute?.('data-byebar-hidden')) {
            BYEBAR.visibility.ensureHidden(record.target);
            return;
          }
        }
        const root =
          record.target?.nodeType === 1 || record.target?.nodeType === 11
            ? record.target
            : record.target?.parentElement;
        if (!root) return;
        const candidate =
          BYEBAR.shadow?.closestDeep?.(root, mutationAncestorSelector) ||
          root.closest?.(mutationAncestorSelector);
        if (record.type === 'attributes' && record.attributeName === 'class') {
          const currentClass =
            typeof record.target.className === 'string'
              ? record.target.className
              : record.target.className?.baseVal;
          const classSample = `${record.oldValue || ''} ${currentClass || ''}`;
          if (!isModal(record.target) && !candidate && !relevantClassMutation.test(classSample)) {
            return;
          }
        }

        pendingRoots.add(root);
        if (candidate) pendingRoots.add(candidate);
      });

      if (pendingRoots.size > 20) {
        pendingRoots.clear();
        pendingRoots.add(document);
      }
      if (pending || pendingRoots.size === 0) return;
      pending = true;
      requestAnimationFrame(flushMutations);
    });
    BYEBAR.shadow?.watchShadowRoots?.(observer, document.documentElement, runRootPasses);
    shadowScanTimer ||= setInterval(() => {
      BYEBAR.shadow?.watchShadowRoots?.(observer, document.documentElement, runRootPasses);
    }, 10_000);
  }

  function stopObserver() {
    observer?.disconnect();
    observer = null;
    clearInterval(shadowScanTimer);
    shadowScanTimer = null;
    pendingRoots.clear();
    pending = false;
  }

  function clearDisabledFeatures() {
    if (!siteEnabled()) {
      BYEBAR.visibility.restoreAll();
      return;
    }
    if (!featureEnabled('genericBlocking')) {
      ['generic', 'substack', 'bloomberg', 'china-commerce'].forEach((reason) =>
        BYEBAR.visibility.restore(reason)
      );
    }
    if (!featureEnabled('cookieDecline')) BYEBAR.visibility.restore('cookie');
    if (!featureEnabled('tosAccept')) BYEBAR.visibility.restore('tos');
  }

  function applySettings(next) {
    settings = BYEBAR.settings.normalizeSettings(next, DEFAULTS);
    resolved = BYEBAR.settings.resolveSettingsForHost(settings, location.hostname);
    clearDisabledFeatures();

    if (
      !siteEnabled() ||
      (!featureEnabled('genericBlocking') && !featureEnabled('cookieDecline') && !featureEnabled('tosAccept'))
    ) {
      stopObserver();
      return;
    }
    runRootPasses(document);
    startObserver();
  }

  async function withFreshSettings(consume) {
    const generation = settingsGeneration;
    const stored = await storageGet(DEFAULTS);
    if (generation !== settingsGeneration) return withFreshSettings(consume);
    settingsLoaded = true;
    return consume(stored);
  }

  function loadSettings() {
    return withFreshSettings((stored) => {
      applySettings(stored);
      return settings;
    });
  }

  function sweepPage() {
    return withFreshSettings((stored) => {
      const result = BYEBAR.actions.captureSweepResult(() => applySettings(stored));
      return { effective: { ...resolved.effective }, result };
    });
  }

  onStorageChanged((changes) => {
    const relevantKeys = new Set([
      ...BYEBAR.settings.GLOBAL_BOOLEAN_KEYS,
      'settingsSchemaVersion',
      'siteOverrides',
      'siteFeatureOverrides'
    ]);
    if (!Object.keys(changes).some((key) => relevantKeys.has(key))) return;
    settingsGeneration += 1;
    if (!settingsLoaded) return;
    const next = { ...settings };
    for (const [key, change] of Object.entries(changes)) next[key] = change.newValue;
    applySettings(next);
  });

  BYEBAR.engine = {
    loadSettings,
    sweepPage,
    applySettings,
    nukeAll,
    siteEnabled,
    featureEnabled,
    hostKey,
    resetMetrics() {
      metrics.mutationFlushes = 0;
      metrics.mutationRoots = 0;
    },
    get metrics() {
      return { ...metrics };
    },
    get settings() {
      return settings;
    },
    get resolved() {
      return resolved;
    }
  };
})();
