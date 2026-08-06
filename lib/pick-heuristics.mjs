import { hasAnyRole, hasRole } from './aria.mjs';

const PROTECTED_TAGS = new Set([
  'HTML',
  'BODY',
  'HEAD',
  'MAIN',
  'ARTICLE',
  'HEADER',
  'NAV',
  'FOOTER',
  'SCRIPT',
  'STYLE',
  'LINK',
  'META',
  'TITLE',
  'TEMPLATE',
  'IFRAME'
]);
const INTERACTIVE_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'LABEL', 'SUMMARY']);
const INTERACTIVE_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'grid',
  'gridcell',
  'link',
  'listbox',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'radiogroup',
  'scrollbar',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'tablist',
  'textbox',
  'tree',
  'treegrid',
  'treeitem'
]);
const APP_ROOT_IDS = new Set([
  'app',
  'app-root',
  'application',
  'page',
  'page-root',
  'root',
  '__next',
  '__nuxt',
  '___gatsby',
  'gatsby-focus-wrapper'
]);
const PROTECTED_ROLES = new Set(['application', 'banner', 'contentinfo', 'main', 'navigation']);
const SHADOW_HOST_TAGS = new Set([
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'BODY',
  'DIV',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'MAIN',
  'NAV',
  'P',
  'SECTION',
  'SPAN'
]);
const LANDMARK_SELECTOR =
  'main, article, nav, [role~="application" i], [role~="banner" i], [role~="contentinfo" i], [role~="main" i], [role~="navigation" i]';
const DEFAULT_LANDMARK_SCAN_ELEMENTS = 5_000;

export function composedParent(el) {
  if (!el) return null;
  return el.assignedSlot || el.parentElement || el.getRootNode?.()?.host || null;
}

function isComposedWithin(el, ancestor) {
  if (!ancestor) return false;
  const visited = new Set();
  let node = el;
  while (node && !visited.has(node)) {
    if (node === ancestor) return true;
    visited.add(node);
    node = composedParent(node);
  }
  return false;
}

function isInteractive(el) {
  const tagName = String(el?.tagName || '').toUpperCase();
  const modalContainer =
    tagName === 'DIALOG' || hasRole(el, 'dialog') || el?.getAttribute?.('aria-modal') === 'true';
  const linked = (tagName === 'A' || tagName === 'AREA') && el?.hasAttribute?.('href');
  const mediaControl = (tagName === 'AUDIO' || tagName === 'VIDEO') && el?.hasAttribute?.('controls');
  const keyboardFocusable = !modalContainer && el?.hasAttribute?.('tabindex') && Number(el.tabIndex) >= 0;
  return Boolean(
    INTERACTIVE_TAGS.has(tagName) ||
    linked ||
    mediaControl ||
    keyboardFocusable ||
    el?.isContentEditable ||
    hasAnyRole(el, INTERACTIVE_ROLES)
  );
}

function isNativeModal(el) {
  if (String(el?.tagName || '').toUpperCase() !== 'DIALOG') return false;
  try {
    return el.matches?.(':modal') === true;
  } catch {
    return el.open === true;
  }
}

function styleFor(el, getStyle) {
  try {
    return getStyle(el) || {};
  } catch {
    return {};
  }
}

function visibleRect(el, style, viewport) {
  const rect = el?.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.contentVisibility === 'hidden' ||
    style.pointerEvents === 'none' ||
    Number.parseFloat(style.opacity || '1') <= 0.01
  ) {
    return null;
  }
  const right = rect.right ?? rect.left + rect.width;
  const bottom = rect.bottom ?? rect.top + rect.height;
  if (right <= 0 || bottom <= 0 || rect.left >= viewport.width || rect.top >= viewport.height) return null;
  return rect;
}

function canHostShadowRoot(el) {
  const name = String(el?.localName || el?.tagName || '').toLowerCase();
  return name.includes('-') || SHADOW_HOST_TAGS.has(String(el?.tagName || '').toUpperCase());
}

function scanState(provided) {
  if (
    provided &&
    Number.isSafeInteger(provided.remaining) &&
    provided.remaining >= 0 &&
    typeof provided.landmarkCache?.has === 'function' &&
    typeof provided.landmarkCache?.get === 'function' &&
    typeof provided.landmarkCache?.set === 'function'
  ) {
    return provided;
  }
  return { remaining: DEFAULT_LANDMARK_SCAN_ELEMENTS, landmarkCache: new WeakMap() };
}

