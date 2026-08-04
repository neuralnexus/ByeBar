import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import * as constants from '../lib/constants.mjs';
import * as settings from '../lib/settings.mjs';

const source = readFileSync(new URL('../background/service-worker.js', import.meta.url), 'utf8');
const protocol = constants.MESSAGE_PROTOCOL_VERSION;
const emptySweepCounts = {
  reversibleHides: 0,
  dismissActions: 0,
  cookieDeclines: 0,
  legalAccepts: 0
};

function sweepResponse({ enabled = true, counts = emptySweepCounts, documentId = 'document-id' } = {}) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return {
    ok: true,
    documentId,
    capabilities: ['sweep'],
    sweep: {
      effective: { enabled },
      result: { outcome: total === 0 ? 'no-op' : 'applied', counts: { ...counts } }
    }
  };
}

function createTimerHarness() {
  let nextId = 0;
  const pending = new Map();
  return {
    setTimeout: vi.fn((callback, delay) => {
      nextId += 1;
      pending.set(nextId, { callback, delay });
      return nextId;
    }),
    clearTimeout: vi.fn((id) => pending.delete(id)),
    run(delay) {
      for (const [id, timer] of [...pending]) {
        if (timer.delay !== delay) continue;
        pending.delete(id);
        timer.callback();
      }
    }
  };
}

function clone(value) {
  return structuredClone(value);
}

function loadWorker({
  sync = {},
  local = {},
  tabs = [{ id: 7 }],
  storageGet,
  storageSet,
  localGet,
  localSet,
  tabsQuery,
  sendTabMessage,
  setActionBadgeText,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  const listeners = {};
  const syncStore = clone(sync);
  const localStore = clone(local);
  const api = {
    runtime: {
      onInstalled: { addListener: (listener) => (listeners.installed = listener) },
      onMessage: { addListener: (listener) => (listeners.message = listener) }
    },
    commands: { onCommand: { addListener: (listener) => (listeners.command = listener) } }
  };
  const browser = {
    api,
    storageGet: vi.fn(async (defaults) => {
      if (storageGet) return storageGet(defaults, syncStore);
      return settings.normalizeSettings(clone(syncStore), defaults);
    }),
    storageSet: vi.fn(async (values) => {
      if (storageSet) await storageSet(values, syncStore);
      Object.assign(syncStore, clone(values));
    }),
    localGet: vi.fn(async (defaults) => {
      if (localGet) return localGet(defaults, localStore);
      return { ...clone(defaults), ...clone(localStore) };
    }),
    localSet: vi.fn(async (values) => {
      if (localSet) await localSet(values, localStore);
      Object.assign(localStore, clone(values));
    }),
    tabsQuery: vi.fn(async (query) => (tabsQuery ? tabsQuery(query) : clone(tabs))),
    sendTabMessage: vi.fn(async (tabId, message) => {
      if (sendTabMessage) return sendTabMessage(tabId, message);
      if (message.type === 'byebar.page.getState') {
        return { ok: true, documentId: 'document-id', capabilities: ['sweep'] };
      }
      return { ok: true };
    }),
    setActionBadgeText: vi.fn(async (details) => {
      if (setActionBadgeText) return setActionBadgeText(details);
    })
  };
  const context = vm.createContext({
    self: { ByeBar: { browser, settings, lib: { constants } } },
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    console
  });
  vm.runInContext(source, context);
  let startupSettled = false;

  async function settleStartup(clearCalls) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    startupSettled = true;
    if (clearCalls) {
      browser.tabsQuery.mockClear();
      browser.setActionBadgeText.mockClear();
    }
  }

  return {
    browser,
    syncStore,
    localStore,
    dispatch(message) {
      let resolveResponse;
      const response = new Promise((resolve) => {
        resolveResponse = (value) => resolve(clone(value));
      });
      const handled = listeners.message(message, {}, resolveResponse);
      if (handled !== true) resolveResponse(undefined);
      return { handled, response };
    },
    install(details) {
      listeners.installed(details);
    },
    async command(command, tab) {
      if (!startupSettled) await settleStartup(true);
      listeners.command(command, tab);
    },
    async startup() {
      if (!startupSettled) await settleStartup(false);
    }
  };
}

