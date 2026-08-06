import { describe, expect, it } from 'vitest';
import { composedParent, isSafePickTarget, resolvePickCandidate } from '../lib/pick-heuristics.mjs';

const viewport = { width: 1200, height: 800 };
const visibleRect = { left: 350, top: 200, width: 500, height: 300, right: 850, bottom: 500 };

function mockElement({
  tagName = 'DIV',
  id = '',
  role = '',
  ariaModal = '',
  href = null,
  tabIndex = null,
  controls = false,
  parentElement = null,
  ownerDocument = null,
  rect = visibleRect,
  style = {},
  containsLandmark = false,
  open = false,
  modal = false,
  isConnected = true,
  root = null,
  shadowRoot = null,
  localName = String(tagName).toLowerCase()
} = {}) {
  const element = {
    nodeType: 1,
    tagName,
    localName,
    id,
    parentElement,
    ownerDocument,
    open,
    isConnected,
    tabIndex: tabIndex ?? -1,
    shadowRoot,
    firstElementChild: null,
    nextElementSibling: null,
    styleFixture: { display: 'block', visibility: 'visible', opacity: '1', position: 'static', ...style },
    getAttribute(name) {
      if (name === 'role') return role;
      if (name === 'aria-modal') return ariaModal;
      if (name === 'href') return href;
      return '';
    },
    hasAttribute(name) {
      if (name === 'href') return href !== null;
      if (name === 'tabindex') return tabIndex !== null;
      if (name === 'controls') return controls;
      return false;
    },
    getBoundingClientRect() {
      return rect;
    },
    getRootNode() {
      return root || ownerDocument;
    },
    matches(selector) {
      if (selector === ':modal') return modal;
      const landmarkTags = { MAIN: 'main', ARTICLE: 'article', NAV: 'nav' };
      if (landmarkTags[tagName] && selector.includes(landmarkTags[tagName])) return true;
      return role
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .some((token) => selector.includes(`[role="${token}"]`) || selector.includes(`[role~="${token}" i]`));
    },
    contains(other) {
      let node = other;
      while (node) {
        if (node === this) return true;
        node = composedParent(node);
      }
      return false;
    }
  };
  if (containsLandmark) element.firstElementChild = mockElement({ tagName: 'MAIN' });
  return element;
}

function resolve(hit, overrides = {}) {
  return resolvePickCandidate(hit, {
    getStyle: (element) => element.styleFixture,
    viewport,
    isHidden: () => false,
    getShadowRoot: (element) => element.shadowRoot,
    canInspectClosedRoots: () => true,
    ...overrides
  });
}

