import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import * as settings from '../lib/settings.mjs';

const source = readFileSync(new URL('../content/engine.js', import.meta.url), 'utf8');

function loadEngine(storageGet) {
  const listeners = {};
  const cookies = { decline: vi.fn(), closestBanner: () => null };
  const visibility = {
    ensureHidden: vi.fn(),
    restore: vi.fn(),
    restoreAll: vi.fn(),
    syncScrollLock: vi.fn()
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
  return { engine: ByeBar.engine, listeners, cookies };
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
});
