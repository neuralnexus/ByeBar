if (typeof importScripts === 'function') {
  importScripts('../shared/runtime.generated.js', '../shared/browser.js');
}

const BYEBAR = self.ByeBar;
const { api, storageGet, storageSet, localGet, localSet, tabsQuery, sendTabMessage } = BYEBAR.browser;
const SETTINGS = BYEBAR.settings;
const DEFAULTS = SETTINGS.DEFAULT_SETTINGS;
const DEBUG_KEY = 'byebar.debug';
const PROTOCOL = BYEBAR.lib.constants.MESSAGE_PROTOCOL_VERSION;
const SWEEP_PAGE_COMMAND = 'sweep-page';
const COMMAND_REPEAT_QUIET_MS = 2_000;

let mutationQueue = Promise.resolve();
let commandQuietTimer = null;
const sweepingTabs = new Set();

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

async function resolveCommandTab(commandTab) {
  if (Number.isInteger(commandTab?.id) && commandTab.id >= 0) return commandTab;
  const [tab] = await tabsQuery({ active: true, currentWindow: true });
  return tab;
}

async function sweepActiveTab(commandTab, pendingMutations) {
  const tab = await resolveCommandTab(commandTab);
  if (!Number.isInteger(tab?.id) || tab.id < 0 || sweepingTabs.has(tab.id)) return;
  sweepingTabs.add(tab.id);
  try {
    const state = await sendTabMessage(tab.id, {
      protocol: PROTOCOL,
      type: 'byebar.page.getState'
    });
    if (
      !state?.ok ||
      !state.capabilities?.includes('sweep') ||
      typeof state.documentId !== 'string' ||
      !state.documentId
    ) {
      return;
    }
    await pendingMutations;
    await sendTabMessage(tab.id, {
      protocol: PROTOCOL,
      type: 'byebar.page.sweep',
      documentId: state.documentId
    });
  } finally {
    sweepingTabs.delete(tab.id);
  }
}

function claimSweepCommand() {
  const claimed = commandQuietTimer === null;
  clearTimeout(commandQuietTimer);
  commandQuietTimer = setTimeout(() => {
    commandQuietTimer = null;
  }, COMMAND_REPEAT_QUIET_MS);
  return claimed;
}

api.commands?.onCommand?.addListener((command, tab) => {
  if (command !== SWEEP_PAGE_COMMAND || !claimSweepCommand()) return;
  const pendingMutations = mutationQueue;
  void sweepActiveTab(tab, pendingMutations).catch(() => {});
});

async function handleMessage(message) {
  if (message?.protocol !== PROTOCOL) return responseError('protocol-mismatch', 'Unsupported protocol');

  if (message.type === 'byebar.settings.get') {
    return enqueue(async () => {
      const settings = await readSettings();
      return { ok: true, state: await buildState(settings, message.host || '') };
    });
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
    return enqueue(async () => {
      const settings = await readSettings();
      await localSet({ [DEBUG_KEY]: { schemaVersion: 1, enabled: message.enabled } });
      return { ok: true, state: await buildState(settings, message.host || '', message.enabled) };
    });
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
