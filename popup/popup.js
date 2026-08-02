const { api, tabsQuery, sendRuntimeMessage, sendTabMessage } = window.ByeBar.browser;
const ISSUES_BASE = 'https://github.com/neuralnexus/ByeBar/issues/new';
const PROTOCOL = globalThis.ByeBar.lib.constants.MESSAGE_PROTOCOL_VERSION;
const FEATURE_ROWS = {
  enabled: {
    input: document.getElementById('site-enabled'),
    source: document.getElementById('enabled-source')
  },
  genericBlocking: {
    input: document.getElementById('generic-blocking'),
    source: document.getElementById('generic-blocking-source')
  },
  cookieDecline: {
    input: document.getElementById('cookie-decline'),
    source: document.getElementById('cookie-decline-source')
  },
  tosAccept: {
    input: document.getElementById('tos-accept'),
    source: document.getElementById('tos-accept-source')
  }
};

const scopeSiteEl = document.getElementById('scope-site');
const scopeGlobalEl = document.getElementById('scope-global');
const enabledLabelEl = document.getElementById('enabled-label');
const hostLabelEl = document.getElementById('host-label');
const resetSiteEl = document.getElementById('reset-site');
const actionSummaryEl = document.getElementById('action-summary');
const undoActionEl = document.getElementById('undo-action');
const debugEnabledEl = document.getElementById('debug-enabled');
const debugListEl = document.getElementById('debug-list');
const clearDebugEl = document.getElementById('clear-debug');
const statusEl = document.getElementById('status');
const reportBugEl = document.getElementById('report-bug');
const requestFeatureEl = document.getElementById('request-feature');

let scope = 'site';
let host = '';
let tabId = null;
let settingsState = null;
let pageState = null;
let pending = false;

function setStatus(message = '', isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('status--error', isError);
}

function setPending(next) {
  pending = next;
  document.querySelectorAll('button, input').forEach((el) => {
    if (el.id === 'scope-global' && !host) return;
    el.disabled = next;
  });
}

function buildIssueUrl(kind) {
  const version = api.runtime.getManifest().version;
  const isBug = kind === 'bug';
  const title = isBug ? '[Bug] ' : '[Feature] ';
  const body = [
    `**ByeBar version:** ${version}`,
    '',
    isBug ? '### What happened?' : '### What would you like?',
    '',
    '',
    isBug ? '### Steps to reproduce' : '### Why is this useful?',
    '1. '
  ]
    .filter((line) => line !== null)
    .join('\n');
  return `${ISSUES_BASE}?${new URLSearchParams({ title, body })}`;
}

function renderScope() {
  scopeSiteEl.setAttribute('aria-pressed', String(scope === 'site'));
  scopeGlobalEl.setAttribute('aria-pressed', String(scope === 'global'));
  enabledLabelEl.textContent = scope === 'site' ? 'Enabled on this site' : 'Enabled globally';
  hostLabelEl.textContent =
    scope === 'site' ? host || 'Unavailable on this page' : 'Used unless a site overrides it';
}

function renderSettings() {
  if (!settingsState) return;
  const siteUnavailable = scope === 'site' && !host;
  const values = scope === 'site' ? settingsState.site.configured : settingsState.global;

  for (const [key, row] of Object.entries(FEATURE_ROWS)) {
    row.input.checked = Boolean(values[key]);
    const override = scope === 'site' ? settingsState.site.overrides[key] : null;
    row.source.textContent =
      scope === 'global' ? 'Global default' : override === null ? 'Inherited' : 'Site override';
    row.input.disabled =
      pending ||
      siteUnavailable ||
      (scope === 'site' && key !== 'enabled' && !settingsState.site.effective.enabled);
  }

  resetSiteEl.hidden = scope !== 'site' || !settingsState.site.hasOverrides || siteUnavailable;
  resetSiteEl.disabled = pending;
  if (scope === 'site' && host && !settingsState.site.effective.enabled) {
    setStatus('Paused on this site');
  } else if (!pending && !statusEl.classList.contains('status--error')) {
    setStatus('');
  }
}

function actionCopy(action) {
  if (!action) return 'No page action yet';
  if (action.operation === 'undo') return 'Last reversible hide restored';
  if (action.operation === 'decline') return 'Clicked a cookie reject control; this cannot be undone';
  if (action.operation === 'accept') return 'Clicked a legal accept control; this cannot be undone';
  if (action.operation === 'dismiss') return 'Clicked a popup dismiss control; this cannot be undone';
  return action.canUndo ? 'Hidden intrusive page elements' : 'Page action completed';
}

