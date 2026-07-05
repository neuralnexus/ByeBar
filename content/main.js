/**
 * ByeBar entry point.
 */
(() => {
  if (window.__byeBarLoaded) return;
  window.__byeBarLoaded = true;

  const { engine, cookies, tos, chinaCommerce } = window.ByeBar;

  const runPasses = () => {
    engine.nukeAll(document);
    cookies.decline(document);
    cookies.removeBanners?.(document);
    tos?.accept?.(document);
    tos?.removeModals?.(document);
    chinaCommerce?.nukeSpinners?.(document);
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

  // TrustArc/CCPA, Bloomberg TOS, and Temu/Shein spinners inject after async loads.
  [500, 1500, 4000, 8000].forEach((ms) => {
    setTimeout(runPasses, ms);
  });
})();