describe('manual picker candidate policy', () => {
  it('promotes a nested control to its fixed interruption without invoking the control', () => {
    const popup = mockElement({ style: { position: 'fixed' } });
    const button = mockElement({ tagName: 'BUTTON', parentElement: popup });
    const label = mockElement({ tagName: 'SPAN', parentElement: button });

    expect(resolve(label)).toEqual({ target: popup, rect: visibleRect });
  });

  it('rejects an ordinary page control when there is no eligible container', () => {
    const section = mockElement();
    const link = mockElement({ tagName: 'A', href: '/checkout', parentElement: section });

    expect(resolve(link)).toBeNull();
  });

  it.each([
    { values: { tagName: 'A', href: '' }, label: 'empty-link anchor' },
    { values: { role: 'treeitem' }, label: 'ARIA tree item' },
    { values: { role: 'unknown BUTTON' }, label: 'fallback-role button' },
    { values: { role: 'menuitemcheckbox' }, label: 'ARIA menu item' },
    { values: { tabIndex: 0 }, label: 'focusable custom control' },
    { values: { tagName: 'VIDEO', controls: true }, label: 'native media control' }
  ])('rejects an interactive $label', ({ values }) => {
    expect(resolve(mockElement(values))).toBeNull();
  });

  it('still allows a focusable ARIA dialog container to be selected', () => {
    const dialog = mockElement({ role: 'dialog', tabIndex: 0, style: { position: 'fixed' } });
    expect(resolve(dialog)?.target).toBe(dialog);
  });

  it('recognizes a dialog token in a normalized fallback role list', () => {
    const dialog = mockElement({
      role: 'alertdialog DIALOG',
      tabIndex: 0,
      style: { position: 'fixed' }
    });
    expect(resolve(dialog)?.target).toBe(dialog);
  });

  it('uses the parent of a non-interactive inline hit', () => {
    const banner = mockElement();
    const copy = mockElement({ tagName: 'SPAN', parentElement: banner, style: { display: 'inline' } });

    expect(resolve(copy)?.target).toBe(banner);
  });

  it('rejects fixed picker UI inside the picker shadow root', () => {
    const pickerHost = mockElement();
    const pickerRoot = { nodeType: 11, host: pickerHost };
    const shield = mockElement({ root: pickerRoot, style: { position: 'fixed' } });

    expect(resolve(shield, { pickerHost })).toBeNull();
  });

  it.each([
    { values: { tagName: 'MAIN' }, label: 'page landmark' },
    { values: { id: '__next' }, label: 'application root' },
    { values: { id: 'app-root' }, label: 'hyphenated application root' },
    { values: { id: 'page' }, label: 'generic page root' },
    { values: { tagName: 'IFRAME' }, label: 'frame' },
    { values: { role: 'navigation' }, label: 'ARIA landmark' },
    { values: { role: 'dialog MAIN' }, label: 'protected fallback role' },
    { values: { containsLandmark: true }, label: 'landmark container' }
  ])('rejects a protected $label', ({ values }) => {
    expect(resolve(mockElement(values))).toBeNull();
  });

  it('rejects an open native modal dialog', () => {
    const dialog = mockElement({ tagName: 'DIALOG', open: true, modal: true, style: { position: 'fixed' } });
    const copy = mockElement({ tagName: 'P', parentElement: dialog });

    expect(resolve(copy)).toBeNull();
  });

  it('rejects hidden, offscreen, and already hidden candidates', () => {
    const invisible = mockElement({ style: { opacity: '0' } });
    const offscreen = mockElement({
      rect: { left: 1300, top: 0, width: 100, height: 100, right: 1400, bottom: 100 }
    });
    const marked = mockElement();

    expect(resolve(invisible)).toBeNull();
    expect(resolve(offscreen)).toBeNull();
    expect(resolve(marked, { isHidden: (element) => element === marked })).toBeNull();
  });

  it('rejects candidates in fullscreen or another document', () => {
    const currentDocument = {};
    const otherDocument = {};
    const fullscreen = mockElement({ ownerDocument: currentDocument });
    const child = mockElement({ parentElement: fullscreen, ownerDocument: currentDocument });
    const foreign = mockElement({ ownerDocument: otherDocument });

    expect(resolve(child, { documentRoot: currentDocument, fullscreenElement: fullscreen })).toBeNull();
    expect(resolve(foreign, { documentRoot: currentDocument })).toBeNull();
  });

  it('allows an inspectable shadow-host overlay without protected landmarks', () => {
    const shadowRoot = {
      host: null,
      nodeType: 11,
      firstElementChild: null,
      querySelector: () => null,
      querySelectorAll: () => []
    };
    const host = mockElement({
      tagName: 'NOTICE-OVERLAY',
      style: { position: 'sticky' },
      shadowRoot
    });
    shadowRoot.host = host;
    const hit = mockElement({ tagName: 'SPAN', root: shadowRoot });

    expect(composedParent(hit)).toBe(host);
    expect(resolve(hit)?.target).toBe(host);
  });

  it('rejects a promoted host containing a protected landmark in an open shadow root', () => {
    const landmark = mockElement({ tagName: 'MAIN' });
    const shadowRoot = {
      host: null,
      nodeType: 11,
      firstElementChild: landmark,
      querySelector: () => ({}),
      querySelectorAll: () => []
    };
    const host = mockElement({
      tagName: 'PAGE-SHELL',
      style: { position: 'fixed' },
      shadowRoot
    });
    shadowRoot.host = host;
    const hit = mockElement({ tagName: 'SPAN', root: shadowRoot });

    expect(resolve(hit)).toBeNull();
  });

  it('rejects a shadow wrapper that renders a slotted protected landmark', () => {
    const landmark = mockElement({ tagName: 'MAIN' });
    landmark.matches = (selector) => selector.includes('main');
    const slot = mockElement({ tagName: 'SLOT' });
    slot.assignedElements = () => [landmark];
    const shadowRoot = {
      nodeType: 11,
      firstElementChild: slot,
      querySelector: () => null,
      querySelectorAll: (selector) => (selector === 'slot' || selector === '*' ? [slot] : [])
    };
    const wrapper = mockElement({ style: { position: 'fixed' }, shadowRoot });

    expect(resolve(wrapper)).toBeNull();
  });

  it('rejects an uninspectable custom host when closed-root access is unavailable', () => {
    const host = mockElement({ tagName: 'CLOSED-PAGE-SHELL', style: { position: 'fixed' } });

    expect(resolve(host, { canInspectClosedRoots: () => false })).toBeNull();
  });

  it('rejects a protected landmark in a privileged closed built-in shadow root', () => {
    const landmark = mockElement({ tagName: 'MAIN' });
    const closedRoot = {
      host: null,
      nodeType: 11,
      firstElementChild: landmark,
      querySelector: () => ({}),
      querySelectorAll: () => []
    };
    const host = mockElement({ style: { position: 'fixed' } });
    closedRoot.host = host;

    expect(
      resolve(host, {
        getShadowRoot: (element) => (element === host ? closedRoot : element.shadowRoot)
      })
    ).toBeNull();
  });

  it('rejects a built-in host conservatively when closed-root access is unavailable', () => {
    const overlay = mockElement({ style: { position: 'fixed' } });

    expect(resolve(overlay, { canInspectClosedRoots: () => false })).toBeNull();
  });

  it('keeps an ordinary DIV eligible when closed roots are fully inspectable', () => {
    const overlay = mockElement({ style: { position: 'fixed' } });

    expect(resolve(overlay)?.target).toBe(overlay);
  });

  it('rechecks semantic target safety independently of hidden geometry', () => {
    const safe = mockElement({ style: { position: 'fixed' } });
    const protectedTarget = mockElement({ role: 'main', style: { position: 'fixed' } });
    const options = {
      getShadowRoot: (element) => element.shadowRoot,
      canInspectClosedRoots: () => true
    };

    expect(isSafePickTarget(safe, options)).toBe(true);
    expect(isSafePickTarget(protectedTarget, options)).toBe(false);
  });

  it('shares a fail-closed landmark traversal budget without unbounded subtree queries', () => {
    let inspected = 0;
    const candidate = mockElement({ style: { position: 'fixed' } });
    const descendants = Array.from({ length: 20 }, () => mockElement());
    descendants.forEach((element, index) => {
      element.nextElementSibling = descendants[index + 1] || null;
      element.matches = () => {
        inspected += 1;
        return false;
      };
      element.querySelectorAll = () => {
        throw new Error('unbounded query');
      };
    });
    candidate.firstElementChild = descendants[0];
    candidate.matches = () => {
      inspected += 1;
      return false;
    };
    candidate.querySelectorAll = () => {
      throw new Error('unbounded query');
    };
    const scan = { remaining: 5, landmarkCache: new WeakMap() };
    const options = {
      getShadowRoot: () => null,
      canInspectClosedRoots: () => true,
      scan
    };

    expect(isSafePickTarget(candidate, options)).toBe(false);
    expect(inspected).toBe(5);
    expect(scan.remaining).toBe(0);
    expect(isSafePickTarget(candidate, options)).toBe(false);
    expect(inspected).toBe(5);
  });

  it('walks slotted assignments incrementally without materializing a flattened list', () => {
    const host = mockElement({ tagName: 'PAGE-SHELL' });
    const slotRoot = { nodeType: 11, host };
    const slot = mockElement({ tagName: 'SLOT', root: slotRoot });
    slot.assignedElements = () => {
      throw new Error('flattened assignments must not be materialized');
    };
    const wrapper = mockElement({ style: { position: 'fixed' }, root: slotRoot });
    wrapper.firstElementChild = slot;
    const assigned = Array.from({ length: 20 }, () => mockElement());
    assigned.forEach((element, index) => {
      element.assignedSlot = slot;
      element.nextElementSibling = assigned[index + 1] || null;
    });
    host.firstElementChild = assigned[0];
    const scan = { remaining: 4, landmarkCache: new WeakMap() };

    expect(
      isSafePickTarget(wrapper, {
        getShadowRoot: () => null,
        canInspectClosedRoots: () => true,
        scan
      })
    ).toBe(false);
    expect(scan.remaining).toBe(0);
  });
});
