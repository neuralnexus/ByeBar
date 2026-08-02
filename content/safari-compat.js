/**
 * Cached browser adapter around the canonical Safari selector helpers.
 */
(() => {
  const BYEBAR = (window.ByeBar ||= {});
  const safari = BYEBAR.lib.safari;
  let caseInsensitiveSupported;

  function supportsCaseInsensitiveSelectors() {
    caseInsensitiveSupported ??= safari.isCaseInsensitiveSelectorSupported();
    return caseInsensitiveSupported;
  }

  function normalizeSelector(selector) {
    return supportsCaseInsensitiveSelectors() ? selector : safari.stripCaseInsensitiveFlag(selector);
  }

  BYEBAR.safari = {
    normalizeSelector,
    stripCaseInsensitiveFlag: safari.stripCaseInsensitiveFlag,
    supportsCaseInsensitiveSelectors
  };
})();
