/**
 * Promise-based cross-browser WebExtension adapters.
 */
(() => {
  const globalScope = typeof globalThis !== 'undefined' ? globalThis : window;
  const promiseNamespace = globalScope.browser;
  const api = promiseNamespace || globalScope.chrome;
  const SETTINGS_KEYS = [
    'settingsSchemaVersion',
    'enabled',
    'genericBlocking',
    'cookieDecline',
    'tosAccept',
    'siteOverrides',
    'siteFeatureOverrides'
  ];
  const LEGACY_SYNC_KEYS = [...SETTINGS_KEYS, 'locationDecline', 'netsuiteLeadRedirect'];
  const MIGRATION_KEY = 'byebar.localSettingsVersion';
  const MIGRATION_VERSION = 1;
  const SYNC_CLEANUP_KEY = 'byebar.legacySyncCleanupVersion';
  const SYNC_CLEANUP_VERSION = 1;
  let legacyMigrationReady = false;
  let legacySyncClean = false;
  let cleanupPromise = null;

  if (!api) throw new Error('ByeBar: WebExtension API unavailable');

  function invoke(target, method, args = []) {
    if (!target?.[method]) return Promise.reject(new Error(`WebExtension API unavailable: ${method}`));
    if (promiseNamespace) {
      try {
        return Promise.resolve(target[method](...args));
      } catch (error) {
        return Promise.reject(error);
      }
    }

    return new Promise((resolve, reject) => {
      try {
        target[method](...args, (result) => {
          const error = api.runtime?.lastError;
          if (error) reject(new Error(error.message));
          else resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function getStorageArea() {
    return api.storage?.local;
  }

  function normalizeStored(stored, defaults) {
    const settingsApi = globalScope.ByeBar?.settings;
    if (settingsApi?.normalizeSettings) {
      return settingsApi.normalizeSettings(stored, defaults ?? settingsApi.DEFAULT_SETTINGS);
    }
    return stored && typeof stored === 'object' && !Array.isArray(stored)
      ? { ...(defaults || {}), ...stored }
      : { ...(defaults || {}) };
  }

  function hasSettings(stored) {
    return Boolean(stored && SETTINGS_KEYS.some((key) => Object.hasOwn(stored, key)));
  }

  async function cleanupLegacySync(localStored = {}) {
    if (legacySyncClean || localStored?.[SYNC_CLEANUP_KEY] === SYNC_CLEANUP_VERSION) {
      legacySyncClean = true;
      return;
    }
    if (cleanupPromise) return cleanupPromise;
    const sync = api.storage?.sync;
    if (!sync || sync === getStorageArea() || !sync.remove) {
      legacySyncClean = true;
      return;
    }
    cleanupPromise = (async () => {
      try {
        await invoke(sync, 'remove', [LEGACY_SYNC_KEYS]);
        await invoke(getStorageArea(), 'set', [{ [SYNC_CLEANUP_KEY]: SYNC_CLEANUP_VERSION }]);
        legacySyncClean = true;
      } catch {
        /* A later read/write retries cleanup without invalidating local settings. */
      } finally {
        cleanupPromise = null;
      }
    })();
    return cleanupPromise;
  }

  async function storageGet(defaults) {
    const area = getStorageArea();
    const localStored = await invoke(area, 'get', [null]);
    if (localStored?.[MIGRATION_KEY] === MIGRATION_VERSION) {
      legacyMigrationReady = true;
      void cleanupLegacySync(localStored);
      return normalizeStored(localStored, defaults);
    }

    const sync = api.storage?.sync;
    if (!sync) {
      legacyMigrationReady = true;
      return normalizeStored(localStored, defaults);
    }
    const legacySync = await invoke(sync, 'get', [null]);
    const refreshedLocal = await invoke(area, 'get', [null]);
    if (refreshedLocal?.[MIGRATION_KEY] === MIGRATION_VERSION) {
      legacyMigrationReady = true;
      void cleanupLegacySync(refreshedLocal);
      return normalizeStored(refreshedLocal, defaults);
    }
    legacyMigrationReady = true;
    return normalizeStored(hasSettings(legacySync) ? legacySync : refreshedLocal, defaults);
  }

  async function storageSet(values) {
    const normalized = normalizeStored(values);
    const area = getStorageArea();
    const stored = legacyMigrationReady ? { ...normalized, [MIGRATION_KEY]: MIGRATION_VERSION } : normalized;
    await invoke(area, 'set', [stored]);
    if (legacyMigrationReady) await cleanupLegacySync(stored);
  }

  function storageGetRaw(keys = null) {
    return invoke(getStorageArea(), 'get', [keys]);
  }

  function storageSetRaw(values) {
    return invoke(getStorageArea(), 'set', [values]);
  }

  function localGet(keys = null) {
    return invoke(api.storage.local, 'get', [keys]);
  }

  function localSet(values) {
    return invoke(api.storage.local, 'set', [values]);
  }

  function localRemove(keys) {
    return invoke(api.storage.local, 'remove', [keys]);
  }

  function tabsQuery(queryInfo) {
    return invoke(api.tabs, 'query', [queryInfo]);
  }

  function sendRuntimeMessage(message) {
    return invoke(api.runtime, 'sendMessage', [message]);
  }

  function sendTabMessage(tabId, message) {
    return invoke(api.tabs, 'sendMessage', [tabId, message]);
  }

  function setActionBadgeText(details) {
    return invoke(api.action, 'setBadgeText', [details]);
  }

  function onStorageChanged(listener) {
    api.storage.onChanged.addListener((changes, area) => {
      const settingsArea = api.storage?.local ? 'local' : 'sync';
      if (area === settingsArea) listener(changes, area);
    });
  }

  globalScope.ByeBar = globalScope.ByeBar || {};
  globalScope.ByeBar.browser = {
    api,
    getStorageArea,
    storageGet,
    storageSet,
    storageGetRaw,
    storageSetRaw,
    localGet,
    localSet,
    localRemove,
    tabsQuery,
    sendRuntimeMessage,
    sendTabMessage,
    setActionBadgeText,
    onStorageChanged
  };
})();
