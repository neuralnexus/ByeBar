/**
 * Stateful browser wrapper around the canonical Substack detector.
 */
(() => {
  const BYEBAR = (globalThis.ByeBar ||= {});
  const detector = BYEBAR.lib.substackDetect;
  let cached = null;

  function detectSubstackPage() {
    if (cached === true) return true;
    const detected = detector.isSubstackSite(location.hostname, {
      html: detector.collectSubstackHtmlSample(document),
      root: document
    });
    if (detected) cached = true;
    return detected;
  }

  function recheckSubstackPage() {
    return detectSubstackPage();
  }

  BYEBAR.substackDetect = {
    ...detector,
    detectSubstackPage,
    recheckSubstackPage
  };
})();
