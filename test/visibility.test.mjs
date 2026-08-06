import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    this.children = [];
    this.parentElement = null;
    this.closedRoot = null;
  }

  getAttribute(name) {
    return this.#attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.#attributes.set(name, String(value));
  }

  hasAttribute(name) {
    return this.#attributes.has(name);
  }

  removeAttribute(name) {
    this.#attributes.delete(name);
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    return siblings[siblings.indexOf(this) + 1] || null;
  }

  querySelectorAll(selector) {
    const attribute = /^\[([^\]]+)\]$/.exec(selector)?.[1];
    const matches = [];
    const visit = (element) => {
      if (attribute && element.hasAttribute(attribute)) matches.push(element);
      element.children.forEach(visit);
    };
    this.children.forEach(visit);
    return matches;
  }
}

function loadVisibility(copies = [], { liveTimers = false } = {}) {
  const observers = [];
  const frames = new Map();
  let frameSequence = 0;
  const suppress = vi.fn();
  const ByeBar = {
    actions: { suppress },
    shadow: { openOrClosedRoot: (element) => element?.closedRoot || null }
  };
  const documentElement = new FakeElement();
  documentElement.toggleAttribute = vi.fn();
  const document = {
    nodeType: 9,
    documentElement,
    firstElementChild: documentElement,
    querySelectorAll: (selector) => documentElement.querySelectorAll(selector)
  };
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.observations = [];
      observers.push(this);
    }

    observe(target, options) {
      this.observations = this.observations.filter((observation) => observation.target !== target);
      this.observations.push({ target, options });
    }

    disconnect() {
      this.observations = [];
    }

    takeRecords() {
      return [];
    }
  }
  const context = vm.createContext({
    window: { ByeBar },
    document,
    MutationObserver,
    requestAnimationFrame: vi.fn((callback) => {
      frameSequence += 1;
      frames.set(frameSequence, callback);
      return frameSequence;
    }),
    cancelAnimationFrame: vi.fn((id) => frames.delete(id)),
    setTimeout: liveTimers ? setTimeout : vi.fn(() => 1),
    clearTimeout: liveTimers ? clearTimeout : vi.fn(),
    Date,
    getComputedStyle: () => ({ display: 'none', visibility: 'hidden' }),
    console
  });
  vm.runInContext(source, context);
  ByeBar.visibility.scrollToggle = document.documentElement.toggleAttribute;
  ByeBar.visibility.rootElement = documentElement;
  ByeBar.visibility.rootStyle = documentElement.style;
  ByeBar.visibility.suppress = suppress;
  ByeBar.visibility.flushFrames = () => {
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback();
    }
  };
  ByeBar.visibility.notifyStyle = (element) => {
    observers
      .filter((observer) =>
        observer.observations.some(
          (observation) =>
            observation.target === element && observation.options.attributeFilter?.includes('style')
        )
      )
      .forEach((observer) => observer.callback([{ type: 'attributes', target: element }]));
  };
  ByeBar.visibility.notifyAdded = (root, descendants = []) => {
    const mounted = [root, ...descendants];
    if (!root.parentElement) documentElement.append(root);
    mounted.forEach((element) => {
      element.isConnected = true;
      if (!copies.includes(element)) copies.push(element);
    });
    observers
      .filter((observer) => observer.observations.some((observation) => observation.options.childList))
      .forEach((observer) => observer.callback([{ type: 'childList', addedNodes: [root] }]));
  };
  ByeBar.visibility.notifyRemoved = (root) => {
    root.isConnected = false;
    observers
      .filter((observer) => observer.observations.some((observation) => observation.options.childList))
      .forEach((observer) =>
        observer.callback([{ type: 'childList', addedNodes: [], removedNodes: [root] }])
      );
  };
  return ByeBar.visibility;
}

function copyHiddenState(sourceElement, copy) {
  ['data-byebar-hidden', 'data-byebar-action-copy-7c6f2a'].forEach((attribute) => {
    const value = sourceElement.getAttribute(attribute);
    if (value !== null) copy.setAttribute(attribute, value);
  });
  ['--byebar-hidden-display-7c6f2a', 'display'].forEach((property) => {
    const value = sourceElement.style.getPropertyValue(property);
    if (value) copy.style.setProperty(property, value, sourceElement.style.getPropertyPriority(property));
  });
}

