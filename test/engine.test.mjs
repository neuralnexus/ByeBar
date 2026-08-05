import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import * as settings from '../lib/settings.mjs';

const source = readFileSync(new URL('../content/engine.js', import.meta.url), 'utf8');

function loadEngine(storageGet, picker = null) {
  const listeners = {};
  const cookies = { decline: vi.fn(), closestBanner: () => null };
  const visibility = {
    ensureHidden: vi.fn(),
    restore: vi.fn(),
    restoreAll: vi.fn(),
    syncScrollLock: vi.fn()
  };
  const actions = {
    captureSweepResult: vi.fn((run) => {
      run();
      return {
        outcome: 'no-op',
        counts: { reversibleHides: 0, dismissActions: 0, cookieDeclines: 0, legalAccepts: 0 }
      };
    })
  };
  const document = {
    documentElement: {},
    querySelectorAll: () => []
  };
  const ByeBar = {
    lib: {
      host: { hostKey: (host) => host },
      overlay: { findPromotionalOverlayRoot: () => null }
    },
    settings,
    browser: {
      storageGet: vi.fn(storageGet),
      onStorageChanged: (listener) => (listeners.storage = listener)
    },
    actions,
    picker,
    visibility,
    shadow: {
      observedAttributes: [],
      queryAll: () => [],
      closestDeep: () => null,
      watchShadowRoots: vi.fn()
    },
    cookies,
    tos: { accept: vi.fn(), closestModal: () => null },
    GENERIC_REMOVE: [],
    COOKIE_BANNER_ANCESTORS: '',
    TOS_BANNER_ANCESTORS: ''
  };
  const window = { ByeBar, addEventListener: vi.fn() };
  const MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const context = vm.createContext({
    window,
    document,
    location: { hostname: 'example.com' },
    MutationObserver,
    getComputedStyle: () => ({}),
    requestAnimationFrame: vi.fn(),
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
    setTimeout,
    clearTimeout,
    console
  });
  vm.runInContext(source, context);
  return {
    engine: ByeBar.engine,
    listeners,
    cookies,
    actions,
    visibility,
    storageGet: ByeBar.browser.storageGet
  };
}

describe('content settings state', () => {
  it('does not apply partial storage events before the initial snapshot', async () => {
    let resolveInitial;
    const initial = new Promise((resolve) => {
      resolveInitial = resolve;
    });
    const { engine, listeners, cookies } = loadEngine(() => initial);

    const ready = engine.loadSettings();
    listeners.storage({ genericBlocking: { newValue: false } });
    expect(cookies.decline).not.toHaveBeenCalled();

    resolveInitial({
      ...settings.DEFAULT_SETTINGS,
      genericBlocking: false,
      cookieDecline: false
    });
    await ready;

    expect(engine.settings.cookieDecline).toBe(false);
    expect(cookies.decline).not.toHaveBeenCalled();
  });

  it('refreshes settings and returns effective state for a manual sweep', async () => {
    let stored = {
      ...settings.DEFAULT_SETTINGS,
      genericBlocking: false,
      cookieDecline: false,
      tosAccept: false
    };
    const { engine, cookies, storageGet } = loadEngine(async () => ({ ...stored }));
    await engine.loadSettings();
    stored = { ...stored, cookieDecline: true };

    await expect(engine.sweepPage()).resolves.toEqual({
      effective: {
        enabled: true,
        genericBlocking: false,
        cookieDecline: true,
        tosAccept: false
      },
      result: {
        outcome: 'no-op',
        counts: { reversibleHides: 0, dismissActions: 0, cookieDeclines: 0, legalAccepts: 0 }
      }
    });
    expect(storageGet).toHaveBeenCalledTimes(2);
    expect(cookies.decline).toHaveBeenCalledOnce();
  });

  it('captures only the final settings pass after a stale storage read', async () => {
    let resolveFirst;
    let reads = 0;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const { engine, listeners, actions, storageGet } = loadEngine(async () => {
      reads += 1;
      if (reads === 1) return first;
      return { ...settings.DEFAULT_SETTINGS, genericBlocking: false };
    });

    const sweep = engine.sweepPage();
    await vi.waitFor(() => expect(storageGet).toHaveBeenCalledOnce());
    listeners.storage({ genericBlocking: { newValue: false } });
    resolveFirst(settings.DEFAULT_SETTINGS);

    await expect(sweep).resolves.toMatchObject({ effective: { genericBlocking: false } });
    expect(storageGet).toHaveBeenCalledTimes(2);
    expect(actions.captureSweepResult).toHaveBeenCalledOnce();
  });

  it('pauses automatic passes for Pick and resumes with a full document pass', async () => {
    let blocked = true;
    const picker = {
      blocksAutomation: () => blocked,
      onEffectiveSettingsChanged: vi.fn()
    };
    const stored = { ...settings.DEFAULT_SETTINGS, genericBlocking: false, tosAccept: false };
    const { engine, cookies, visibility } = loadEngine(async () => stored, picker);

    await engine.loadSettings();
    expect(picker.onEffectiveSettingsChanged).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true })
    );
    expect(cookies.decline).not.toHaveBeenCalled();
    expect(visibility.ensureHidden).not.toHaveBeenCalled();

    blocked = false;
    engine.resumeAutomation();
    expect(visibility.ensureHidden).toHaveBeenCalledOnce();
    expect(cookies.decline).toHaveBeenCalledOnce();
  });
});
