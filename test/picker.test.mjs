import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../content/picker.js', import.meta.url), 'utf8');

function createInteractiveDocument(visibilityState) {
  let pickerHost = null;
  const document = {
    visibilityState,
    fullscreenElement: null,
    activeElement: null,
    addEventListener() {},
    hasFocus: () => false,
    querySelector: () => null,
    elementsFromPoint: () => [],
    elementFromPoint: () => pickerHost
  };

  function element(tagName) {
    const attributes = new Map();
    const classes = new Set();
    const listeners = new Map();
    const value = {
      nodeType: 1,
      tagName: tagName.toUpperCase(),
      style: {
        setProperty(name, propertyValue) {
          this[name] = propertyValue;
        },
        removeProperty(name) {
          delete this[name];
        }
      },
      dataset: {},
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name))
      },
      isConnected: false,
      append(...children) {
        this.children.push(...children);
      },
      children: [],
      setAttribute(name, attributeValue) {
        attributes.set(name, String(attributeValue));
      },
      getAttribute(name) {
        return attributes.get(name) ?? null;
      },
      hasAttribute(name) {
        return attributes.has(name);
      },
      removeAttribute(name) {
        attributes.delete(name);
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      attachShadow() {
        return { activeElement: null, append: (...children) => this.children.push(...children) };
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
      },
      focus() {
        document.activeElement = this;
      },
      remove() {
        this.isConnected = false;
        if (pickerHost === this) pickerHost = null;
      }
    };
    return value;
  }

  document.documentElement = element('html');
  document.documentElement.isConnected = true;
  document.documentElement.append = (child) => {
    child.isConnected = true;
    if (child.hasAttribute('data-byebar-picker-root')) pickerHost = child;
  };
  document.body = element('body');
  document.body.isConnected = true;
  document.createElement = (tagName) => element(tagName);
  return document;
}

