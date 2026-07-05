/**
 * Cross-browser WebExtension API (Chrome, Firefox, Safari).
 */
(() => {
  const globalScope = typeof globalThis !== 'undefined' ? globalThis : window;
  const api = globalScope.browser || globalScope.chrome;

  if (!api) {
    throw new Error('ByeBar: WebExtension API unavailable');
  }

  function getStorageArea() {
    return api.storage?.sync || api.storage?.local;
  }

  function normalizeStored(stored, defaults) {
    const settingsApi = globalScope.ByeBar?.settings;
    if (settingsApi?.normalizeSettings) {
      return settingsApi.normalizeSettings(stored, defaults ?? settingsApi.DEFAULT_SETTINGS);
    }
    const defs = defaults ?? {};
    return stored && typeof stored === 'object' && !Array.isArray(stored)
      ? { ...defs, ...stored }
      : { ...defs };
  }

  function storageGet(defaults) {
    const area = getStorageArea();
    return new Promise((resolve) => {
      try {
        area.get(defaults, (stored) => {
          if (api.runtime?.lastError) {
            api.storage.local.get(defaults, (localStored) => resolve(normalizeStored(localStored, defaults)));
            return;
          }
          resolve(normalizeStored(stored, defaults));
        });
      } catch {
        resolve(normalizeStored({}, defaults));
      }
    });
  }

  function storageSet(values) {
    const normalized = normalizeStored(values);
    const area = getStorageArea();
    return new Promise((resolve) => {
      area.set(normalized, () => {
        if (api.runtime?.lastError) {
          api.storage.local.set(normalized, resolve);
          return;
        }
        resolve();
      });
    });
  }

  function onStorageChanged(listener) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' || area === 'local') listener(changes, area);
    });
  }

  globalScope.ByeBar = globalScope.ByeBar || {};
  globalScope.ByeBar.browser = {
    api,
    getStorageArea,
    storageGet,
    storageSet,
    onStorageChanged
  };
})();