function request(type, values = {}) {
  return { protocol, type, ...values };
}

async function send(worker, type, values) {
  const dispatched = worker.dispatch(request(type, values));
  expect(dispatched.handled).toBe(true);
  return dispatched.response;
}

describe('service worker protocol', () => {
  it('filters unrelated messages and rejects unsupported protocol versions', async () => {
    const worker = loadWorker();
    const unrelated = worker.dispatch({ type: 'other-extension.message' });
    expect(unrelated.handled).toBeUndefined();
    expect(await unrelated.response).toBeUndefined();
    expect(worker.browser.storageGet).not.toHaveBeenCalled();

    expect(await worker.dispatch({ type: 'byebar.settings.get', protocol: protocol + 1 }).response).toEqual({
      ok: false,
      error: { code: 'protocol-mismatch', message: 'Unsupported protocol' }
    });
    expect(await send(worker, 'byebar.unknown')).toEqual({
      ok: false,
      error: { code: 'unknown-message', message: 'Unknown request' }
    });
  });

  it('returns normalized, cloneable global, site, and debug state', async () => {
    const worker = loadWorker({
      sync: {
        enabled: true,
        genericBlocking: true,
        cookieDecline: true,
        tosAccept: false,
        siteOverrides: { 'WWW.Example.com': false },
        siteFeatureOverrides: { 'example.com': { cookieDecline: false } }
      },
      local: { 'byebar.debug': { schemaVersion: 1, enabled: true } }
    });

    const response = await send(worker, 'byebar.settings.get', { host: 'www.Example.com' });
    expect(response.ok).toBe(true);
    expect(response.state.global).toEqual({
      enabled: true,
      genericBlocking: true,
      cookieDecline: true,
      tosAccept: false
    });
    expect(response.state.site).toEqual({
      host: 'example.com',
      overrides: { enabled: false, genericBlocking: null, cookieDecline: false, tosAccept: null },
      configured: { enabled: false, genericBlocking: true, cookieDecline: false, tosAccept: false },
      effective: { enabled: false, genericBlocking: false, cookieDecline: false, tosAccept: false },
      hasOverrides: true
    });
    expect(response.state.debugEnabled).toBe(true);
    expect(() => structuredClone(response)).not.toThrow();
  });

  it('updates global and site settings, clears site overrides, and stores debug locally', async () => {
    const worker = loadWorker();

    await send(worker, 'byebar.settings.update', {
      scope: 'global',
      key: 'cookieDecline',
      value: false
    });
    expect(worker.syncStore.cookieDecline).toBe(false);

    await send(worker, 'byebar.settings.update', {
      scope: 'site',
      host: 'www.example.com',
      key: 'enabled',
      value: false
    });
    await send(worker, 'byebar.settings.update', {
      scope: 'site',
      host: 'www.example.com',
      key: 'genericBlocking',
      value: false
    });
    expect(worker.syncStore.siteOverrides).toEqual({ 'example.com': false });
    expect(worker.syncStore.siteFeatureOverrides).toEqual({
      'example.com': { genericBlocking: false }
    });

    await send(worker, 'byebar.settings.update', {
      scope: 'site',
      host: 'example.com',
      key: 'genericBlocking',
      value: null
    });
    expect(worker.syncStore.siteFeatureOverrides).toEqual({});

    await send(worker, 'byebar.settings.clearSite', { host: 'example.com' });
    expect(worker.syncStore.siteOverrides).toEqual({});
    expect(worker.syncStore.siteFeatureOverrides).toEqual({});

    const debug = await send(worker, 'byebar.debug.set', { enabled: true });
    expect(debug.state.debugEnabled).toBe(true);
    expect(worker.localStore).toEqual({ 'byebar.debug': { schemaVersion: 1, enabled: true } });
  });

  it.each([
    [{ scope: 'global', key: 'missing', value: true }, 'invalid-setting'],
    [{ scope: 'global', key: 'enabled', value: null }, 'invalid-setting'],
    [{ scope: 'unknown', key: 'enabled', value: true }, 'invalid-setting'],
    [{ scope: 'site', host: 'not a host', key: 'enabled', value: true }, 'invalid-host'],
    [{ scope: 'site', host: 'example.com', key: 'enabled', value: 'yes' }, 'invalid-setting']
  ])('rejects invalid setting update %# without writing', async (values, code) => {
    const worker = loadWorker();
    const response = await send(worker, 'byebar.settings.update', values);
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(code);
    expect(worker.browser.storageSet).not.toHaveBeenCalled();
  });

  it('rejects invalid clear and debug values without writing', async () => {
    const worker = loadWorker();
    expect((await send(worker, 'byebar.settings.clearSite', { host: '' })).error.code).toBe('invalid-host');
    expect((await send(worker, 'byebar.debug.set', { enabled: 'yes' })).error.code).toBe('invalid-setting');
    expect(worker.browser.storageSet).not.toHaveBeenCalled();
    expect(worker.browser.localSet).not.toHaveBeenCalled();
  });
});