function loadPicker(
  loadSettings,
  {
    visibilityState = 'visible',
    closedRootAccess = true,
    navigationAvailable = true,
    interactiveDocument = false,
    topLayerResult = { element: null, selector: '', exhausted: false, inspected: 0 }
  } = {}
) {
  const windowListeners = {};
  const documentListeners = {};
  const engine = {
    loadSettings: vi.fn(loadSettings),
    resumeAutomation: vi.fn(),
    siteEnabled: () => true
  };
  const document = interactiveDocument
    ? createInteractiveDocument(visibilityState)
    : {
        visibilityState,
        fullscreenElement: null,
        documentElement: {},
        addEventListener(type, listener) {
          documentListeners[type] = listener;
        }
      };
  if (interactiveDocument) {
    document.addEventListener = (type, listener) => {
      documentListeners[type] = listener;
    };
  }
  const ByeBar = {
    engine,
    lib: {
      pick: {
        composedParent: () => null,
        resolvePickCandidate: () => null,
        isSafePickTarget: () => true
      }
    },
    actions: {},
    visibility: {
      isHidden: () => false,
      restoreAction: vi.fn(() => []),
      syncScrollLock: vi.fn(),
      isActionRetained: () => true
    },
    shadow: {
      findIncludingClosed: vi.fn(() => topLayerResult),
      queryIncludingClosed: () => null,
      canInspectClosedRoots: () => closedRootAccess,
      openOrClosedRoot: (element) => element?.shadowRoot || null
    }
  };
  const window = {
    ByeBar,
    innerWidth: 1200,
    innerHeight: 800,
    navigation: navigationAvailable
      ? {
          currentEntry: { id: 'navigation-id', key: 'navigation-key', index: 0 },
          addEventListener(type, listener) {
            windowListeners[`navigation:${type}`] = listener;
          }
        }
      : undefined,
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
    Date,
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame: vi.fn(),
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', position: 'static' }),
    console
  });
  vm.runInContext(source, context);
  return { picker: ByeBar.picker, document, engine, windowListeners, documentListeners };
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
    expect(picker.state()).toEqual({ active: true, available: true, busy: true, sessionId: 'pick-1' });

    const event = { preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    windowListeners.pointerdown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(starting).resolves.toEqual({ ok: false, error: { code: 'settings-timeout' } });
    expect(picker.state()).toEqual({ active: false, available: true, busy: false, sessionId: '' });
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

  it('stops immediately when effective settings are disabled while starting', async () => {
    let resolveSettings;
    const settings = new Promise((resolve) => {
      resolveSettings = resolve;
    });
    const loaded = loadPicker(() => settings);

    const starting = loaded.picker.start('pick-1');
    loaded.picker.onEffectiveSettingsChanged({ enabled: false });
    expect(loaded.picker.state()).toEqual({ active: false, available: true, busy: false, sessionId: '' });

    resolveSettings({});
    await expect(starting).resolves.toEqual({ ok: false, error: { code: 'picker-cancelled' } });
    expect(loaded.engine.resumeAutomation).not.toHaveBeenCalled();
  });

  it('does not expose Pick without Navigation API entry identity', async () => {
    const loaded = loadPicker(async () => ({}), { navigationAvailable: false });

    expect(loaded.picker.available()).toBe(false);
    await expect(loaded.picker.start('pick-1')).resolves.toEqual({
      ok: false,
      error: { code: 'picker-unavailable' }
    });
    expect(loaded.engine.loadSettings).not.toHaveBeenCalled();
  });

  it('does not expose Pick when closed page components cannot be inspected', async () => {
    const loaded = loadPicker(async () => ({}), { closedRootAccess: false });

    expect(loaded.picker.available()).toBe(false);
    await expect(loaded.picker.start('pick-1')).resolves.toEqual({
      ok: false,
      error: { code: 'picker-unavailable' }
    });
    expect(loaded.engine.loadSettings).not.toHaveBeenCalled();
  });

  it('fails closed when the bounded top-layer scan is exhausted', async () => {
    const loaded = loadPicker(async () => ({}), {
      topLayerResult: { element: null, selector: '', exhausted: true, inspected: 5_000 }
    });

    await expect(loaded.picker.start('pick-1')).resolves.toEqual({
      ok: false,
      error: { code: 'top-layer-active' }
    });
    expect(loaded.engine.loadSettings).not.toHaveBeenCalled();
  });

  it('does not extend one pointer gesture deadline across repeated Navigation API events', async () => {
    vi.useFakeTimers();
    const loaded = loadPicker(async () => ({}), { interactiveDocument: true });
    await expect(loaded.picker.start('pick-1')).resolves.toEqual({ ok: true });
    const pointerdown = {
      type: 'pointerdown',
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 500,
      clientY: 500,
      isTrusted: true,
      isPrimary: true,
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      cancelable: true,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn()
    };

    loaded.windowListeners.pointerdown(pointerdown);
    loaded.windowListeners['navigation:currententrychange']();
    expect(loaded.picker.state().busy).toBe(true);

    for (const elapsed of [300, 300, 300]) {
      await vi.advanceTimersByTimeAsync(elapsed);
      loaded.windowListeners['navigation:currententrychange']();
    }
    await vi.advanceTimersByTimeAsync(600);

    expect(loaded.picker.state()).toEqual({
      active: false,
      available: true,
      busy: false,
      sessionId: ''
    });
  });

  it('preserves a synchronous page tabindex change while restoring focus', async () => {
    const loaded = loadPicker(async () => ({}), { interactiveDocument: true });
    const target = loaded.document.body;
    target.setAttribute('tabindex', '0');
    target.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 20,
      bottom: 20,
      width: 20,
      height: 20
    });
    target.focus = () => {
      loaded.document.activeElement = target;
      target.setAttribute('tabindex', '7');
    };
    loaded.document.activeElement = target;
    loaded.document.hasFocus = () => true;

    await expect(loaded.picker.start('pick-1')).resolves.toEqual({ ok: true });
    expect(loaded.picker.cancel('pick-1')).toEqual({ ok: true });

    expect(target.getAttribute('tabindex')).toBe('7');
  });
});