function containsPageLandmark(el, getShadowRoot, canInspectClosedRoots, providedScan) {
  const scan = scanState(providedScan);
  if (scan.landmarkCache.has(el)) return scan.landmarkCache.get(el);

  const pending = [{ node: el, siblings: false, counted: false }];
  const visited = new Set();
  let protectedSubtree = false;
  while (pending.length > 0) {
    const item = pending.pop();
    if (item.slot) {
      const candidate = item.node;
      if (!candidate) continue;
      if (candidate.nextElementSibling) {
        pending.push({ ...item, node: candidate.nextElementSibling });
      }
      if (scan.remaining === 0) {
        protectedSubtree = true;
        break;
      }
      scan.remaining -= 1;
      if (candidate.assignedSlot === item.slot) {
        pending.push({ node: candidate, siblings: false, counted: true });
      }
      continue;
    }
    const node = item.node;
    if (!node) continue;
    if (item.siblings && node.nextElementSibling) {
      pending.push({ node: node.nextElementSibling, siblings: true, counted: false });
    }
    if (visited.has(node)) continue;
    visited.add(node);
    if (!item.counted) {
      if (scan.remaining === 0) {
        protectedSubtree = true;
        break;
      }
      scan.remaining -= 1;
    }
    try {
      if (node.matches?.(LANDMARK_SELECTOR)) {
        protectedSubtree = true;
        break;
      }
      if (String(node.tagName || '').toUpperCase() === 'SLOT') {
        const slotHost = node.getRootNode?.()?.host;
        if (slotHost?.firstElementChild) {
          pending.push({ slot: node, node: slotHost.firstElementChild });
        } else if (!slotHost && typeof node.assignedElements === 'function') {
          protectedSubtree = true;
          break;
        }
      }
      if (canHostShadowRoot(node)) {
        const shadowRoot = getShadowRoot(node);
        if (shadowRoot?.firstElementChild) {
          pending.push({ node: shadowRoot.firstElementChild, siblings: true, counted: false });
        } else if (!shadowRoot && !canInspectClosedRoots(node)) {
          protectedSubtree = true;
          break;
        }
      }
      if (node.firstElementChild) {
        pending.push({ node: node.firstElementChild, siblings: true, counted: false });
      }
    } catch {
      protectedSubtree = true;
      break;
    }
  }
  scan.landmarkCache.set(el, protectedSubtree);
  return protectedSubtree;
}

export function isSafePickTarget(
  candidate,
  {
    documentRoot = null,
    pickerHost = null,
    fullscreenElement = null,
    isHidden = () => false,
    getShadowRoot = (el) => el?.shadowRoot || null,
    canInspectClosedRoots = () => false,
    scan = null
  } = {}
) {
  const tagName = String(candidate?.tagName || '').toUpperCase();
  if (
    !candidate ||
    isComposedWithin(candidate, pickerHost) ||
    candidate.isConnected === false ||
    PROTECTED_TAGS.has(tagName) ||
    hasAnyRole(candidate, PROTECTED_ROLES) ||
    APP_ROOT_IDS.has(String(candidate.id || '').toLowerCase()) ||
    isInteractive(candidate) ||
    isNativeModal(candidate) ||
    isHidden(candidate)
  ) {
    return false;
  }
  if (documentRoot && candidate.ownerDocument && candidate.ownerDocument !== documentRoot) return false;
  if (fullscreenElement && (fullscreenElement === candidate || fullscreenElement.contains?.(candidate))) {
    return false;
  }
  return !containsPageLandmark(candidate, getShadowRoot, canInspectClosedRoots, scan);
}

export function resolvePickCandidate(
  hit,
  {
    getStyle = () => ({}),
    viewport = { width: 0, height: 0 },
    documentRoot = null,
    pickerHost = null,
    fullscreenElement = null,
    isHidden = () => false,
    getShadowRoot = (el) => el?.shadowRoot || null,
    canInspectClosedRoots = () => false,
    scan = null
  } = {}
) {
  if (!hit || isComposedWithin(hit, pickerHost)) return null;

  let node = hit;
  let promoted = null;
  let interactiveAncestor = null;
  for (let depth = 0; depth < 12 && node; depth += 1) {
    if (node === pickerHost) return null;
    if (isInteractive(node)) interactiveAncestor ||= node;
    const style = styleFor(node, getStyle);
    const modal =
      String(node.tagName || '').toUpperCase() === 'DIALOG' ||
      hasRole(node, 'dialog') ||
      node.getAttribute?.('aria-modal') === 'true';
    if (modal || style.position === 'fixed' || style.position === 'sticky') {
      promoted = node;
      break;
    }
    const parent = composedParent(node);
    if (!parent || ['HTML', 'BODY'].includes(String(parent.tagName || '').toUpperCase())) break;
    node = parent;
  }

  let candidate = promoted || hit;
  if (!promoted) {
    if (interactiveAncestor) return null;
    const style = styleFor(candidate, getStyle);
    const parent = composedParent(candidate);
    if ((style.display === 'inline' || style.display === 'contents') && parent) candidate = parent;
  }

  if (
    !isSafePickTarget(candidate, {
      documentRoot,
      pickerHost,
      fullscreenElement,
      isHidden,
      getShadowRoot,
      canInspectClosedRoots,
      scan
    })
  )
    return null;

  const style = styleFor(candidate, getStyle);
  const rect = visibleRect(candidate, style, viewport);
  return rect ? { target: candidate, rect } : null;
}
