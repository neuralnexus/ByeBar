/**
 * Promise-based cross-browser WebExtension adapters.
 */
(() => {
  const globalScope = globalThis;
  const namespaceScope = typeof window === 'undefined' ? globalScope : window;
  const ownNamespace = (scope) => Object.getOwnPropertyDescriptor(scope, 'ByeBar')?.value;
  const BYEBAR =
    ownNamespace(namespaceScope) || (namespaceScope === globalScope ? null : ownNamespace(globalScope)) || {};
  const namespaceDescriptor = {
    configurable: true,
    enumerable: true,
    value: BYEBAR,
    writable: true
  };
  Object.defineProperty(namespaceScope, 'ByeBar', namespaceDescriptor);
  if (namespaceScope !== globalScope) Object.defineProperty(globalScope, 'ByeBar', namespaceDescriptor);
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
  const SYNC_CLEANUP_MESSAGE = 'byebar.storage.cleanupLegacySync';
  let legacyMigrationReady = false;
  let authoritativeMigrationVersion = 0;
  let legacySyncClean = false;
  let isLegacySyncCleanupWriter = false;
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
    const settingsApi = BYEBAR.settings;
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

  function isLocalSettingsAuthoritative(stored) {
    const version = stored?.[MIGRATION_KEY];
    return Number.isInteger(version) && version >= MIGRATION_VERSION;
  }

  function legacySyncCleanupVersion(stored) {
    const version = stored?.[SYNC_CLEANUP_KEY];
    return Number.isInteger(version) ? version : 0;
  }

  function configureLegacySyncCleanupWriter() {
    isLegacySyncCleanupWriter = true;
  }

  async function writeLegacySyncCleanup() {
    const area = getStorageArea();
    const before = await invoke(area, 'get', [[SYNC_CLEANUP_KEY]]);
    if (legacySyncCleanupVersion(before) >= SYNC_CLEANUP_VERSION) return;

    await invoke(api.storage.sync, 'remove', [LEGACY_SYNC_KEYS]);
    const refreshed = await invoke(area, 'get', [[SYNC_CLEANUP_KEY]]);
    const existingVersion = legacySyncCleanupVersion(refreshed);
    const nextVersion = Math.max(existingVersion, SYNC_CLEANUP_VERSION);
    if (existingVersion < nextVersion) {
      await invoke(area, 'set', [{ [SYNC_CLEANUP_KEY]: nextVersion }]);
    }
  }

  async function requestLegacySyncCleanup() {
    const response = await invoke(api.runtime, 'sendMessage', [
      {
        type: SYNC_CLEANUP_MESSAGE,
        protocol: BYEBAR.lib?.constants?.MESSAGE_PROTOCOL_VERSION
      }
    ]);
    if (response?.ok !== true) throw new Error(response?.error?.message || 'Legacy sync cleanup failed');
  }

  async function cleanupLegacySync(localStored = {}) {
    if (legacySyncClean || legacySyncCleanupVersion(localStored) >= SYNC_CLEANUP_VERSION) {
      legacySyncClean = true;
      return true;
    }
    if (cleanupPromise) return cleanupPromise;
    const sync = api.storage?.sync;
    if (!sync || sync === getStorageArea() || !sync.remove) {
      legacySyncClean = true;
      return true;
    }
    cleanupPromise = (async () => {
      try {
        if (isLegacySyncCleanupWriter) await writeLegacySyncCleanup();
        else await requestLegacySyncCleanup();
        legacySyncClean = true;
        return true;
      } catch {
        /* A later read or write retries cleanup without invalidating local settings. */
        return false;
      } finally {
        cleanupPromise = null;
      }
    })();
    return cleanupPromise;
  }

  async function storageGet(defaults) {
    const area = getStorageArea();
    const localStored = await invoke(area, 'get', [null]);
    if (isLocalSettingsAuthoritative(localStored)) {
      authoritativeMigrationVersion = localStored[MIGRATION_KEY];
      legacyMigrationReady = true;
      if (isLegacySyncCleanupWriter) await cleanupLegacySync(localStored);
      else void cleanupLegacySync(localStored);
      return normalizeStored(localStored, defaults);
    }

    const sync = api.storage?.sync;
    if (!sync) {
      legacyMigrationReady = true;
      return normalizeStored(localStored, defaults);
    }
    const legacySync = await invoke(sync, 'get', [null]);
    const refreshedLocal = await invoke(area, 'get', [null]);
    if (isLocalSettingsAuthoritative(refreshedLocal)) {
      authoritativeMigrationVersion = refreshedLocal[MIGRATION_KEY];
      legacyMigrationReady = true;
      if (isLegacySyncCleanupWriter) await cleanupLegacySync(refreshedLocal);
      else void cleanupLegacySync(refreshedLocal);
      return normalizeStored(refreshedLocal, defaults);
    }
    legacyMigrationReady = true;
    return normalizeStored(hasSettings(legacySync) ? legacySync : refreshedLocal, defaults);
  }

  async function storageSet(values) {
    const normalized = normalizeStored(values);
    const area = getStorageArea();
    const migrationVersion = Math.max(MIGRATION_VERSION, authoritativeMigrationVersion);
    const stored = legacyMigrationReady ? { ...normalized, [MIGRATION_KEY]: migrationVersion } : normalized;
    await invoke(area, 'set', [stored]);
    if (legacyMigrationReady) {
      authoritativeMigrationVersion = migrationVersion;
      await cleanupLegacySync(stored);
    }
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

  BYEBAR.browser = {
    api,
    configureLegacySyncCleanupWriter,
    cleanupLegacySync,
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
