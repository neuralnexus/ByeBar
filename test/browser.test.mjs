import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../lib/settings.mjs';

const source = readFileSync(new URL('../shared/browser.js', import.meta.url), 'utf8');

function loadBrowserShim(extensionApi, namespace = 'chrome') {
  const context = {
    [namespace]: extensionApi,
    ByeBar: { settings: { DEFAULT_SETTINGS, normalizeSettings } },
    console
  };
  vm.runInNewContext(source, context);
  return context.ByeBar.browser;
}

describe('browser adapters', () => {
  it('supports callback-based Chrome APIs', async () => {
    const stored = { enabled: false, siteOverrides: { 'legacy.example': false } };
    const localStored = { enabled: true, siteOverrides: { 'stale.example': true } };
    const chrome = {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          callback({ ok: true, message });
        }
      },
      storage: {
        sync: {
          get(_keys, callback) {
            callback(stored);
          },
          set(values, callback) {
            Object.assign(stored, values);
            callback();
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
    expect(stored).not.toHaveProperty('siteOverrides');
    expect(localStored).toMatchObject({ siteOverrides: {}, siteFeatureOverrides: {} });
    expect(await browser.tabsQuery({ active: true })).toEqual([{ id: 1 }]);
    expect((await browser.sendRuntimeMessage({ type: 'test' })).ok).toBe(true);
    expect(await browser.sendTabMessage(1, { type: 'test' })).toEqual({
      ok: true,
      id: 1,
      message: { type: 'test' }
    });
  });

  it('supports Promise-based browser APIs', async () => {
    const stored = { ...DEFAULT_SETTINGS };
    const browserApi = {
      runtime: { sendMessage: async (message) => ({ ok: true, message }) },
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

  it('prefers a migrated local record and cleans stale sync settings', async () => {
    const remove = vi.fn(async () => {});
    const localStored = {
      'byebar.localSettingsVersion': 1,
      settingsSchemaVersion: 1,
      enabled: false
    };
    const browserApi = {
      runtime: {},
      storage: {
        sync: {
          get: async () => ({ settingsSchemaVersion: 1, enabled: true }),
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

    expect((await browser.storageGet(DEFAULT_SETTINGS)).enabled).toBe(false);
    await vi.waitFor(() => expect(localStored['byebar.legacySyncCleanupVersion']).toBe(1));
    await browser.storageGet(DEFAULT_SETTINGS);
    expect(remove).toHaveBeenCalledOnce();
    expect(remove.mock.calls[0][0]).toEqual(
      expect.arrayContaining(['locationDecline', 'netsuiteLeadRedirect'])
    );
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
