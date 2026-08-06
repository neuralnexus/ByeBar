/**
 * ByeBar shadow DOM helpers: inspect shadow roots without modifying their structure.
 */
(() => {
  const BYEBAR = window.ByeBar;
  const extensionDom = BYEBAR.browser?.api?.dom;
  const observedAttributes = Object.freeze([
    'class',
    'id',
    'style',
    'hidden',
    'disabled',
    'aria-disabled',
    'aria-hidden',
    'role',
    'aria-label',
    'aria-modal',
    'title',
    'value',
    'href',
    'open',
    'data-state',
    'data-testid',
    'data-cky-tag'
  ]);

  function walkRoots(root, visit) {
    if (!root) return;
    visit(root);
    if (root.nodeType === 1 && root.shadowRoot) walkRoots(root.shadowRoot, visit);
    let nodes;
    try {
      nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
    } catch {
      return;
    }
    nodes.forEach((el) => {
      if (el.shadowRoot) walkRoots(el.shadowRoot, visit);
    });
  }

  function walkInspectableRoots(root, visit) {
    if (!root) return;
    visit(root);
    if (root.nodeType === 1) {
      const shadowRoot = openOrClosedRoot(root);
      if (shadowRoot) walkInspectableRoots(shadowRoot, visit);
    }
    let nodes;
    try {
      nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
    } catch {
      return;
    }
    nodes.forEach((el) => {
      const shadowRoot = openOrClosedRoot(el);
      if (shadowRoot) walkInspectableRoots(shadowRoot, visit);
    });
  }

  function canInspectClosedRoots(el) {
    if (typeof extensionDom?.openOrClosedShadowRoot === 'function') return true;
    try {
      return Boolean(el && 'openOrClosedShadowRoot' in el);
    } catch {
      return false;
    }
  }

  function openOrClosedRoot(el) {
    if (!el) return null;
    if (el.shadowRoot) return el.shadowRoot;
    if (typeof extensionDom?.openOrClosedShadowRoot === 'function') {
      return extensionDom.openOrClosedShadowRoot(el) || null;
    }
    if ('openOrClosedShadowRoot' in el) return el.openOrClosedShadowRoot || null;
    return null;
  }

  function normalizeSelector(selector) {
    return BYEBAR.safari?.normalizeSelector?.(selector) || selector;
  }

  function queryAllWithWalker(selector, root, walk) {
    if (!selector || !root) return [];
    const safeSelector = normalizeSelector(selector);
    const matches = [];
    walk(root, (scope) => {
      try {
        if (scope.nodeType === 1 && scope.matches?.(safeSelector)) matches.push(scope);
        scope.querySelectorAll(safeSelector).forEach((el) => matches.push(el));
      } catch {
        /* ignore invalid selectors in older roots */
      }
    });
    return matches;
  }

  function queryAll(selector, root = document) {
    return queryAllWithWalker(selector, root, walkRoots);
  }

  function queryAllIncludingClosed(selector, root = document) {
    return queryAllWithWalker(selector, root, walkInspectableRoots);
  }

  function query(selector, root = document) {
    return queryAll(selector, root)[0] || null;
  }

  function findIncludingClosed(selectors, root = document, limit = Infinity) {
    const requested = (Array.isArray(selectors) ? selectors : [selectors]).filter(Boolean);
    const normalized = requested.map(normalizeSelector);
    const maximum = Number.isSafeInteger(limit) && limit >= 0 ? limit : Infinity;
    const frames = [
      root?.nodeType === 1
        ? { next: root, single: true }
        : { next: root?.firstElementChild || null, single: false }
    ];
    let inspected = 0;

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const element = frame.next;
      if (!element) {
        frames.pop();
        continue;
      }
      if (inspected >= maximum) {
        return { element: null, selector: '', exhausted: true, inspected };
      }
      frame.next = frame.single ? null : element.nextElementSibling;
      inspected += 1;

      for (let index = 0; index < normalized.length; index += 1) {
        try {
          if (element.matches?.(normalized[index])) {
            return { element, selector: requested[index], exhausted: false, inspected };
          }
        } catch {
          /* Ignore unsupported selectors without aborting the other probes. */
        }
      }

      if (element.firstElementChild) {
        frames.push({ next: element.firstElementChild, single: false });
      }
      let shadowRoot = null;
      try {
        shadowRoot = openOrClosedRoot(element);
      } catch {
        /* Ignore inaccessible roots. */
      }
      if (shadowRoot?.firstElementChild) {
        frames.push({ next: shadowRoot.firstElementChild, single: false });
      }
    }
    return { element: null, selector: '', exhausted: false, inspected };
  }

  function queryIncludingClosed(selector, root = document, limit = Infinity) {
    return findIncludingClosed(selector, root, limit).element;
  }

  function collectElements(root = document, limit = Infinity) {
    const maximum = Number.isSafeInteger(limit) && limit >= 0 ? limit : Infinity;
    const elements = [];
    const frames = [
      root?.nodeType === 1
        ? { next: root, single: true }
        : { next: root?.firstElementChild || null, single: false }
    ];
    while (frames.length > 0 && elements.length < maximum) {
      const frame = frames[frames.length - 1];
      const element = frame.next;
      if (!element) {
        frames.pop();
        continue;
      }
      frame.next = frame.single ? null : element.nextElementSibling;
      elements.push(element);

      if (element.firstElementChild) {
        frames.push({ next: element.firstElementChild, single: false });
      }
      const shadowRoot = element.shadowRoot;
      if (shadowRoot?.firstElementChild) {
        frames.push({ next: shadowRoot.firstElementChild, single: false });
      }
    }
    return elements;
  }

  function matchesAny(el, selector) {
    if (!el || el.nodeType !== 1) return false;
    const selectors = String(selector)
      .split(',')
      .map((s) => s.trim());
    return selectors.some((sel) => {
      try {
        return el.matches(sel);
      } catch {
        return false;
      }
    });
  }

  function closestDeep(el, selector) {
    let node = el;
    while (node) {
      if (matchesAny(node, selector)) return node;
      if (node.parentElement) {
        node = node.parentElement;
        continue;
      }
      const root = node.getRootNode?.();
      if (root instanceof ShadowRoot && root.host) {
        node = root.host;
        continue;
      }
      break;
    }
    return null;
  }

  const watchedRoots = new WeakMap();
  const pendingCustomHosts = new WeakSet();

  function watchDeferredCustomHosts(observer, root, onShadowRoot) {
    if (!globalThis.customElements || !root?.querySelectorAll) return;
    const hosts = [
      ...(root.nodeType === 1 && root.localName?.includes('-') ? [root] : []),
      ...root.querySelectorAll('*')
    ].filter((el) => el.localName?.includes('-') && !el.shadowRoot);

    hosts.forEach((host) => {
      if (pendingCustomHosts.has(host)) return;
      pendingCustomHosts.add(host);
      void customElements
        .whenDefined(host.localName)
        .then(() => {
          const delays = [0, 100, 1000, 5000];
          delays.forEach((delay, index) => {
            setTimeout(() => {
              if (!pendingCustomHosts.has(host)) return;
              if (host.shadowRoot) {
                pendingCustomHosts.delete(host);
                watchShadowRoots(observer, host.shadowRoot, onShadowRoot);
              } else if (index === delays.length - 1) {
                pendingCustomHosts.delete(host);
              }
            }, delay);
          });
        })
        .catch(() => pendingCustomHosts.delete(host));
    });
  }

  function watchShadowRoots(observer, root = document.documentElement, onShadowRoot) {
    const discovered = [];
    walkRoots(root, (scope) => {
      if (!scope || watchedRoots.get(scope) === observer) return;
      watchedRoots.set(scope, observer);
      if (scope.nodeType === 11) discovered.push(scope);
      try {
        observer.observe(scope, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeOldValue: true,
          attributeFilter: observedAttributes
        });
      } catch {
        /* ignore */
      }
    });
    watchDeferredCustomHosts(observer, root, onShadowRoot);
    discovered.forEach((shadowRoot) => onShadowRoot?.(shadowRoot));
  }

  BYEBAR.shadow = {
    observedAttributes,
    walkRoots,
    walkInspectableRoots,
    queryAll,
    queryAllIncludingClosed,
    query,
    queryIncludingClosed,
    findIncludingClosed,
    collectElements,
    closestDeep,
    watchShadowRoots,
    canInspectClosedRoots,
    openOrClosedRoot
  };
})();
