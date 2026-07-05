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

  function storageGet(defaults) {
    const area = getStorageArea();
    return new Promise((resolve) => {
      try {
        area.get(defaults, (stored) => {
          if (api.runtime?.lastError) {
            api.storage.local.get(defaults, (localStored) => resolve({ ...defaults, ...localStored }));
            return;
          }
          resolve({ ...defaults, ...stored });
        });
      } catch {
        resolve({ ...defaults });
      }
    });
  }

  function storageSet(values) {
    const area = getStorageArea();
    return new Promise((resolve) => {
      area.set(values, () => {
        if (api.runtime?.lastError) {
          api.storage.local.set(values, resolve);
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
