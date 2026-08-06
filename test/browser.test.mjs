import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGE_PROTOCOL_VERSION } from '../lib/constants.mjs';
import { DEFAULT_SETTINGS, normalizeSettings } from '../lib/settings.mjs';

const browserSource = readFileSync(new URL('../shared/browser.js', import.meta.url), 'utf8');
const runtimeSource = readFileSync(new URL('../shared/runtime.generated.js', import.meta.url), 'utf8');

function loadBrowserShim(extensionApi, namespace = 'chrome', cleanupWriter = true) {
  const context = {
    [namespace]: extensionApi,
    ByeBar: {
      lib: { constants: { MESSAGE_PROTOCOL_VERSION } },
      settings: { DEFAULT_SETTINGS, normalizeSettings }
    },
    console
  };
  vm.runInNewContext(browserSource, context);
  if (cleanupWriter) context.ByeBar.browser.configureLegacySyncCleanupWriter();
  return context.ByeBar.browser;
}

function createFirefoxContentContext(pageWindow, browserApi = {}) {
  const contentWindow = Object.create(pageWindow);
  const context = vm.createContext({ window: contentWindow, browser: browserApi, console });
  vm.runInContext('Object.setPrototypeOf(globalThis, window)', context);
  return { contentWindow, context };
}

function loadRuntimeAndBrowser(context) {
  vm.runInContext(runtimeSource, context);
  vm.runInContext(browserSource, context);
}

