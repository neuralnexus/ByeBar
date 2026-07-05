/**
 * ByeBar shadow DOM helpers — pierce open shadow roots (e.g. IBM c4d-legal-nav).
 */
(() => {
  const BYEBAR = window.ByeBar;

  function walkRoots(root, visit) {
    if (!root) return;
    visit(root);
    let nodes = [];
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
    const safeSelector = normalizeSelector(selector);
    const matches = [];
    walkRoots(root, (scope) => {
      try {
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

  const watchedRoots = new WeakSet();

  function watchShadowRoots(observer, root = document.documentElement) {
    walkRoots(root, (scope) => {
      if (!scope || watchedRoots.has(scope)) return;
      watchedRoots.add(scope);
      try {
        observer.observe(scope, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'style', 'id', 'aria-label', 'aria-modal', 'open', 'hidden']
        });
      } catch {
        /* ignore */
      }
    });
  }

  BYEBAR.shadow = { walkRoots, queryAll, query, closestDeep, watchShadowRoots };
})();
