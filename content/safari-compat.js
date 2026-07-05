/**
 * Safari/WebKit selector compatibility for querySelectorAll.
 */
(() => {
  const BYEBAR = (window.ByeBar = window.ByeBar || {});

  function stripCaseInsensitiveFlag(selector) {
    return selector.replace(/\s+i\]/g, ']');
  }

  let caseInsensitiveSupported;
  function supportsCaseInsensitiveSelectors() {
    if (caseInsensitiveSupported !== undefined) return caseInsensitiveSupported;
    try {
      document.querySelector('[class*="byebar-probe" i]');
      caseInsensitiveSupported = true;
    } catch {
      caseInsensitiveSupported = false;
    }
    return caseInsensitiveSupported;
  }

  function normalizeSelector(selector) {
    if (supportsCaseInsensitiveSelectors()) return selector;
    return stripCaseInsensitiveFlag(selector);
  }

  BYEBAR.safari = {
    normalizeSelector,
    stripCaseInsensitiveFlag,
    supportsCaseInsensitiveSelectors
  };
})();