describe('browser adapters', () => {
  it('shares an isolated window namespace across Firefox content-script realms', () => {
    const pageNamespace = { owner: 'page' };
    const pageWindow = { ByeBar: pageNamespace };
    const browserApi = {};
    const { contentWindow, context } = createFirefoxContentContext(pageWindow, browserApi);

    expect(
      vm.runInContext('globalThis !== window && Object.getPrototypeOf(globalThis) === window', context)
    ).toBe(true);
    vm.runInContext(runtimeSource, context);
    const namespace = contentWindow.ByeBar;
    vm.runInContext(browserSource, context);

    expect(Object.hasOwn(contentWindow, 'ByeBar')).toBe(true);
    expect(vm.runInContext('globalThis.ByeBar === window.ByeBar', context)).toBe(true);
    expect(contentWindow.ByeBar).toBe(namespace);
    expect(namespace.browser.api).toBe(browserApi);
    expect(pageWindow.ByeBar).toBe(pageNamespace);
    expect(pageNamespace).toEqual({ owner: 'page' });
  });

  it('does not invoke inherited Firefox namespace accessors', () => {
    const pageNamespace = { owner: 'page' };
    const get = vi.fn(() => pageNamespace);
    const set = vi.fn();
    const pageWindow = {};
    Object.defineProperty(pageWindow, 'ByeBar', { configurable: true, get, set });
    const browserApi = {};
    const { contentWindow, context } = createFirefoxContentContext(pageWindow, browserApi);

    loadRuntimeAndBrowser(context);

    const namespace = Object.getOwnPropertyDescriptor(contentWindow, 'ByeBar')?.value;
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(Object.hasOwn(contentWindow, 'ByeBar')).toBe(true);
    expect(vm.runInContext("Object.hasOwn(globalThis, 'ByeBar')", context)).toBe(true);
    expect(namespace).not.toBe(pageNamespace);
    expect(namespace.lib).toBeDefined();
    expect(namespace.browser.api).toBe(browserApi);
    expect(pageNamespace).toEqual({ owner: 'page' });
  });

  it('shadows inherited non-writable Firefox namespace properties', () => {
    const pageNamespace = { owner: 'page' };
    const pageWindow = {};
    Object.defineProperty(pageWindow, 'ByeBar', {
      configurable: false,
      value: pageNamespace,
      writable: false
    });
    const browserApi = {};
    const { contentWindow, context } = createFirefoxContentContext(pageWindow, browserApi);

    loadRuntimeAndBrowser(context);

    const descriptor = Object.getOwnPropertyDescriptor(contentWindow, 'ByeBar');
    expect(descriptor).toMatchObject({ configurable: true, enumerable: true, writable: true });
    expect(descriptor.value).not.toBe(pageNamespace);
    expect(descriptor.value.lib).toBeDefined();
    expect(descriptor.value.browser.api).toBe(browserApi);
    expect(Object.getOwnPropertyDescriptor(pageWindow, 'ByeBar')?.value).toBe(pageNamespace);
    expect(pageNamespace).toEqual({ owner: 'page' });
  });

  it.each([
    ['worker', 'globalThis.self = globalThis', 'self'],
    ['popup', 'globalThis.window = globalThis', 'window']
  ])('uses one namespace in %s contexts', (_contextType, setup, scope) => {
    const context = vm.createContext({ browser: {}, console });
    vm.runInContext(setup, context);
    vm.runInContext(runtimeSource, context);
    vm.runInContext(browserSource, context);

    expect(vm.runInContext(`${scope}.ByeBar === globalThis.ByeBar`, context)).toBe(true);
    expect(vm.runInContext('Boolean(globalThis.ByeBar.lib && globalThis.ByeBar.browser)', context)).toBe(
      true
    );
  });

  it('supports callback-based Chrome APIs', async () => {
    const setBadgeText = vi.fn((_details, callback) => callback());
    const stored = {
      settingsSchemaVersion: 1,
      enabled: false,
      tosAccept: false,
      siteOverrides: { 'legacy.example': false }
    };
    const localStored = { enabled: true, siteOverrides: { 'stale.example': true } };
    const chrome = {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          callback({ ok: true, message });
        }
      },
      action: { setBadgeText },
      storage: {
        sync: {
          get(_keys, callback) {
            callback(stored);
          },
          remove(keys, callback) {
            keys.forEach((key) => delete stored[key]);
            callback();
          }
        },
        local: {
          get(_keys, callback) {
            callback(localStored);
          },
          set(values, callback) {
            Object.assign(localStored, values);
            callback();
          }
        },
        onChanged: { addListener: vi.fn() }
      },
      tabs: {
        query(_query, callback) {
          callback([{ id: 1 }]);
        },
        sendMessage(id, message, callback) {
          callback({ ok: true, id, message });
        }
      }
    };
    const browser = loadBrowserShim(chrome);

    expect(await browser.storageGet(DEFAULT_SETTINGS)).toMatchObject({
      enabled: false,
      siteOverrides: { 'legacy.example': false }
    });
    await browser.storageSet({ ...DEFAULT_SETTINGS, enabled: true });
    expect(localStored.enabled).toBe(true);
    expect(stored).toEqual({});
    expect(localStored).toMatchObject({
      siteOverrides: {},
      siteFeatureOverrides: {},
      'byebar.legacySyncCleanupVersion': 1
    });
    expect(await browser.tabsQuery({ active: true })).toEqual([{ id: 1 }]);
    expect((await browser.sendRuntimeMessage({ type: 'test' })).ok).toBe(true);
    expect(await browser.sendTabMessage(1, { type: 'test' })).toEqual({
      ok: true,
      id: 1,
      message: { type: 'test' }
    });
    await browser.setActionBadgeText({ text: '2', tabId: 1 });
    expect(setBadgeText).toHaveBeenCalledWith({ text: '2', tabId: 1 }, expect.any(Function));
  });

  it('supports Promise-based browser APIs', async () => {
    const stored = { ...DEFAULT_SETTINGS };
    const setBadgeText = vi.fn(async () => {});
    const browserApi = {
      runtime: { sendMessage: async (message) => ({ ok: true, message }) },
      action: { setBadgeText },
      storage: {
        sync: {
          get: async () => stored,
          set: async (values) => Object.assign(stored, values)
        },
        local: {
          get: async () => ({}),
          set: async () => {},
          remove: async () => {}
        },
        onChanged: { addListener: vi.fn() }
      },
      tabs: {
        query: async () => [{ id: 2 }],
        sendMessage: async (_id, message) => ({ ok: true, message })
      }
    };
    const browser = loadBrowserShim(browserApi, 'browser');

    expect((await browser.storageGet(DEFAULT_SETTINGS)).enabled).toBe(true);
    expect(await browser.tabsQuery({ active: true })).toEqual([{ id: 2 }]);
    expect((await browser.sendTabMessage(2, { type: 'test' })).ok).toBe(true);
    await browser.setActionBadgeText({ text: '0', tabId: 2 });
    expect(setBadgeText).toHaveBeenCalledWith({ text: '0', tabId: 2 });
  });

  it('surfaces callback-based action badge failures', async () => {
    const chrome = {
      runtime: { lastError: null },
      action: {
        setBadgeText(_details, callback) {
          chrome.runtime.lastError = { message: 'action unavailable' };
          callback();
          chrome.runtime.lastError = null;
        }
      }
    };
    const browser = loadBrowserShim(chrome);

    await expect(browser.setActionBadgeText({ text: '1', tabId: 1 })).rejects.toThrow('action unavailable');
  });

  it('surfaces local settings write failures', async () => {
    const chrome = {
      runtime: { lastError: null },
      storage: {
        sync: { remove: vi.fn() },
        local: {
          set(_values, callback) {
            chrome.runtime.lastError = { message: 'quota exceeded' };
            callback();
            chrome.runtime.lastError = null;
          }
        },
        onChanged: { addListener: vi.fn() }
      }
    };
    const browser = loadBrowserShim(chrome);

    await expect(browser.storageSet(DEFAULT_SETTINGS)).rejects.toThrow('quota exceeded');
    expect(chrome.storage.sync.remove).not.toHaveBeenCalled();
  });

  it('ignores legacy sync changes while forwarding local settings changes', () => {
    let storageListener;
    const chrome = {
      runtime: { lastError: null },
      storage: {
        sync: {},
        local: {},
        onChanged: { addListener: (listener) => (storageListener = listener) }
      }
    };
    const browser = loadBrowserShim(chrome);
    const listener = vi.fn();
    browser.onStorageChanged(listener);

    storageListener({ siteOverrides: { oldValue: {}, newValue: undefined } }, 'sync');
    expect(listener).not.toHaveBeenCalled();
    storageListener({ siteOverrides: { oldValue: {}, newValue: { 'example.com': false } } }, 'local');
    expect(listener).toHaveBeenCalledWith(
      { siteOverrides: { oldValue: {}, newValue: { 'example.com': false } } },
      'local'
    );
  });

  it('removes legacy sync settings only after establishing local authority', async () => {
    const legacySync = {
      settingsSchemaVersion: 1,
      enabled: false,
      tosAccept: false,
      siteOverrides: { 'legacy.example': false }
    };
    const remove = vi.fn(async (keys) => keys.forEach((key) => delete legacySync[key]));
    const localStored = {};
    const browserApi = {
      runtime: {},
      storage: {
        sync: {
          get: async () => structuredClone(legacySync),
          remove
        },
        local: {
          get: async () => ({ ...localStored }),
          set: async (values) => Object.assign(localStored, values)
        },
        onChanged: { addListener: vi.fn() }
      }
    };
    const browser = loadBrowserShim(browserApi, 'browser');

    const migrated = await browser.storageGet(DEFAULT_SETTINGS);
    expect(migrated).toMatchObject({
      enabled: false,
      tosAccept: false,
      siteOverrides: { 'legacy.example': false }
    });

    await browser.storageSet({
      ...migrated,
      enabled: true,
      siteOverrides: { 'new.example': true }
    });

    expect(localStored).toMatchObject({
      'byebar.localSettingsVersion': 1,
      enabled: true,
      tosAccept: false,
      siteOverrides: { 'new.example': true }
    });
    expect(localStored['byebar.legacySyncCleanupVersion']).toBe(1);
    expect(await browser.storageGet(DEFAULT_SETTINGS)).toMatchObject({
      enabled: true,
      siteOverrides: { 'new.example': true }
    });
    expect(await browserApi.storage.sync.get(null)).toEqual({});
    expect(remove).toHaveBeenCalledOnce();
    expect(remove.mock.calls[0][0]).toEqual(
      expect.arrayContaining(['settingsSchemaVersion', 'tosAccept', 'locationDecline'])
    );
  });

  it('treats a future local migration marker as authoritative on downgrade', async () => {
    const localStored = {
      'byebar.localSettingsVersion': 2,
      settingsSchemaVersion: 9,
      enabled: false,
      genericBlocking: false,
      tosAccept: false,
      siteOverrides: { 'future.example': false },
      futureSetting: { mode: 'preserve-me' }
    };
    const originalLocal = structuredClone(localStored);
    const staleSync = {
      settingsSchemaVersion: 1,
      enabled: true,
      genericBlocking: true,
      siteOverrides: { 'stale.example': true }
    };
    const originalSync = structuredClone(staleSync);
    const syncGet = vi.fn(async () => structuredClone(staleSync));
    const syncSet = vi.fn(async () => {});
    const syncRemove = vi.fn(async () => {});
    const localSet = vi.fn(async () => {});
    const browserApi = {
      runtime: {},
      storage: {
        sync: { get: syncGet, set: syncSet, remove: syncRemove },
        local: {
          get: async () => structuredClone(localStored),
          set: localSet
        },
        onChanged: { addListener: vi.fn() }
      }
    };
    const browser = loadBrowserShim(browserApi, 'browser');

    expect(await browser.storageGet(DEFAULT_SETTINGS)).toMatchObject({
      settingsSchemaVersion: 9,
      enabled: false,
      genericBlocking: false,
      siteOverrides: { 'future.example': false }
    });
    expect(syncGet).not.toHaveBeenCalled();
    expect(syncSet).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(syncRemove).toHaveBeenCalledOnce());
    expect(localSet).toHaveBeenCalledWith({ 'byebar.legacySyncCleanupVersion': 1 });
    expect(localStored).toEqual(originalLocal);
    expect(staleSync).toEqual(originalSync);
  });

  it('preserves a future migration marker when a downgraded version writes compatible settings', async () => {
    const localStored = {
      'byebar.localSettingsVersion': 2,
      settingsSchemaVersion: 1,
      enabled: false
    };
    const browserApi = {
      runtime: {},
      storage: {
        sync: { get: vi.fn(async () => ({})), remove: vi.fn(async () => {}) },
        local: {
          get: async () => structuredClone(localStored),
          set: async (values) => Object.assign(localStored, values)
        },
        onChanged: { addListener: vi.fn() }
      }
    };
    const browser = loadBrowserShim(browserApi, 'browser');

    const settings = await browser.storageGet(DEFAULT_SETTINGS);
    await browser.storageSet({ ...settings, enabled: true });

    expect(localStored['byebar.localSettingsVersion']).toBe(2);
    expect(localStored.enabled).toBe(true);
    expect(browserApi.storage.sync.get).not.toHaveBeenCalled();
  });

  it('treats a future legacy cleanup marker as complete without downgrading it', async () => {
    const localStored = {
      'byebar.localSettingsVersion': 1,
      'byebar.legacySyncCleanupVersion': 4,
      settingsSchemaVersion: 1,
      enabled: false
    };
    const remove = vi.fn(async () => {});
    const set = vi.fn(async () => {});
    const browser = loadBrowserShim(
      {
        runtime: {},
        storage: {
          sync: { remove },
          local: { get: async () => structuredClone(localStored), set },
          onChanged: { addListener: vi.fn() }
        }
      },
      'browser'
    );

    expect((await browser.storageGet(DEFAULT_SETTINGS)).enabled).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(localStored['byebar.legacySyncCleanupVersion']).toBe(4);
  });

  it('re-reads and preserves a concurrently newer cleanup marker after removing sync keys', async () => {
    const localStored = {
      'byebar.localSettingsVersion': 1,
      settingsSchemaVersion: 1,
      enabled: true
    };
    const remove = vi.fn(async () => {
      localStored['byebar.legacySyncCleanupVersion'] = 3;
    });
    const set = vi.fn(async (values) => Object.assign(localStored, values));
    const browser = loadBrowserShim(
      {
        runtime: {},
        storage: {
          sync: { remove },
          local: { get: async () => structuredClone(localStored), set },
          onChanged: { addListener: vi.fn() }
        }
      },
      'browser'
    );

    await browser.storageGet(DEFAULT_SETTINGS);

    expect(remove).toHaveBeenCalledOnce();
    expect(set).not.toHaveBeenCalled();
    expect(localStored['byebar.legacySyncCleanupVersion']).toBe(3);
  });

  it('routes cleanup from non-writer contexts instead of racing local storage writes', async () => {
    const localStored = {
      'byebar.localSettingsVersion': 1,
      settingsSchemaVersion: 1,
      enabled: true
    };
    const sendMessage = vi.fn(async () => ({ ok: true }));
    const remove = vi.fn(async () => {});
    const set = vi.fn(async () => {});
    const browser = loadBrowserShim(
      {
        runtime: { sendMessage },
        storage: {
          sync: { remove },
          local: { get: async () => structuredClone(localStored), set },
          onChanged: { addListener: vi.fn() }
        }
      },
      'browser',
      false
    );

    await browser.storageGet(DEFAULT_SETTINGS);

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'byebar.storage.cleanupLegacySync',
      protocol: MESSAGE_PROTOCOL_VERSION
    });
    expect(remove).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('prefers a local migration completed while a legacy sync read is pending', async () => {
    let resolveSync;
    const localStored = { enabled: true };
    const syncGet = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve;
        })
    );
    const browserApi = {
      runtime: {},
      storage: {
        sync: { get: syncGet, remove: async () => {} },
        local: {
          get: async () => ({ ...localStored }),
          set: async (values) => Object.assign(localStored, values)
        },
        onChanged: { addListener: vi.fn() }
      }
    };
    const browser = loadBrowserShim(browserApi, 'browser');
    const pending = browser.storageGet(DEFAULT_SETTINGS);
    await vi.waitFor(() => expect(syncGet).toHaveBeenCalledOnce());

    Object.assign(localStored, {
      'byebar.localSettingsVersion': 1,
      settingsSchemaVersion: 1,
      enabled: false
    });
    resolveSync({ settingsSchemaVersion: 1, enabled: true });

    expect((await pending).enabled).toBe(false);
  });

  it('fails closed when legacy sync cannot be inspected', async () => {
    const localSet = vi.fn(async () => {});
    const browserApi = {
      runtime: {},
      storage: {
        sync: { get: async () => Promise.reject(new Error('sync unavailable')) },
        local: {
          get: async () => ({ enabled: false }),
          set: localSet
        },
        onChanged: { addListener: vi.fn() }
      }
    };
    const browser = loadBrowserShim(browserApi, 'browser');

    await expect(browser.storageGet(DEFAULT_SETTINGS)).rejects.toThrow('sync unavailable');
    expect(localSet).not.toHaveBeenCalled();
  });
});
