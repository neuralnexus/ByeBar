import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../content/visibility.js', import.meta.url), 'utf8');

class FakeStyle {
  #values = new Map();
  #priorities = new Map();

  getPropertyValue(name) {
    return this.#values.get(name) || '';
  }

  getPropertyPriority(name) {
    return this.#priorities.get(name) || '';
  }

  setProperty(name, value, priority = '') {
    this.#values.set(name, String(value));
    this.#priorities.set(name, String(priority));
  }

  removeProperty(name) {
    this.#values.delete(name);
    this.#priorities.delete(name);
  }
}

class FakeElement {
  #attributes = new Map();

  constructor() {
    this.nodeType = 1;
    this.isConnected = true;
    this.style = new FakeStyle();
  }

  getAttribute(name) {
    return this.#attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.#attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.#attributes.delete(name);
  }
}

function loadVisibility() {
  const ByeBar = {};
  const document = {
    documentElement: { toggleAttribute: vi.fn() },
    querySelectorAll: () => []
  };
  class MutationObserver {
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  const context = vm.createContext({
    window: { ByeBar },
    document,
    MutationObserver,
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame: vi.fn(),
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
    getComputedStyle: () => ({ display: 'none', visibility: 'hidden' }),
    console
  });
  vm.runInContext(source, context);
  return ByeBar.visibility;
}

describe('visibility action ownership', () => {
  it('forgets Undo metadata without restoring the marker or display state', () => {
    const visibility = loadVisibility();
    const element = new FakeElement();
    element.style.setProperty('display', 'grid', 'important');

    expect(visibility.hide(element, 'generic', { actionId: 'action-1' })).toBe(true);
    expect(visibility.hasAction('action-1')).toBe(true);
    expect(element.getAttribute('data-byebar-hidden')).toBe('generic');
    expect(element.style.getPropertyValue('display')).toContain('--byebar-hidden-display');

    expect(visibility.forgetAction('action-1')).toBe(true);
    expect(visibility.hasAction('action-1')).toBe(false);
    expect(element.getAttribute('data-byebar-hidden')).toBe('generic');
    expect(element.style.getPropertyValue('display')).toContain('--byebar-hidden-display');

    visibility.restore('generic');
    expect(element.getAttribute('data-byebar-hidden')).toBeNull();
    expect(element.style.getPropertyValue('display')).toBe('grid');
    expect(element.style.getPropertyPriority('display')).toBe('important');
  });
});