function renderPageState() {
  const action = pageState?.lastAction || null;
  const undoAction = pageState?.undoAction || null;
  actionSummaryEl.textContent = pageState ? actionCopy(action) : 'Unavailable on this page';
  undoActionEl.disabled = pending || !undoAction?.canUndo;
  debugListEl.replaceChildren();
  const decisions = pageState?.decisions || [];
  decisions.forEach((decision) => {
    const item = document.createElement('li');
    const label = document.createElement('span');
    const result = document.createElement('strong');
    label.textContent = `${decision.rule} · ${decision.reason}`;
    result.textContent = decision.result;
    item.append(label, result);
    debugListEl.append(item);
  });
  clearDebugEl.hidden = !settingsState?.debugEnabled || decisions.length === 0;
  clearDebugEl.disabled = pending;
}

function render() {
  renderScope();
  renderSettings();
  debugEnabledEl.checked = Boolean(settingsState?.debugEnabled);
  debugEnabledEl.disabled = pending;
  renderPageState();
  reportBugEl.href = buildIssueUrl('bug');
  requestFeatureEl.href = buildIssueUrl('feature');
}

async function requestSettings(message) {
  const response = await sendRuntimeMessage({ protocol: PROTOCOL, ...message });
  if (!response?.ok) throw new Error(response?.error?.message || 'Settings update failed');
  settingsState = response.state;
  return response;
}

async function refreshPageState() {
  if (tabId === null || !host) {
    pageState = null;
    return;
  }
  try {
    const response = await sendTabMessage(tabId, { protocol: PROTOCOL, type: 'byebar.page.getState' });
    pageState = response?.ok ? response : null;
  } catch {
    pageState = null;
  }
}

async function updateSetting(key, value) {
  setPending(true);
  setStatus('Saving…');
  try {
    await requestSettings({
      type: 'byebar.settings.update',
      scope,
      host,
      key,
      value
    });
    setStatus('Saved');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setPending(false);
    render();
  }
}

Object.entries(FEATURE_ROWS).forEach(([key, row]) => {
  row.input.addEventListener('change', () => void updateSetting(key, row.input.checked));
});

scopeSiteEl.addEventListener('click', () => {
  if (!host) return;
  scope = 'site';
  render();
});

scopeGlobalEl.addEventListener('click', () => {
  scope = 'global';
  render();
});

resetSiteEl.addEventListener('click', async () => {
  setPending(true);
  try {
    await requestSettings({ type: 'byebar.settings.clearSite', host });
    setStatus('Using global defaults');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setPending(false);
    render();
  }
});

undoActionEl.addEventListener('click', async () => {
  if (!pageState?.undoAction || tabId === null) return;
  setPending(true);
  try {
    const response = await sendTabMessage(tabId, {
      protocol: PROTOCOL,
      type: 'byebar.page.undo',
      documentId: pageState.documentId,
      actionId: pageState.undoAction.id
    });
    if (!response?.ok) throw new Error(response?.error?.code || 'Undo failed');
    pageState = response;
    setStatus('Hidden elements restored');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setPending(false);
    render();
  }
});

debugEnabledEl.addEventListener('change', async () => {
  setPending(true);
  try {
    await requestSettings({
      type: 'byebar.debug.set',
      host,
      enabled: debugEnabledEl.checked
    });
    await refreshPageState();
    setStatus(debugEnabledEl.checked ? 'Local diagnostics enabled' : 'Local diagnostics disabled');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setPending(false);
    render();
  }
});

clearDebugEl.addEventListener('click', async () => {
  if (!pageState || tabId === null) return;
  setPending(true);
  try {
    const response = await sendTabMessage(tabId, {
      protocol: PROTOCOL,
      type: 'byebar.page.debug.clear',
      documentId: pageState.documentId
    });
    if (response?.ok) pageState = response;
    setStatus('Page decisions cleared');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setPending(false);
    render();
  }
});

async function init() {
  setPending(true);
  try {
    const [tab] = await tabsQuery({ active: true, currentWindow: true });
    tabId = Number.isInteger(tab?.id) ? tab.id : null;
    host = tab?.incognito ? '' : window.ByeBar.lib.host.normalizeHost(tab?.url || '');
    if (!host) scope = 'global';
    await requestSettings({ type: 'byebar.settings.get', host });
    await refreshPageState();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setPending(false);
    render();
  }
}

void init();
