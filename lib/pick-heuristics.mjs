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
  'link',
  'menuitem',
  'option',
  'radio',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox'
]);
const APP_ROOT_IDS = new Set(['app', 'root', '__next', '__nuxt']);
const PROTECTED_ROLES = new Set(['application', 'banner', 'contentinfo', 'main', 'navigation']);

export function composedParent(el) {
  if (!el) return null;
  return el.assignedSlot || el.parentElement || el.getRootNode?.()?.host || null;
}

function isInteractive(el) {
  const tagName = String(el?.tagName || '').toUpperCase();
  const role = String(el?.getAttribute?.('role') || '').toLowerCase();
  return Boolean(
    INTERACTIVE_TAGS.has(tagName) ||
    (tagName === 'A' && el.getAttribute?.('href')) ||
    el?.isContentEditable ||
    INTERACTIVE_ROLES.has(role)
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

function containsPageLandmark(el) {
  try {
    return Boolean(
      el.querySelector?.(
        'main, article, nav, [role="application"], [role="banner"], [role="contentinfo"], [role="main"], [role="navigation"]'
      )
    );
  } catch {
    return true;
  }
}

export function resolvePickCandidate(
  hit,
  {
    getStyle = () => ({}),
    viewport = { width: 0, height: 0 },
    documentRoot = null,
    pickerHost = null,
    fullscreenElement = null,
    isHidden = () => false
  } = {}
) {
  if (!hit || hit === pickerHost) return null;

  let node = hit;
  let promoted = null;
  let interactiveAncestor = null;
  for (let depth = 0; depth < 12 && node; depth += 1) {
    if (node === pickerHost) return null;
    if (isInteractive(node)) interactiveAncestor ||= node;
    const style = styleFor(node, getStyle);
    const modal =
      String(node.tagName || '').toUpperCase() === 'DIALOG' ||
      node.getAttribute?.('role') === 'dialog' ||
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

  const tagName = String(candidate?.tagName || '').toUpperCase();
  const role = String(candidate?.getAttribute?.('role') || '').toLowerCase();
  if (
    !candidate ||
    candidate === pickerHost ||
    candidate.isConnected === false ||
    PROTECTED_TAGS.has(tagName) ||
    PROTECTED_ROLES.has(role) ||
    APP_ROOT_IDS.has(String(candidate.id || '').toLowerCase()) ||
    isInteractive(candidate) ||
    isNativeModal(candidate) ||
    isHidden(candidate)
  ) {
    return null;
  }
  if (documentRoot && candidate.ownerDocument && candidate.ownerDocument !== documentRoot) return null;
  if (fullscreenElement && (fullscreenElement === candidate || fullscreenElement.contains?.(candidate)))
    return null;
  if (containsPageLandmark(candidate)) return null;

  const style = styleFor(candidate, getStyle);
  const rect = visibleRect(candidate, style, viewport);
  return rect ? { target: candidate, rect } : null;
}
