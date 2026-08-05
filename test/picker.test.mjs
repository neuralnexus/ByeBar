import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../content/picker.js', import.meta.url), 'utf8');

function loadPicker(loadSettings, { visibilityState = 'visible' } = {}) {
  const windowListeners = {};
  const documentListeners = {};
  const engine = {
    loadSettings: vi.fn(loadSettings),
    resumeAutomation: vi.fn(),
    siteEnabled: () => true
  };
  const document = {
    visibilityState,
    fullscreenElement: null,
    documentElement: {},
    addEventListener(type, listener) {
      documentListeners[type] = listener;
    }
  };
  const ByeBar = {
    engine,
    shadow: { query: () => null }
  };
  const window = {
    ByeBar,
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener(type, listener) {
      windowListeners[type] = listener;
    }
  };
  window.top = window;
  const context = vm.createContext({
    window,
    document,
    location: { href: 'https://example.com/article' },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    cancelAnimationFrame: vi.fn(),
    console
  });
  vm.runInContext(source, context);
  return { picker: ByeBar.picker, engine, windowListeners, documentListeners };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('picker lifecycle', () => {
  it('times out a stalled settings read without capturing page input or resuming unsafe defaults', async () => {
    vi.useFakeTimers();
    const pendingSettings = new Promise(() => {});
    const { picker, engine, windowListeners } = loadPicker(() => pendingSettings);

    const starting = picker.start('pick-1');
    expect(picker.state()).toEqual({ active: true, busy: true, sessionId: 'pick-1' });

    const event = { preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    windowListeners.pointerdown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(starting).resolves.toEqual({ ok: false, error: { code: 'settings-timeout' } });
    expect(picker.state()).toEqual({ active: false, busy: false, sessionId: '' });
    expect(engine.resumeAutomation).not.toHaveBeenCalled();
  });

  it('refuses to start on a hidden document', async () => {
    const loaded = loadPicker(async () => ({}), { visibilityState: 'hidden' });

    await expect(loaded.picker.start('pick-1')).resolves.toEqual({
      ok: false,
      error: { code: 'page-hidden' }
    });
    expect(loaded.engine.loadSettings).not.toHaveBeenCalled();
  });
});
