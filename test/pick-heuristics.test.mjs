import { describe, expect, it } from 'vitest';
import { composedParent, resolvePickCandidate } from '../lib/pick-heuristics.mjs';

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
  root = null
} = {}) {
  return {
    nodeType: 1,
    tagName,
    id,
    parentElement,
    ownerDocument,
    open,
    isConnected,
    tabIndex: tabIndex ?? -1,
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
      return selector === ':modal' && modal;
    },
    querySelector() {
      return containsLandmark ? {} : null;
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
}

function resolve(hit, overrides = {}) {
  return resolvePickCandidate(hit, {
    getStyle: (element) => element.styleFixture,
    viewport,
    isHidden: () => false,
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

  it('uses the parent of a non-interactive inline hit', () => {
    const banner = mockElement();
    const copy = mockElement({ tagName: 'SPAN', parentElement: banner, style: { display: 'inline' } });

    expect(resolve(copy)?.target).toBe(banner);
  });

  it.each([
    { values: { tagName: 'MAIN' }, label: 'page landmark' },
    { values: { id: '__next' }, label: 'application root' },
    { values: { tagName: 'IFRAME' }, label: 'frame' },
    { values: { role: 'navigation' }, label: 'ARIA landmark' },
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

  it('walks from an open shadow root to its host', () => {
    const host = mockElement({ style: { position: 'sticky' } });
    const shadowRoot = { host };
    const hit = mockElement({ tagName: 'SPAN', root: shadowRoot });

    expect(composedParent(hit)).toBe(host);
    expect(resolve(hit)?.target).toBe(host);
  });
});
