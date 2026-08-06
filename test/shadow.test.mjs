import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../content/shadow.js', import.meta.url), 'utf8');

function link(children) {
  children.forEach((child, index) => {
    child.nextElementSibling = children[index + 1] || null;
  });
  return children[0] || null;
}

function scope(children = []) {
  return { nodeType: 11, firstElementChild: link(children) };
}

function element(name, children = [], shadowRoot = null) {
  const value = {
    nodeType: 1,
    name,
    firstElementChild: link(children),
    nextElementSibling: null,
    shadowRoot
  };
  return value;
}

function loadShadow() {
  const ByeBar = { browser: { api: {} } };
  const context = vm.createContext({ window: { ByeBar }, console });
  vm.runInContext(source, context);
  return ByeBar.shadow;
}

describe('shadow traversal', () => {
  it('bounds element collection while traversing open roots', () => {
    const shadowFirst = element('shadow-first');
    const shadowSecond = element('shadow-second');
    const lightChild = element('light-child');
    const host = element('host', [lightChild], scope([shadowFirst, shadowSecond]));
    const siblings = Array.from({ length: 20 }, (_, index) => element(`sibling-${index}`));
    const body = element('body', [host, ...siblings]);
    const html = element('html', [body]);
    const document = { nodeType: 9, firstElementChild: html };

    const collected = loadShadow().collectElements(document, 5);

    expect(collected.map((entry) => entry.name)).toEqual([
      'html',
      'body',
      'host',
      'shadow-first',
      'shadow-second'
    ]);
  });

  it('short-circuits an inspectable-root query at the first match', () => {
    const match = element('match');
    match.matches = (selector) => selector === ':popover-open';
    const untouched = Array.from({ length: 20 }, (_, index) => element(`untouched-${index}`));
    untouched.forEach((entry) => {
      entry.matches = () => {
        throw new Error('query did not short-circuit');
      };
    });
    const html = element('html', [match, ...untouched]);
    html.matches = () => false;
    const document = { nodeType: 9, firstElementChild: html };

    const result = loadShadow().findIncludingClosed(['dialog:modal', ':popover-open'], document, 10);

    expect(result.element).toBe(match);
    expect(result.selector).toBe(':popover-open');
    expect(result.inspected).toBe(2);
    expect(result.exhausted).toBe(false);
  });

  it('fails closed at a hard inspectable-root query budget', () => {
    const children = Array.from({ length: 20 }, (_, index) => element(`child-${index}`));
    children.forEach((entry) => (entry.matches = () => false));
    const html = element('html', children);
    html.matches = () => false;
    const document = { nodeType: 9, firstElementChild: html };

    const result = loadShadow().findIncludingClosed(':popover-open', document, 3);

    expect(result).toMatchObject({ element: null, exhausted: true, inspected: 3 });
  });

  it('does not report exhaustion when the tree exactly fits the budget', () => {
    const child = element('child');
    child.matches = () => false;
    const html = element('html', [child]);
    html.matches = () => false;
    const document = { nodeType: 9, firstElementChild: html };

    expect(loadShadow().findIncludingClosed(':popover-open', document, 2)).toMatchObject({
      element: null,
      exhausted: false,
      inspected: 2
    });
  });

  it('searches privileged closed roots within the same bounded traversal', () => {
    const match = element('closed-match');
    match.matches = (selector) => selector === 'dialog:modal';
    const host = element('host');
    host.matches = () => false;
    host.openOrClosedShadowRoot = scope([match]);
    const html = element('html', [host]);
    html.matches = () => false;
    const document = { nodeType: 9, firstElementChild: html };

    expect(loadShadow().findIncludingClosed('dialog:modal', document, 3)).toMatchObject({
      element: match,
      exhausted: false,
      inspected: 3
    });
  });
});
