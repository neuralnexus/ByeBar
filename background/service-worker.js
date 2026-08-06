if (typeof importScripts === 'function') {
  importScripts('../shared/runtime.generated.js', '../shared/browser.js');
}

const BYEBAR = self.ByeBar;
const {
  api,
  storageGet,
  storageSet,
  localGet,
  localSet,
  tabsQuery,
  sendTabMessage,
  setActionBadgeText,
  configureLegacySyncCleanupWriter,
  cleanupLegacySync
} = BYEBAR.browser;
const SETTINGS = BYEBAR.settings;
const DEFAULTS = SETTINGS.DEFAULT_SETTINGS;
const DEBUG_KEY = 'byebar.debug';
const PROTOCOL = BYEBAR.lib.constants.MESSAGE_PROTOCOL_VERSION;
const SWEEP_PAGE_COMMAND = 'sweep-page';
const COMMAND_REPEAT_QUIET_MS = 2_000;
const SWEEP_BADGE_DURATION_MS = 3_000;
const SWEEP_COUNT_KEYS = ['cookieDeclines', 'dismissActions', 'legalAccepts', 'reversibleHides'];

configureLegacySyncCleanupWriter();

let mutationQueue = Promise.resolve();
const pendingMutationResults = new Set();
let commandQuietTimer = null;
const sweepingTabs = new Set();
const badgeClearTimers = new Map();
const badgeStartupReady = clearExistingSweepBadges();

function enqueue(operation) {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.catch(() => {});
  pendingMutationResults.add(result);
  const untrack = () => pendingMutationResults.delete(result);
  void result.then(untrack, untrack);
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

function cancelBadgeClear(tabId) {
  clearTimeout(badgeClearTimers.get(tabId));
  badgeClearTimers.delete(tabId);
}

async function clearExistingSweepBadges() {
  try {
    const tabs = await tabsQuery({});
    await Promise.all(
      (tabs || [])
        .filter((tab) => Number.isInteger(tab?.id) && tab.id >= 0)
        .map((tab) => setActionBadgeText({ text: '', tabId: tab.id }).catch(() => {}))
    );
  } catch {
    /* A later accepted command still clears its own tab before reporting. */
  }
}

async function clearSweepBadge(tabId) {
  cancelBadgeClear(tabId);
  try {
    await setActionBadgeText({ text: '', tabId });
  } catch {
    /* Badge feedback must never affect the page action. */
  }
}

function sweepBadgeText(response, documentId) {
  const result = response?.sweep?.result;
  const effective = response?.sweep?.effective;
  const counts = result?.counts;
  if (
    response?.ok !== true ||
    response.documentId !== documentId ||
    !Array.isArray(response.capabilities) ||
    !response.capabilities.includes('sweep') ||
    !effective ||
    !Object.hasOwn(effective, 'enabled') ||
    typeof effective.enabled !== 'boolean' ||
    !counts ||
    typeof counts !== 'object' ||
    Array.isArray(counts)
  ) {
    return '';
  }

  const keys = Object.keys(counts).sort();
  if (keys.length !== SWEEP_COUNT_KEYS.length || keys.some((key, index) => key !== SWEEP_COUNT_KEYS[index])) {
    return '';
  }
  let total = 0;
  for (const key of SWEEP_COUNT_KEYS) {
    const count = counts[key];
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(total + count)) return '';
    total += count;
  }
  if (result.outcome !== (total === 0 ? 'no-op' : 'applied')) return '';
  if (!effective.enabled) return total === 0 ? 'OFF' : '';
  return total > 99 ? '99+' : String(total);
}

async function showSweepBadge(tabId, text) {
  cancelBadgeClear(tabId);
  try {
    await setActionBadgeText({ text, tabId });
  } catch {
    return;
  }
  const timer = setTimeout(() => {
    if (badgeClearTimers.get(tabId) !== timer) return;
    badgeClearTimers.delete(tabId);
    void setActionBadgeText({ text: '', tabId }).catch(() => {});
  }, SWEEP_BADGE_DURATION_MS);
  badgeClearTimers.set(tabId, timer);
}

async function sweepActiveTab(commandTab, pendingMutations) {
  const tab = await resolveCommandTab(commandTab);
  if (!Number.isInteger(tab?.id) || tab.id < 0 || sweepingTabs.has(tab.id)) return;
  sweepingTabs.add(tab.id);
  const badgeCleared = badgeStartupReady.then(() => clearSweepBadge(tab.id));
  try {
    const state = await sendTabMessage(tab.id, {
      protocol: PROTOCOL,
      type: 'byebar.page.getState'
    });
    if (
      !state?.ok ||
      !state.capabilities?.includes('sweep') ||
      state.picker?.active === true ||
      state.picker?.busy === true ||
      typeof state.documentId !== 'string' ||
      !state.documentId
    ) {
      return;
    }
    await pendingMutations;
    const response = await sendTabMessage(tab.id, {
      protocol: PROTOCOL,
      type: 'byebar.page.sweep',
      documentId: state.documentId
    });
    const badgeText = sweepBadgeText(response, state.documentId);
    await badgeCleared;
    if (badgeText) await showSweepBadge(tab.id, badgeText);
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
  const pendingMutations = Promise.all([...pendingMutationResults]);
  void sweepActiveTab(tab, pendingMutations).catch(() => {});
});

async function handleMessage(message) {
  if (message?.protocol !== PROTOCOL) return responseError('protocol-mismatch', 'Unsupported protocol');

  if (message.type === 'byebar.storage.cleanupLegacySync') {
    return enqueue(async () => {
      if (!(await cleanupLegacySync())) throw new Error('Legacy sync cleanup failed');
      return { ok: true };
    });
  }

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
