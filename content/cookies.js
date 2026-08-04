/**
 * ByeBar cookie consent ; auto-decline when a reject button is found.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const clicked = new WeakSet();
  const actedBanners = new WeakSet();
  const attempts = new WeakMap();

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

  function hasVisible(selector, root = document) {
    return queryAll(selector, root).some(isVisible);
  }

  function closestBanner(el) {
    if (!el) return null;
    const banner =
      BYEBAR.shadow?.closestDeep(el, BYEBAR.COOKIE_BANNER_ANCESTORS) ||
      el.closest?.(BYEBAR.COOKIE_BANNER_ANCESTORS) ||
      BYEBAR.shadow?.closestDeep(el, '#consent_blackbar, #truste-consent-track, #trustarc-banner-overlay') ||
      el.closest?.('#consent_blackbar, #truste-consent-track, #trustarc-banner-overlay');
    if (banner) {
      const className = typeof banner.className === 'string' ? banner.className : '';
      if (BYEBAR.lib.cookie.isKnownCmpElement(banner.id || '', className)) return banner;
      try {
        const selector =
          BYEBAR.safari?.normalizeSelector?.(BYEBAR.COOKIE_HIDE.join(',')) || BYEBAR.COOKIE_HIDE.join(',');
        if (banner.matches(selector)) return banner;
      } catch {
        return null;
      }
    }

    let candidate = el;
    for (let depth = 0; depth < 8 && candidate; depth += 1) {
      if (candidate.tagName === 'BODY' || candidate.tagName === 'HTML') break;
      const className = typeof candidate.className === 'string' ? candidate.className : '';
      const hint = `${candidate.id || ''} ${className} ${candidate.getAttribute('role') || ''}`;
      const rect = candidate.getBoundingClientRect?.();
      if (
        /cookie|consent|gdpr|cmp|privacy|dialog/i.test(hint) &&
        rect?.width >= 200 &&
        rect?.height >= 40 &&
        BYEBAR.lib.cookie.matchesCookieBannerText(candidate.textContent || '')
      ) {
        return candidate;
      }
      candidate = composedParent(candidate);
    }
    return null;
  }

  function textMatchesDecline(text) {
    return BYEBAR.lib.text.textMatchesDecline(text, BYEBAR.COOKIE_DECLINE_TEXT);
  }

  function clickIfDecline(el) {
    if (!el || clicked.has(el)) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;

    const label =
      el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.value || '';

    if (!textMatchesDecline(label)) return false;

    return clickElement(el);
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

  function recordAttempt(control, banner, meta) {
    actedBanners.add(banner);
    const count = (attempts.get(control) || 0) + 1;
    attempts.set(control, count);
    BYEBAR.actions.recordIrreversible(meta);
    if (count >= 2) return;
    setTimeout(() => {
      if (!banner.isConnected || !isVisible(banner)) return;
      clicked.delete(control);
      actedBanners.delete(banner);
      decline(banner.getRootNode?.() || document);
    }, 2000);
  }

  function hasDidomiBanner(root = document) {
    return hasVisible('[class*="didomi-popup" i], [class*="didomi-consent" i]', root);
  }

  function declineViaDidomiUi(root = document) {
    if (!hasDidomiBanner(root)) return false;

    const continueWithout = queryAll('.didomi-continue-without-agreeing', root);
    for (const el of continueWithout) {
      const banner = closestBanner(el);
      if (
        !banner ||
        actedBanners.has(banner) ||
        BYEBAR.wasUserOpened?.(banner) ||
        !isVisible(banner) ||
        !isVisible(el)
      ) {
        continue;
      }
      if (clickElement(el)) {
        recordAttempt(el, banner, {
          feature: 'cookieDecline',
          rule: 'didomi',
          operation: 'decline',
          reason: 'continue-without-agreeing'
        });
        return true;
      }
    }

    const disagree = queryAll(
      '#didomi-notice-disagree-button, #btn-toggle-disagree, button[onclick*="setUserDisagreeToAll" i], a[href*="setUserDisagreeToAll" i], button[aria-label*="Disagree to all" i], button[aria-label*="Refuser" i]',
      root
    );
    for (const el of disagree) {
      const banner = closestBanner(el);
      if (
        !banner ||
        actedBanners.has(banner) ||
        BYEBAR.wasUserOpened?.(banner) ||
        !isVisible(banner) ||
        !isVisible(el)
      ) {
        continue;
      }
      if (clickElement(el)) {
        recordAttempt(el, banner, {
          feature: 'cookieDecline',
          rule: 'didomi',
          operation: 'decline',
          reason: 'disagree-control'
        });
        return true;
      }
    }

    return false;
  }

  function declineViaSelectors(root = document) {
    for (const el of queryAll(BYEBAR.COOKIE_DECLINE_SELECTORS.join(','), root)) {
      if (!isVisible(el)) continue;
      const banner = closestBanner(el);
      if (!banner || actedBanners.has(banner) || BYEBAR.wasUserOpened?.(banner) || !isVisible(banner)) {
        continue;
      }
      if (clickElement(el)) {
        recordAttempt(el, banner, {
          feature: 'cookieDecline',
          rule: 'known-cmp-control',
          operation: 'decline',
          reason: 'vendor-reject-selector'
        });
        return true;
      }
    }

    return false;
  }

  function declineViaTextScan(root = document) {
    const controls = queryAll(
      'button, a[role="button"], input[type="button"], input[type="submit"], [role="button"]',
      root
    );
    for (const el of controls) {
      if (!isVisible(el)) continue;
      const banner = closestBanner(el);
      if (!banner || actedBanners.has(banner) || BYEBAR.wasUserOpened?.(banner) || !isVisible(banner)) {
        continue;
      }
      if (clickIfDecline(el)) {
        recordAttempt(el, banner, {
          feature: 'cookieDecline',
          rule: 'confirmed-cmp-text',
          operation: 'decline',
          reason: 'reject-label'
        });
        return true;
      }
    }

    return false;
  }

  function decline(root = document) {
    if (!BYEBAR.engine?.featureEnabled?.('cookieDecline')) return false;

    return declineViaDidomiUi(root) || declineViaSelectors(root) || declineViaTextScan(root);
  }

  BYEBAR.cookies = { decline, closestBanner };
})();
