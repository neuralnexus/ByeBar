/**
 * ByeBar entry point.
 */
(() => {
  if (window.__byeBarLoaded) return;
  window.__byeBarLoaded = true;

  const { engine, cookies } = window.ByeBar;

  const runCookiePass = () => {
    engine.nukeAll(document);
    cookies.decline(document);
    cookies.removeBanners?.(document);
  };

  const boot = () => {
    engine.loadSettings().then(runCookiePass);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener('load', runCookiePass, { once: true });

  // TrustArc/CCPA banners (e.g. ServiceNow) inject opt-out controls after async copy loads.
  [500, 1500, 4000, 8000].forEach((ms) => {
    setTimeout(runCookiePass, ms);
  });
})();