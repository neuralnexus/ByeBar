/**
 * ByeBar entry point.
 */
(() => {
  if (window.__byeBarLoaded) return;
  window.__byeBarLoaded = true;

  const { engine, cookies, tos } = window.ByeBar;
  let settingsReady = null;

  const runPasses = () => {
    if (window.ByeBar.picker?.blocksAutomation?.()) return;
    settingsReady ||= Promise.all([window.ByeBar.actions.ready, engine.loadSettings()]);
    void settingsReady
      .then(() => {
        if (window.ByeBar.picker?.blocksAutomation?.()) return;
        engine.nukeAll(document);
        cookies.decline(document);
        tos?.accept?.(document);
      })
      .catch(() => {
        settingsReady = null;
      });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runPasses, { once: true });
  } else {
    runPasses();
  }

  window.addEventListener('load', runPasses, { once: true });

  // TrustArc/CCPA, Bloomberg TOS, and Temu/Shein spinners inject after async loads.
  [500, 1500, 4000, 8000].forEach((ms) => {
    setTimeout(runPasses, ms);
  });
})();