afterEach(() => {
  vi.useRealTimers();
});

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

  it('detects stripped hide ownership and rolls an uncommitted action back cleanly', () => {
    const visibility = loadVisibility();
    const element = new FakeElement();
    element.style.setProperty('display', 'grid', 'important');

    expect(visibility.hide(element, 'manual', { actionId: 'pending-action' })).toBe(true);
    expect(visibility.isActionRetained('pending-action')).toBe(true);

    element.removeAttribute('data-byebar-hidden');
    element.style.removeProperty('display');
    element.style.removeProperty('--byebar-hidden-display-7c6f2a');

    expect(visibility.isActionRetained('pending-action')).toBe(false);
    expect(visibility.restoreAction('pending-action')).toHaveLength(1);
    expect(visibility.hasAction('pending-action')).toBe(false);
    expect(element.getAttribute('data-byebar-hidden')).toBeNull();
    expect(element.style.getPropertyValue('display')).toBe('grid');
    expect(element.style.getPropertyPriority('display')).toBe('important');
  });

  it('does not retain action ownership for a disconnected target', () => {
    const visibility = loadVisibility();
    const element = new FakeElement();

    expect(visibility.hide(element, 'manual', { actionId: 'detached-action' })).toBe(true);
    element.isConnected = false;

    expect(visibility.isActionRetained('detached-action')).toBe(false);
    expect(visibility.restoreAction('detached-action')).toHaveLength(1);
    expect(visibility.hasAction('detached-action')).toBe(false);
  });

  it('restores a page-created copy of a disconnected provisional target', () => {
    const copy = new FakeElement();
    const visibility = loadVisibility([copy]);
    const original = new FakeElement();
    original.style.setProperty('display', 'grid', 'important');

    expect(visibility.hide(original, 'manual', { actionId: 'pending-action', trackCopies: true })).toBe(true);
    copy.setAttribute('data-byebar-hidden', original.getAttribute('data-byebar-hidden'));
    copy.setAttribute(
      'data-byebar-action-copy-7c6f2a',
      original.getAttribute('data-byebar-action-copy-7c6f2a')
    );
    copy.style.setProperty(
      '--byebar-hidden-display-7c6f2a',
      original.style.getPropertyValue('--byebar-hidden-display-7c6f2a'),
      original.style.getPropertyPriority('--byebar-hidden-display-7c6f2a')
    );
    copy.style.setProperty(
      'display',
      original.style.getPropertyValue('display'),
      original.style.getPropertyPriority('display')
    );
    visibility.notifyAdded(copy);
    original.isConnected = false;

    expect(visibility.isActionRetained('pending-action')).toBe(true);
    expect(visibility.restoreAction('pending-action')).toHaveLength(2);
    expect(copy.getAttribute('data-byebar-hidden')).toBeNull();
    expect(copy.getAttribute('data-byebar-action-copy-7c6f2a')).toBeNull();
    expect(copy.style.getPropertyValue('display')).toBe('grid');
    expect(copy.style.getPropertyPriority('display')).toBe('important');
    expect(copy.style.getPropertyValue('--byebar-hidden-display-7c6f2a')).toBe('');
  });

  it('restores nested detached copies mounted after rollback from their embedded inline snapshots', () => {
    const copies = [];
    const visibility = loadVisibility(copies);
    const parent = new FakeElement();
    const child = new FakeElement();
    parent.style.setProperty('display', 'grid', 'important');
    parent.style.setProperty('--byebar-hidden-display-7c6f2a', 'parent-fallback');
    child.style.setProperty('display', 'flex');
    child.style.setProperty('--byebar-hidden-display-7c6f2a', 'child-fallback', 'important');

    visibility.hide(parent, 'manual', { actionId: 'parent-action', trackCopies: true });
    visibility.hide(child, 'manual', { actionId: 'child-action', trackCopies: true });
    const lateParent = new FakeElement();
    const lateChild = new FakeElement();
    lateParent.isConnected = false;
    lateChild.isConnected = false;
    copyHiddenState(parent, lateParent);
    copyHiddenState(child, lateChild);
    lateChild.style.setProperty('--byebar-hidden-display-7c6f2a', 'page-override');
    lateParent.append(lateChild);

    visibility.restoreAction('parent-action');
    visibility.restoreAction('child-action');
    expect(lateParent.style.getPropertyValue('display')).toContain('--byebar-action-active');
    expect(lateChild.style.getPropertyValue('display')).toContain('--byebar-action-active');

    visibility.notifyAdded(lateParent, [lateChild]);

    expect(lateParent.getAttribute('data-byebar-hidden')).toBeNull();
    expect(lateParent.getAttribute('data-byebar-action-copy-7c6f2a')).toBeNull();
    expect(lateParent.style.getPropertyValue('display')).toBe('grid');
    expect(lateParent.style.getPropertyPriority('display')).toBe('important');
    expect(lateParent.style.getPropertyValue('--byebar-hidden-display-7c6f2a')).toBe('parent-fallback');
    expect(lateChild.getAttribute('data-byebar-hidden')).toBeNull();
    expect(lateChild.getAttribute('data-byebar-action-copy-7c6f2a')).toBeNull();
    expect(lateChild.style.getPropertyValue('display')).toBe('flex');
    expect(lateChild.style.getPropertyValue('--byebar-hidden-display-7c6f2a')).toBe('page-override');
    expect(lateChild.style.getPropertyPriority('--byebar-hidden-display-7c6f2a')).toBe('');
  });

  it('transfers expired original ownership to a connected copy before final retention cleanup', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const copies = [];
    const visibility = loadVisibility(copies, { liveTimers: true });
    const original = new FakeElement();
    original.style.setProperty('display', 'grid', 'important');

    visibility.hide(original, 'manual', {
      actionId: 'forgotten-action',
      blocksScroll: true,
      trackCopies: true
    });
    const connectedCopy = new FakeElement();
    const lateCopy = new FakeElement();
    lateCopy.isConnected = false;
    copyHiddenState(original, connectedCopy);
    copyHiddenState(original, lateCopy);
    visibility.notifyAdded(connectedCopy);

    expect(visibility.forgetAction('forgotten-action')).toBe(true);
    expect(visibility.hasAction('forgotten-action')).toBe(false);
    expect(original.getAttribute('data-byebar-hidden')).toBe('manual');
    expect(connectedCopy.getAttribute('data-byebar-hidden')).toBe('manual');
    visibility.syncScrollLock();

    original.isConnected = false;
    await vi.advanceTimersByTimeAsync(40_000);

    expect(connectedCopy.getAttribute('data-byebar-hidden')).toBe('manual');
    expect(connectedCopy.getAttribute('data-byebar-action-copy-7c6f2a')).not.toBeNull();
    expect(connectedCopy.style.getPropertyValue('display')).toContain('--byebar-action-active');
    expect(visibility.scrollToggle).toHaveBeenLastCalledWith('data-byebar-scroll-unlock', true);

    visibility.notifyRemoved(connectedCopy);
    await vi.advanceTimersByTimeAsync(40_000);

    expect(connectedCopy.getAttribute('data-byebar-hidden')).toBeNull();
    expect(connectedCopy.getAttribute('data-byebar-action-copy-7c6f2a')).toBeNull();
    expect(connectedCopy.style.getPropertyValue('display')).toBe('grid');
    visibility.notifyAdded(lateCopy);
    expect(lateCopy.getAttribute('data-byebar-hidden')).toBeNull();
    expect(lateCopy.getAttribute('data-byebar-action-copy-7c6f2a')).toBeNull();
    expect(lateCopy.style.getPropertyValue('display')).toBe('grid');
    expect(visibility.scrollToggle).toHaveBeenLastCalledWith('data-byebar-scroll-unlock', false);
  });

  it('deactivates an undiscovered detached copy without waiting for a root observer', () => {
    const visibility = loadVisibility();
    const original = new FakeElement();
    original.style.setProperty('display', 'grid');

    visibility.hide(original, 'manual', { actionId: 'closed-root-action', trackCopies: true });
    const lateCopy = new FakeElement();
    lateCopy.isConnected = false;
    copyHiddenState(original, lateCopy);
    const marker = JSON.parse(lateCopy.getAttribute('data-byebar-action-copy-7c6f2a'));

    expect(visibility.rootStyle.getPropertyValue(marker.a)).toContain('--byebar-hidden-display');
    visibility.restoreAction('closed-root-action');

    expect(visibility.rootStyle.getPropertyValue(marker.a)).toBe('');
    expect(lateCopy.getAttribute('data-byebar-action-copy-7c6f2a')).not.toBeNull();
    expect(lateCopy.style.getPropertyValue('display')).toBe(`var(${marker.a}, grid)`);
  });

  it('enforces active copies and restores their latest page-owned display state', () => {
    const copies = [];
    const visibility = loadVisibility(copies);
    const original = new FakeElement();
    original.style.setProperty('display', 'grid');
    visibility.hide(original, 'manual', { actionId: 'copy-action', trackCopies: true });

    const copy = new FakeElement();
    copyHiddenState(original, copy);
    visibility.notifyAdded(copy);
    copy.style.setProperty('display', 'flex');
    copy.style.setProperty('--byebar-hidden-display-7c6f2a', 'page-fallback');
    visibility.notifyStyle(copy);
    visibility.flushFrames();

    expect(copy.style.getPropertyValue('display')).toContain('--byebar-action-active');
    expect(copy.style.getPropertyValue('--byebar-hidden-display-7c6f2a')).toBe('none');
    expect(visibility.restoreAction('copy-action')).toHaveLength(2);
    expect(copy.style.getPropertyValue('display')).toBe('flex');
    expect(copy.style.getPropertyValue('--byebar-hidden-display-7c6f2a')).toBe('page-fallback');
  });

  it('restores a retained copy even after the page strips its marker', () => {
    const visibility = loadVisibility();
    const original = new FakeElement();
    original.style.setProperty('display', 'grid');
    visibility.hide(original, 'manual', { actionId: 'stripped-copy', trackCopies: true });
    const copy = new FakeElement();
    copyHiddenState(original, copy);
    visibility.notifyAdded(copy);
    copy.style.setProperty('display', 'flex');
    copy.style.setProperty('--byebar-hidden-display-7c6f2a', 'page-fallback');
    visibility.notifyStyle(copy);
    visibility.flushFrames();
    expect(copy.style.getPropertyValue('display')).toContain('--byebar-action-active');

    copy.removeAttribute('data-byebar-action-copy-7c6f2a');
    visibility.notifyStyle(copy);
    visibility.flushFrames();
    expect(copy.getAttribute('data-byebar-action-copy-7c6f2a')).toBeNull();
    expect(visibility.restoreAction('stripped-copy')).toHaveLength(2);

    expect(copy.getAttribute('data-byebar-hidden')).toBeNull();
    expect(copy.style.getPropertyValue('display')).toBe('flex');
    expect(copy.style.getPropertyValue('--byebar-hidden-display-7c6f2a')).toBe('page-fallback');
  });

  it('suppresses a late copy when its retired marker is restored', () => {
    const visibility = loadVisibility();
    const original = new FakeElement();
    original.style.setProperty('display', 'grid');
    visibility.hide(original, 'manual', { actionId: 'retired-copy', trackCopies: true });
    const lateCopy = new FakeElement();
    copyHiddenState(original, lateCopy);

    visibility.restoreAction('retired-copy');
    visibility.suppress.mockClear();
    visibility.notifyAdded(lateCopy);

    expect(visibility.suppress).toHaveBeenCalledWith(lateCopy);
    expect(lateCopy.getAttribute('data-byebar-hidden')).toBeNull();
    expect(lateCopy.getAttribute('data-byebar-action-copy-7c6f2a')).toBeNull();
    expect(lateCopy.style.getPropertyValue('display')).toBe('grid');
  });

  it('reasserts an active root variable and restores the latest page-owned declaration', () => {
    const visibility = loadVisibility();
    const original = new FakeElement();
    visibility.hide(original, 'manual', { actionId: 'root-variable', trackCopies: true });
    const marker = JSON.parse(original.getAttribute('data-byebar-action-copy-7c6f2a'));

    visibility.rootStyle.setProperty('color', 'rebeccapurple');
    visibility.rootStyle.setProperty(marker.a, 'page-owned', '');
    visibility.notifyStyle(visibility.rootElement);

    expect(visibility.rootStyle.getPropertyValue(marker.a)).toContain('--byebar-hidden-display');
    expect(visibility.rootStyle.getPropertyPriority(marker.a)).toBe('important');
    expect(visibility.rootStyle.getPropertyValue('color')).toBe('rebeccapurple');

    visibility.restoreAction('root-variable');
    expect(visibility.rootStyle.getPropertyValue(marker.a)).toBe('page-owned');
    expect(visibility.rootStyle.getPropertyPriority(marker.a)).toBe('');
    expect(visibility.rootStyle.getPropertyValue('color')).toBe('rebeccapurple');
  });

  it('discovers a late closed root incrementally without rescanning the whole document at once', async () => {
    vi.useFakeTimers();
    const visibility = loadVisibility([], { liveTimers: true });
    const original = new FakeElement();
    original.style.setProperty('display', 'grid');
    for (let index = 0; index < 501; index += 1) {
      visibility.rootElement.append(new FakeElement());
    }
    const host = new FakeElement();
    visibility.rootElement.append(host);

    visibility.hide(original, 'manual', { actionId: 'late-root', trackCopies: true });
    await vi.advanceTimersByTimeAsync(250);

    const root = new FakeElement();
    root.nodeType = 11;
    const copy = new FakeElement();
    copyHiddenState(original, copy);
    copy.style.setProperty('display', 'flex');
    root.append(copy);
    host.closedRoot = root;

    await vi.advanceTimersByTimeAsync(2_000);
    expect(copy.style.getPropertyValue('display')).toBe('flex');

    await vi.advanceTimersByTimeAsync(250);
    expect(copy.style.getPropertyValue('display')).toContain('--byebar-action-active');
    expect(visibility.restoreAction('late-root')).toContain(copy);
    expect(copy.style.getPropertyValue('display')).toBe('flex');
  });

  it('keeps nested active markers enrolled until each action retires', () => {
    const visibility = loadVisibility();
    const original = new FakeElement();
    original.style.setProperty('display', 'grid');
    visibility.hide(original, 'manual', { actionId: 'outer-copy', trackCopies: true });
    visibility.hide(original, 'manual', { actionId: 'inner-copy', trackCopies: true });
    const copy = new FakeElement();
    copyHiddenState(original, copy);
    visibility.notifyAdded(copy);

    visibility.restoreAction('outer-copy');
    expect(copy.getAttribute('data-byebar-hidden')).toBe('manual');
    expect(copy.getAttribute('data-byebar-action-copy-7c6f2a')).not.toBeNull();

    visibility.restoreAction('inner-copy');
    expect(copy.getAttribute('data-byebar-hidden')).toBeNull();
    expect(copy.getAttribute('data-byebar-action-copy-7c6f2a')).toBeNull();
    expect(copy.style.getPropertyValue('display')).toBe('grid');
  });

  it('transitions markerless display ownership to a remaining hide reason', () => {
    const visibility = loadVisibility();
    const element = new FakeElement();
    element.style.setProperty('display', 'grid');
    visibility.hide(element, 'generic');
    visibility.hide(element, 'manual', { actionId: 'layered-copy', trackCopies: true });
    element.removeAttribute('data-byebar-action-copy-7c6f2a');

    visibility.restoreAction('layered-copy');

    expect(element.getAttribute('data-byebar-hidden')).toBe('generic');
    expect(element.style.getPropertyValue('display')).toContain('--byebar-hidden-display-7c6f2a');
    expect(element.style.getPropertyValue('display')).not.toContain('--byebar-action-active');

    visibility.restore('generic');
    expect(element.getAttribute('data-byebar-hidden')).toBeNull();
    expect(element.style.getPropertyValue('display')).toBe('grid');
  });

  it('keeps scroll ownership on an active copy and synchronizes immediately on restore', () => {
    const copies = [];
    const visibility = loadVisibility(copies);
    const original = new FakeElement();
    visibility.hide(original, 'manual', {
      actionId: 'scroll-copy-action',
      blocksScroll: true,
      trackCopies: true
    });
    const copy = new FakeElement();
    copyHiddenState(original, copy);
    visibility.notifyAdded(copy);
    original.isConnected = false;
    visibility.scrollToggle.mockClear();

    visibility.syncScrollLock();
    expect(visibility.scrollToggle).toHaveBeenLastCalledWith('data-byebar-scroll-unlock', true);
    visibility.restoreAction('scroll-copy-action');
    expect(visibility.scrollToggle).toHaveBeenLastCalledWith('data-byebar-scroll-unlock', false);
  });

  it('finds scroll ownership in a newly enrolled copy', () => {
    const copies = [];
    const visibility = loadVisibility(copies);
    const original = new FakeElement();
    visibility.hide(original, 'manual', {
      actionId: 'unobserved-scroll-copy',
      blocksScroll: true,
      trackCopies: true
    });
    const copy = new FakeElement();
    copyHiddenState(original, copy);
    visibility.notifyAdded(copy);
    original.isConnected = false;
    visibility.scrollToggle.mockClear();

    visibility.syncScrollLock();
    expect(visibility.scrollToggle).toHaveBeenLastCalledWith('data-byebar-scroll-unlock', true);
    visibility.restoreAction('unobserved-scroll-copy');
    expect(visibility.scrollToggle).toHaveBeenLastCalledWith('data-byebar-scroll-unlock', false);
  });

  it('releases scroll unlocking immediately when a manual blocker is removed', () => {
    const visibility = loadVisibility();
    const element = new FakeElement();

    visibility.hide(element, 'manual', {
      actionId: 'removed-blocker',
      blocksScroll: true,
      trackCopies: true
    });
    expect(visibility.scrollToggle).toHaveBeenLastCalledWith('data-byebar-scroll-unlock', true);

    visibility.notifyRemoved(element);

    expect(visibility.scrollToggle).toHaveBeenLastCalledWith('data-byebar-scroll-unlock', false);
    expect(visibility.hasAction('removed-blocker')).toBe(true);
  });

  it('restores scroll unlocking when a marker-stripped blocker is reinserted', () => {
    const visibility = loadVisibility();
    const element = new FakeElement();

    visibility.hide(element, 'manual', {
      actionId: 'reinserted-blocker',
      blocksScroll: true,
      trackCopies: true
    });
    element.removeAttribute('data-byebar-action-copy-7c6f2a');
    visibility.notifyRemoved(element);
    expect(visibility.scrollToggle).toHaveBeenLastCalledWith('data-byebar-scroll-unlock', false);

    visibility.notifyAdded(element);

    expect(visibility.scrollToggle).toHaveBeenLastCalledWith('data-byebar-scroll-unlock', true);
    expect(visibility.hasAction('reinserted-blocker')).toBe(true);
  });

  it('prunes disconnected blockers even while another blocker keeps scrolling unlocked', () => {
    const visibility = loadVisibility();
    const first = new FakeElement();
    const second = new FakeElement();
    visibility.hide(first, 'manual', { actionId: 'first-blocker', blocksScroll: true });
    visibility.hide(second, 'manual', { actionId: 'second-blocker', blocksScroll: true });

    second.isConnected = false;
    visibility.syncScrollLock();
    expect(visibility.scrollToggle).toHaveBeenLastCalledWith('data-byebar-scroll-unlock', true);

    first.isConnected = false;
    second.isConnected = true;
    visibility.syncScrollLock();
    expect(visibility.scrollToggle).toHaveBeenLastCalledWith('data-byebar-scroll-unlock', false);
  });
});