describe('service worker Sweep command', () => {
  it('uses the command tab for a document-scoped Sweep handshake', async () => {
    const worker = loadWorker();
    await worker.command('unrelated-command', { id: 11 });
    expect(worker.browser.sendTabMessage).not.toHaveBeenCalled();

    await worker.command('sweep-page', { id: 11 });
    await vi.waitFor(() => expect(worker.browser.sendTabMessage).toHaveBeenCalledTimes(2));

    expect(worker.browser.tabsQuery).not.toHaveBeenCalled();
    expect(worker.browser.sendTabMessage.mock.calls).toEqual([
      [11, { protocol, type: 'byebar.page.getState' }],
      [11, { protocol, type: 'byebar.page.sweep', documentId: 'document-id' }]
    ]);
  });

  it('queries the active tab when the browser omits the command tab', async () => {
    const worker = loadWorker({ tabs: [{ id: 12 }] });
    await worker.command('sweep-page');
    await vi.waitFor(() => expect(worker.browser.sendTabMessage).toHaveBeenCalledTimes(2));

    expect(worker.browser.tabsQuery).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(worker.browser.sendTabMessage.mock.calls[0][0]).toBe(12);
  });

  it('stops when Sweep is unsupported', async () => {
    let resolveState;
    const pendingState = new Promise((resolve) => {
      resolveState = resolve;
    });
    const worker = loadWorker({ sendTabMessage: async () => pendingState });
    await worker.command('sweep-page', { id: 13 });
    await vi.waitFor(() => expect(worker.browser.sendTabMessage).toHaveBeenCalledOnce());

    resolveState({ ok: true, documentId: 'document-id', capabilities: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.browser.sendTabMessage).toHaveBeenCalledOnce();
  });

  it('suppresses key repeats that arrive after the first Sweep completes', async () => {
    const worker = loadWorker();
    await worker.command('sweep-page', { id: 14 });
    await vi.waitFor(() => expect(worker.browser.sendTabMessage).toHaveBeenCalledTimes(2));

    await new Promise((resolve) => setTimeout(resolve, 600));
    await worker.command('sweep-page', { id: 14 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.browser.sendTabMessage).toHaveBeenCalledTimes(2);
  });

  it('waits for settings mutations queued before the shortcut', async () => {
    let releaseWrite;
    const pendingWrite = new Promise((resolve) => {
      releaseWrite = resolve;
    });
    const worker = loadWorker({ storageSet: async () => pendingWrite });
    const update = worker.dispatch(
      request('byebar.settings.update', { scope: 'global', key: 'enabled', value: false })
    );
    await vi.waitFor(() => expect(worker.browser.storageSet).toHaveBeenCalledOnce());

    await worker.command('sweep-page', { id: 15 });
    await vi.waitFor(() => expect(worker.browser.sendTabMessage).toHaveBeenCalledOnce());
    expect(worker.browser.sendTabMessage.mock.calls[0]).toEqual([
      15,
      { protocol, type: 'byebar.page.getState' }
    ]);

    releaseWrite();
    await update.response;
    await vi.waitFor(() => expect(worker.browser.sendTabMessage).toHaveBeenCalledTimes(2));
    expect(worker.browser.sendTabMessage.mock.calls[1]).toEqual([
      15,
      { protocol, type: 'byebar.page.sweep', documentId: 'document-id' }
    ]);
  });

  it.each([
    ['4', sweepResponse({ counts: { ...emptySweepCounts, reversibleHides: 3, cookieDeclines: 1 } })],
    ['0', sweepResponse()],
    ['OFF', sweepResponse({ enabled: false })]
  ])('shows validated per-tab Sweep feedback %s', async (text, response) => {
    const timers = createTimerHarness();
    const worker = loadWorker({
      setTimer: timers.setTimeout,
      clearTimer: timers.clearTimeout,
      sendTabMessage: async (_tabId, message) =>
        message.type === 'byebar.page.getState'
          ? { ok: true, documentId: 'document-id', capabilities: ['sweep'] }
          : response
    });

    await worker.command('sweep-page', { id: 16 });
    await vi.waitFor(() => expect(worker.browser.setActionBadgeText).toHaveBeenCalledTimes(2));
    expect(worker.browser.setActionBadgeText.mock.calls).toEqual([
      [{ text: '', tabId: 16 }],
      [{ text, tabId: 16 }]
    ]);

    timers.run(3_000);
    expect(worker.browser.setActionBadgeText).toHaveBeenLastCalledWith({ text: '', tabId: 16 });
  });

  it('does not claim malformed or ambiguous Sweep results', async () => {
    const malformed = sweepResponse({ documentId: 'replacement-document' });
    const malformedWorker = loadWorker({
      sendTabMessage: async (_tabId, message) =>
        message.type === 'byebar.page.getState'
          ? { ok: true, documentId: 'document-id', capabilities: ['sweep'] }
          : malformed
    });
    await malformedWorker.command('sweep-page', { id: 17 });
    await vi.waitFor(() => expect(malformedWorker.browser.sendTabMessage).toHaveBeenCalledTimes(2));
    expect(malformedWorker.browser.setActionBadgeText).toHaveBeenCalledOnce();
    expect(malformedWorker.browser.setActionBadgeText).toHaveBeenCalledWith({ text: '', tabId: 17 });

    const ambiguousWorker = loadWorker({
      sendTabMessage: async (_tabId, message) => {
        if (message.type === 'byebar.page.getState') {
          return { ok: true, documentId: 'document-id', capabilities: ['sweep'] };
        }
        throw new Error('response lost');
      }
    });
    await ambiguousWorker.command('sweep-page', { id: 18 });
    await vi.waitFor(() => expect(ambiguousWorker.browser.sendTabMessage).toHaveBeenCalledTimes(2));
    expect(ambiguousWorker.browser.setActionBadgeText).toHaveBeenCalledOnce();
    expect(ambiguousWorker.browser.setActionBadgeText).toHaveBeenCalledWith({ text: '', tabId: 18 });
  });

  it('keeps Sweep independent from unavailable badge feedback', async () => {
    const worker = loadWorker({
      setActionBadgeText: async () => Promise.reject(new Error('badge unavailable')),
      sendTabMessage: async (_tabId, message) =>
        message.type === 'byebar.page.getState'
          ? { ok: true, documentId: 'document-id', capabilities: ['sweep'] }
          : sweepResponse()
    });

    await worker.command('sweep-page', { id: 19 });
    await vi.waitFor(() => expect(worker.browser.sendTabMessage).toHaveBeenCalledTimes(2));
    expect(worker.browser.setActionBadgeText).toHaveBeenCalled();
  });

  it('clears stale per-tab feedback when the worker restarts', async () => {
    const writes = [];
    const timers = createTimerHarness();
    const badgeWriter = async (details) => writes.push(details);
    const sendTabMessage = async (_tabId, message) =>
      message.type === 'byebar.page.getState'
        ? { ok: true, documentId: 'document-id', capabilities: ['sweep'] }
        : sweepResponse({ counts: { ...emptySweepCounts, reversibleHides: 7 } });
    const worker = loadWorker({
      tabs: [{ id: 20 }],
      setTimer: timers.setTimeout,
      clearTimer: timers.clearTimeout,
      setActionBadgeText: badgeWriter,
      sendTabMessage
    });
    await worker.command('sweep-page', { id: 20 });
    await vi.waitFor(() => expect(writes).toContainEqual({ text: '7', tabId: 20 }));

    const restarted = loadWorker({ tabs: [{ id: 20 }], setActionBadgeText: badgeWriter });
    await restarted.startup();
    expect(writes.at(-1)).toEqual({ text: '', tabId: 20 });
  });
});

describe('service worker mutation queue', () => {
  it('serializes read-modify-write updates without losing changes', async () => {
    let releaseFirst;
    const firstWrite = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let writes = 0;
    const worker = loadWorker({
      storageSet: async () => {
        writes += 1;
        if (writes === 1) await firstWrite;
      }
    });

    const first = worker.dispatch(
      request('byebar.settings.update', { scope: 'global', key: 'enabled', value: false })
    );
    const second = worker.dispatch(
      request('byebar.settings.update', { scope: 'global', key: 'genericBlocking', value: false })
    );
    await vi.waitFor(() => expect(worker.browser.storageSet).toHaveBeenCalledTimes(1));
    expect(worker.browser.storageGet).toHaveBeenCalledTimes(1);

    releaseFirst();
    const firstResponse = await first.response;
    const secondResponse = await second.response;
    expect(firstResponse.state.global).toMatchObject({ enabled: false, genericBlocking: true });
    expect(secondResponse.state.global).toMatchObject({ enabled: false, genericBlocking: false });
    expect(worker.syncStore).toMatchObject({ enabled: false, genericBlocking: false });
  });

  it('continues queued updates after a failed write', async () => {
    let writes = 0;
    const worker = loadWorker({
      storageSet: async () => {
        writes += 1;
        if (writes === 1) throw new Error('sync storage offline');
      }
    });
    const first = worker.dispatch(
      request('byebar.settings.update', { scope: 'global', key: 'enabled', value: false })
    );
    const second = worker.dispatch(
      request('byebar.settings.update', { scope: 'global', key: 'genericBlocking', value: false })
    );

    expect((await first.response).error.code).toBe('storage-unavailable');
    expect((await second.response).ok).toBe(true);
    expect(worker.syncStore).toMatchObject({ enabled: true, genericBlocking: false });
  });

  it('serializes diagnostics writes in request order', async () => {
    let releaseFirst;
    const firstWrite = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let writes = 0;
    const worker = loadWorker({
      localSet: async () => {
        writes += 1;
        if (writes === 1) await firstWrite;
      }
    });

    const first = worker.dispatch(request('byebar.debug.set', { enabled: true }));
    const second = worker.dispatch(request('byebar.debug.set', { enabled: false }));
    await vi.waitFor(() => expect(worker.browser.localSet).toHaveBeenCalledOnce());
    expect(worker.browser.storageGet).toHaveBeenCalledOnce();

    releaseFirst();
    expect((await first.response).state.debugEnabled).toBe(true);
    expect((await second.response).state.debugEnabled).toBe(false);
    expect(worker.localStore['byebar.debug'].enabled).toBe(false);
  });

  it('orders settings reads behind pending mutations', async () => {
    let releaseWrite;
    const pendingWrite = new Promise((resolve) => {
      releaseWrite = resolve;
    });
    const worker = loadWorker({ storageSet: async () => pendingWrite });

    const update = worker.dispatch(
      request('byebar.settings.update', { scope: 'global', key: 'enabled', value: false })
    );
    await vi.waitFor(() => expect(worker.browser.storageSet).toHaveBeenCalledOnce());
    const read = worker.dispatch(request('byebar.settings.get'));
    expect(worker.browser.storageGet).toHaveBeenCalledOnce();

    releaseWrite();
    expect((await update.response).state.global.enabled).toBe(false);
    expect((await read.response).state.global.enabled).toBe(false);
  });
});

describe('service worker migration and failures', () => {
  it('migrates pre-schema legal acceptance to the safe default', async () => {
    const worker = loadWorker({
      sync: {
        tosAccept: true,
        siteOverrides: { 'WWW.Example.com': false, 'not a host': true },
        siteFeatureOverrides: { 'example.com': { genericBlocking: false, unknown: true } }
      }
    });
    worker.install({ reason: 'update', previousVersion: '0.6.0' });

    await vi.waitFor(() => expect(worker.syncStore.settingsSchemaVersion).toBe(1));
    expect(worker.syncStore.tosAccept).toBe(false);
    expect(worker.syncStore.siteOverrides).toEqual({ 'example.com': false });
    expect(worker.syncStore.siteFeatureOverrides).toEqual({
      'example.com': { genericBlocking: false }
    });
  });

  it('preserves explicit legal acceptance after the schema migration', async () => {
    const worker = loadWorker({ sync: { settingsSchemaVersion: 1, tosAccept: true } });
    worker.install({ reason: 'update', previousVersion: '0.6.0' });
    await vi.waitFor(() => expect(worker.browser.storageSet).toHaveBeenCalledOnce());
    expect(worker.syncStore.tosAccept).toBe(true);
  });

  it('does not rewrite or mutate settings from a newer schema', async () => {
    const worker = loadWorker({
      sync: {
        settingsSchemaVersion: 9,
        enabled: true,
        siteFeatureOverrides: { 'example.com': { futureFeature: true } }
      }
    });
    worker.install({ reason: 'update', previousVersion: '9.0.0' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.browser.storageSet).not.toHaveBeenCalled();

    const response = await send(worker, 'byebar.settings.update', {
      scope: 'global',
      key: 'enabled',
      value: false
    });
    expect(response.error.code).toBe('unsupported-schema');
    expect(worker.browser.storageSet).not.toHaveBeenCalled();
    expect(worker.syncStore.siteFeatureOverrides['example.com'].futureFeature).toBe(true);
  });

  it('checks diagnostics storage before committing a settings write', async () => {
    const worker = loadWorker({ localGet: async () => Promise.reject(new Error('local offline')) });
    const response = await send(worker, 'byebar.settings.update', {
      scope: 'global',
      key: 'enabled',
      value: false
    });
    expect(response.error.code).toBe('storage-unavailable');
    expect(worker.browser.storageSet).not.toHaveBeenCalled();
  });

  it.each(['byebar.settings.get', 'byebar.settings.update', 'byebar.settings.clearSite'])(
    'maps sync read failure for %s to storage-unavailable',
    async (type) => {
      const worker = loadWorker({ storageGet: async () => Promise.reject(new Error('sync offline')) });
      const response = await send(worker, type, {
        scope: 'global',
        key: 'enabled',
        value: false,
        host: 'example.com'
      });
      expect(response.error.code).toBe('storage-unavailable');
    }
  );

  it('maps native browser quota failures to quota-exceeded', async () => {
    const worker = loadWorker({
      storageSet: async () => Promise.reject(new Error('QUOTA_BYTES_PER_ITEM quota exceeded'))
    });
    const response = await send(worker, 'byebar.settings.update', {
      scope: 'global',
      key: 'enabled',
      value: false
    });
    expect(response.error.code).toBe('quota-exceeded');
  });

  it.each([
    ['siteOverrides', 'enabled'],
    ['siteFeatureOverrides', 'genericBlocking']
  ])('rejects a 501st %s entry before writing', async (mapKey, settingKey) => {
    const full = {};
    for (let index = 0; index < 500; index += 1) {
      const host = `s${index}.x`;
      full[host] = mapKey === 'siteOverrides' ? false : { genericBlocking: false };
    }
    const worker = loadWorker({ sync: { settingsSchemaVersion: 1, [mapKey]: full } });
    const response = await send(worker, 'byebar.settings.update', {
      scope: 'site',
      host: 'overflow.example',
      key: settingKey,
      value: false
    });

    expect(response.error.code).toBe('quota-exceeded');
    expect(worker.browser.storageSet).not.toHaveBeenCalled();
  });
});
