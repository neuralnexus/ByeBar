/**
 * ByeBar terms-of-service modals ; auto-accept, then remove.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const clicked = new WeakSet();
  const removed = new WeakSet();

  function queryAll(selector, root = document) {
    return BYEBAR.shadow?.queryAll(selector, root) || Array.from(root.querySelectorAll(selector));
  }

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function textMatchesAccept(text) {
    const normalized = normalizeText(text);
    if (!normalized || normalized.length > 80) return false;
    return BYEBAR.TOS_ACCEPT_TEXT.some((re) => re.test(normalized));
  }

  function closestTosModal(el) {
    if (!el) return null;
    return (
      BYEBAR.shadow?.closestDeep(el, BYEBAR.TOS_BANNER_ANCESTORS) || el.closest?.(BYEBAR.TOS_BANNER_ANCESTORS)
    );
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
        return false;
      }
    }
  }

  function clickIfAccept(el) {
    if (!el || clicked.has(el)) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;

    const label =
      el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.value || '';

    if (!textMatchesAccept(label)) return false;

    return clickElement(el);
  }

  function removeElement(el) {
    if (!el?.parentNode || removed.has(el)) return;
    removed.add(el);
    try {
      el.setAttribute('data-byebar-hidden', 'true');
      el.remove();
    } catch {
      try {
        el.parentNode.removeChild(el);
      } catch {
        /* ignore */
      }
    }
  }

  function bloombergCookieDomain(hostname) {
    const parts = (hostname || '').split('bloomberg.');
    if (parts.length <= 1) return hostname;
    return `.bloomberg.${parts[1]}`;
  }

  function setBloombergConsentCookie() {
    if (!BYEBAR.isBloomberg?.()) return false;

    const name = 'cmpconsentmodal';
    if (document.cookie.includes(`${name}=consented`)) return true;

    const expires = new Date();
    expires.setTime(expires.getTime() + 864e5 * 365);
    const domain = bloombergCookieDomain(location.hostname);
    document.cookie = `${name}=consented;path=/;domain=${domain};expires=${expires.toUTCString()}`;
    return true;
  }

  function looksLikeTosModal(el) {
    if (!el || el.nodeType !== 1 || removed.has(el)) return false;

    const id = (el.id || '').toLowerCase();
    const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';

    if (id === 'cmp-consent-modal' || id.startsWith('sp_message_container')) return true;
    if (cls.includes('tos-modal') || cls.includes('terms-modal')) return true;

    const text = (el.textContent || '').slice(0, 4000);
    if (text.length < 40) return false;
    if (!/updated our terms|terms of service|arbitration provision|class action waiver/i.test(text)) {
      return false;
    }

    const style = getComputedStyle(el);
    const positioned =
      style.position === 'fixed' ||
      style.position === 'sticky' ||
      style.position === 'absolute' ||
      parseInt(style.zIndex, 10) >= 100;

    if (!positioned) return false;

    const rect = el.getBoundingClientRect();
    return rect.width >= 200 && rect.height >= 80;
  }

  function acceptViaSelectors(root = document) {
    let clickedAny = false;

    for (const selector of BYEBAR.TOS_ACCEPT_SELECTORS) {
      queryAll(selector, root).forEach((el) => {
        if (clickElement(el)) clickedAny = true;
      });
    }

    return clickedAny;
  }

  function acceptViaTextScan(root = document) {
    let clickedAny = false;

    queryAll(
      'button, a[role="button"], input[type="button"], input[type="submit"], [role="button"]',
      root
    ).forEach((el) => {
      if (!closestTosModal(el)) return;
      if (clickIfAccept(el)) clickedAny = true;
    });

    return clickedAny;
  }

  function removeViaSelectors(root = document) {
    let removedAny = false;

    for (const selector of BYEBAR.TOS_HIDE) {
      queryAll(selector, root).forEach((el) => {
        removeElement(el);
        removedAny = true;
      });
    }

    return removedAny;
  }

  function removeViaHeuristic(root = document) {
    let removedAny = false;

    queryAll(
      '#cmp-consent-modal, [id^="sp_message_container"], [role="dialog"], [aria-modal="true"], div, section, aside',
      root
    ).forEach((el) => {
      if (!looksLikeTosModal(el)) return;
      removeElement(el);
      removedAny = true;
    });

    return removedAny;
  }

  function removeModals(root = document) {
    if (!BYEBAR.engine?.settings?.tosAccept) return false;
    if (!BYEBAR.engine?.siteEnabled?.()) return false;

    return removeViaSelectors(root) || removeViaHeuristic(root);
  }

  function unlockPageScroll() {
    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) return;

    for (const el of [html, body]) {
      if (el.style.overflow === 'hidden' || el.style.position === 'fixed') {
        el.style.overflow = '';
        el.style.position = '';
        el.style.top = '';
        el.style.width = '';
      }
    }
  }

  function accept(root = document) {
    if (!BYEBAR.engine?.settings?.tosAccept) return false;
    if (!BYEBAR.engine?.siteEnabled?.()) return false;

    const hasBloombergModal = queryAll('#cmp-consent-modal, #cmp-consent-button', root).length > 0;
    if (hasBloombergModal) setBloombergConsentCookie();

    const clicked = acceptViaSelectors(root) || acceptViaTextScan(root) || hasBloombergModal;

    if (removeModals(root)) unlockPageScroll();
    return clicked;
  }

  BYEBAR.tos = { accept, removeModals };
})();
