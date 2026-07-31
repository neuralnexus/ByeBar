/**
 * ByeBar shadow DOM helpers: inspect open shadow roots without modifying their structure.
 */
(() => {
  const BYEBAR = window.ByeBar;

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

  function normalizeSelector(selector) {
    return BYEBAR.safari?.normalizeSelector?.(selector) || selector;
  }

  function queryAll(selector, root = document) {
    if (!selector || !root) return [];
    const safeSelector = normalizeSelector(selector);
    const matches = [];
    walkRoots(root, (scope) => {
      try {
        if (scope.nodeType === 1 && scope.matches?.(safeSelector)) matches.push(scope);
        scope.querySelectorAll(safeSelector).forEach((el) => matches.push(el));
      } catch {
        /* ignore invalid selectors in older roots */
      }
    });
    return matches;
  }

  function query(selector, root = document) {
    return queryAll(selector, root)[0] || null;
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
        const attributeFilter = [
          'class',
          'style',
          'hidden',
          'aria-hidden',
          'role',
          'aria-label',
          'aria-modal',
          'open',
          'data-state',
          'data-testid'
        ];
        observer.observe(scope, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeOldValue: true,
          attributeFilter
        });
      } catch {
        /* ignore */
      }
    });
    watchDeferredCustomHosts(observer, root, onShadowRoot);
    discovered.forEach((shadowRoot) => onShadowRoot?.(shadowRoot));
  }

  BYEBAR.shadow = { walkRoots, queryAll, query, closestDeep, watchShadowRoots };
})();
