if (typeof importScripts === 'function') {
  importScripts('../shared/runtime.generated.js', '../shared/browser.js');
}

const BYEBAR = self.ByeBar;
const { api, storageGet, storageSet, localGet, localSet } = BYEBAR.browser;
const SETTINGS = BYEBAR.settings;
const DEFAULTS = SETTINGS.DEFAULT_SETTINGS;
const DEBUG_KEY = 'byebar.debug';
const PROTOCOL = BYEBAR.lib.constants.MESSAGE_PROTOCOL_VERSION;

let mutationQueue = Promise.resolve();

function enqueue(operation) {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.catch(() => {});
  return result;
}

function responseError(code, message) {
  return { ok: false, error: { code, message } };
}

function operationalErrorCode(error) {
  if (
    error?.code === 'quota-exceeded' ||
    error?.name === 'QuotaExceededError' ||
    /quota|MAX_(?:WRITE|ITEMS)|rate limit/i.test(error?.message || '')
  ) {
    return 'quota-exceeded';
  }
  return 'storage-unavailable';
}

async function debugEnabled() {
  const stored = await localGet({ [DEBUG_KEY]: { schemaVersion: 1, enabled: false } });
  return Boolean(stored?.[DEBUG_KEY]?.enabled);
}

async function buildState(settings, host = '', knownDebugEnabled) {
  const site = SETTINGS.resolveSettingsForHost(settings, host);
  return {
    schemaVersion: settings.settingsSchemaVersion,
    global: Object.fromEntries(SETTINGS.GLOBAL_BOOLEAN_KEYS.map((key) => [key, settings[key]])),
    site,
    debugEnabled: knownDebugEnabled ?? (await debugEnabled())
  };
}

async function readSettings() {
  return SETTINGS.normalizeSettings(await storageGet(DEFAULTS));
}

async function writeSettings(settings) {
  if (settings.settingsSchemaVersion > SETTINGS.SETTINGS_SCHEMA_VERSION) {
    const error = new Error('Settings were created by a newer ByeBar version');
    error.code = 'unsupported-schema';
    throw error;
  }
  const normalized = SETTINGS.normalizeSettings(settings);
  await storageSet(normalized);
  return normalized;
}

async function initialize() {
  const settings = await readSettings();
  if (settings.settingsSchemaVersion > SETTINGS.SETTINGS_SCHEMA_VERSION) return;
  await writeSettings(settings);
}

api.runtime.onInstalled.addListener(() => {
  void enqueue(() => initialize()).catch(() => {});
});

async function handleMessage(message) {
  if (message?.protocol !== PROTOCOL) return responseError('protocol-mismatch', 'Unsupported protocol');

  if (message.type === 'byebar.settings.get') {
    const settings = await readSettings();
    return { ok: true, state: await buildState(settings, message.host || '') };
  }

  if (message.type === 'byebar.settings.update') {
    return enqueue(async () => {
      const current = await readSettings();
      let next;
      try {
        next = SETTINGS.updateSetting(current, {
          scope: message.scope,
          host: message.host,
          key: message.key,
          value: message.value
        });
      } catch (error) {
        return responseError(error.code || 'invalid-setting', error.message);
      }
      if (current.settingsSchemaVersion > SETTINGS.SETTINGS_SCHEMA_VERSION) {
        return responseError('unsupported-schema', 'Settings were created by a newer ByeBar version');
      }
      const currentDebugEnabled = await debugEnabled();
      const saved = await writeSettings(next);
      return { ok: true, state: await buildState(saved, message.host || '', currentDebugEnabled) };
    });
  }

  if (message.type === 'byebar.settings.clearSite') {
    return enqueue(async () => {
      const current = await readSettings();
      let next;
      try {
        next = SETTINGS.clearSiteOverrides(current, message.host);
      } catch (error) {
        return responseError(error.code || 'invalid-host', error.message);
      }
      if (current.settingsSchemaVersion > SETTINGS.SETTINGS_SCHEMA_VERSION) {
        return responseError('unsupported-schema', 'Settings were created by a newer ByeBar version');
      }
      const currentDebugEnabled = await debugEnabled();
      const saved = await writeSettings(next);
      return { ok: true, state: await buildState(saved, message.host, currentDebugEnabled) };
    });
  }

  if (message.type === 'byebar.debug.set') {
    if (typeof message.enabled !== 'boolean')
      return responseError('invalid-setting', 'Debug value must be boolean');
    const settings = await readSettings();
    await localSet({ [DEBUG_KEY]: { schemaVersion: 1, enabled: message.enabled } });
    return { ok: true, state: await buildState(settings, message.host || '', message.enabled) };
  }

  return responseError('unknown-message', 'Unknown request');
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type?.startsWith?.('byebar.')) return;
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse(responseError(operationalErrorCode(error), error.message)));
  return true;
});
