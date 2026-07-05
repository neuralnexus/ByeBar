/**
 * ByeBar entry point.
 */
(() => {
  if (window.__byeBarLoaded) return;
  window.__byeBarLoaded = true;

  const { engine, cookies, tos } = window.ByeBar;

  const runPasses = () => {
    engine.nukeAll(document);
    cookies.decline(document);
    cookies.removeBanners?.(document);
    tos?.accept?.(document);
    tos?.removeModals?.(document);
  };

  const boot = () => {
    engine.loadSettings().then(runPasses);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener('load', runPasses, { once: true });

  // TrustArc/CCPA banners (e.g. ServiceNow) and Bloomberg TOS inject after async loads.
  [500, 1500, 4000, 8000].forEach((ms) => {
    setTimeout(runPasses, ms);
  });
})();
