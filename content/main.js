/**
 * ByeBar entry point.
 */
(() => {
  if (window.__byeBarLoaded) return;
  window.__byeBarLoaded = true;

  const { engine, cookies } = window.ByeBar;

  const boot = () => {
    engine.loadSettings().then(() => {
      engine.nukeAll(document);
      cookies.decline(document);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // Re-run after full load for lazy-injected banners.
  window.addEventListener('load', () => {
    engine.nukeAll(document);
    cookies.decline(document);
  }, { once: true });
})();