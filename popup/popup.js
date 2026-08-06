const { api, tabsQuery, sendRuntimeMessage, sendTabMessage } = window.ByeBar.browser;
const ISSUES_BASE = 'https://github.com/neuralnexus/ByeBar/issues/new';
const PROTOCOL = globalThis.ByeBar.lib.constants.MESSAGE_PROTOCOL_VERSION;
const PICKER_SETTLE_REFRESH_MS = 650;
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
const siteStateEl = document.getElementById('site-state');
const siteStateLabelEl = document.getElementById('site-state-label');
const enabledLabelEl = document.getElementById('enabled-label');
const hostLabelEl = document.getElementById('host-label');
const resetSiteEl = document.getElementById('reset-site');
const sweepPageEl = document.getElementById('sweep-page');
const pickPageEl = document.getElementById('pick-page');
const pickPageLabelEl = document.getElementById('pick-page-label');
const actionSummaryEl = document.getElementById('action-summary');
const undoActionEl = document.getElementById('undo-action');
const debugEnabledEl = document.getElementById('debug-enabled');
const debugListEl = document.getElementById('debug-list');
const clearDebugEl = document.getElementById('clear-debug');
const statusEl = document.getElementById('status');
const reportBugEl = document.getElementById('report-bug');
const requestFeatureEl = document.getElementById('request-feature');
const legalConfirmEl = document.getElementById('legal-confirm');
const legalConfirmScopeEl = document.getElementById('legal-confirm-scope');

let scope = 'site';
let host = '';
let urlReadable = false;
let tabId = null;
let settingsState = null;
let pageState = null;
let pending = false;
let initializationState = 'loading';
let pickerSettleRefreshTimer = null;

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

function renderSiteState() {
  let state = 'loading';
  let label = 'Checking';
  if (!settingsState && initializationState !== 'loading') {
    state = 'unavailable';
    label = initializationState === 'error' ? 'Error' : 'Verify';
  } else if (settingsState && (!urlReadable || !pageState)) {
    state = 'unavailable';
    label = 'No access';
  } else if (pageState?.picker?.active === true) {
    state = 'picking';
    label = 'Picking';
  } else if (settingsState?.site?.effective.enabled) {
    state = 'ready';
    label = 'Ready';
  } else if (settingsState) {
    state = 'paused';
    label = 'Paused';
  }
  siteStateEl.dataset.state = state;
  siteStateLabelEl.textContent = label;
}

function renderSettings() {
  if (!settingsState) {
    Object.values(FEATURE_ROWS).forEach((row) => (row.input.disabled = true));
    resetSiteEl.hidden = true;
    return;
  }
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
  if (!statusEl.textContent && scope === 'site' && host && !settingsState.site.effective.enabled) {
    setStatus('Paused on this site');
  }
}

function actionCopy(action) {
  if (!action) return 'No page action yet';
  if (action.operation === 'undo') return 'Restored hidden page elements';
  if (action.operation === 'decline') return 'Clicked a cookie reject control; this cannot be undone';
  if (action.operation === 'accept') return 'Clicked a legal accept control; this cannot be undone';
  if (action.operation === 'dismiss') return 'Triggered a popup close action; this cannot be undone';
  if (action.feature === 'manualHide') return 'Hidden an item you picked';
  return action.canUndo ? 'Hidden intrusive page elements' : 'Page action completed';
}

function sweepCopy(sweep) {
  const counts = sweep?.result?.counts;
  if (!counts) return 'Sweep complete';
  const parts = [];
  const add = (value, singular, plural = `${singular}s`) => {
    if (Number.isInteger(value) && value > 0) parts.push(`${value} ${value === 1 ? singular : plural}`);
  };
  add(counts.reversibleHides, 'element hidden', 'elements hidden');
  add(counts.dismissActions, 'popup close triggered', 'popup closes triggered');
  add(counts.cookieDeclines, 'cookie rejection clicked', 'cookie rejections clicked');
  add(counts.legalAccepts, 'legal acceptance clicked', 'legal acceptances clicked');
  return parts.length > 0 ? `Sweep: ${parts.join('; ')}.` : 'No safe interruptions found.';
}

function undoActionCount(state = pageState) {
  if (Number.isInteger(state?.undoActionCount) && state.undoActionCount >= 0) {
    return state.undoActionCount;
  }
  return state?.undoAction?.canUndo ? 1 : 0;
}

function undoStatus(count) {
  if (count <= 0) return 'Hidden elements restored';
  return `Hidden elements restored. ${count} more hide ${count === 1 ? 'action' : 'actions'} available.`;
}

function renderPageState() {
  const action = pageState?.lastAction || null;
  const undoAction = pageState?.undoAction || null;
  const undoCount = undoActionCount();
  const supportsSweep = pageState?.capabilities?.includes('sweep') === true;
  const supportsPick = pageState?.capabilities?.includes('pick') === true;
  const pickerActive = pageState?.picker?.active === true;
  const pickerBusy = pageState?.picker?.busy === true;
  actionSummaryEl.textContent = pageState ? actionCopy(action) : 'Unavailable on this page';
  const undoText = undoCount > 1 ? `Undo hide (${undoCount})` : 'Undo hide';
  undoActionEl.textContent = undoText;
  undoActionEl.disabled = pending || pickerBusy || !undoAction?.canUndo || undoCount === 0;
  const undoLabel = undoCount > 0 ? `${undoText}; newest hide first` : undoText;
  undoActionEl.setAttribute('aria-label', undoLabel);
  undoActionEl.title = pickerBusy
    ? 'Wait for Pick to finish before using Undo'
    : undoCount > 0
      ? undoLabel
      : '';
  sweepPageEl.disabled = pending || pickerBusy || tabId === null || !supportsSweep;
  sweepPageEl.title = pickerBusy
    ? 'Cancel Pick before using Sweep'
    : pageState && !supportsSweep
      ? 'Reload this page to use Sweep'
      : '';
  pickPageLabelEl.textContent = pickerActive ? 'Cancel pick' : 'Pick to hide';
  pickPageEl.dataset.active = String(pickerActive);
  pickPageEl.setAttribute('aria-pressed', String(pickerActive));
  pickPageEl.disabled =
    pending ||
    (pickerBusy && !pickerActive) ||
    tabId === null ||
    !supportsPick ||
    (!pickerActive && (!urlReadable || settingsState?.site?.effective.enabled !== true));
  pickPageEl.title =
    pageState && !supportsPick
      ? pageState.picker?.available === false
        ? 'Pick requires closed component inspection and safe route identity in this browser'
        : 'Reload this page to use Pick'
      : !pickerActive && !urlReadable
        ? 'Pick is unavailable because this page address cannot be read'
        : !pickerActive && settingsState?.site?.effective.enabled === false
          ? 'Enable ByeBar on this site to use Pick'
          : '';
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
  renderSiteState();
  renderScope();
  renderSettings();
  debugEnabledEl.checked = Boolean(settingsState?.debugEnabled);
  debugEnabledEl.disabled = pending || !settingsState;
  scopeSiteEl.disabled = pending || !settingsState || !host;
  scopeGlobalEl.disabled = pending || !settingsState;
  renderPageState();
  reportBugEl.href = buildIssueUrl('bug');
  requestFeatureEl.href = buildIssueUrl('feature');
  clearTimeout(pickerSettleRefreshTimer);
  pickerSettleRefreshTimer = null;
  if (pageState?.picker?.busy === true && pageState.picker.active !== true) {
    pickerSettleRefreshTimer = setTimeout(async () => {
      pickerSettleRefreshTimer = null;
      if (pending) return render();
      await refreshPageState();
      render();
    }, PICKER_SETTLE_REFRESH_MS);
  }
}

function requestError(response, fallback) {
  const error = new Error(response?.error?.message || response?.error?.code || fallback);
  error.code = response?.error?.code || 'request-failed';
  return error;
}

function transportError(error, fallback) {
  const result = new Error(error?.message || fallback);
  result.isTransportError = true;
  return result;
}

async function requestSettings(message) {
  let response;
  try {
    response = await sendRuntimeMessage({ protocol: PROTOCOL, ...message });
  } catch (error) {
    throw transportError(error, 'Settings service unavailable');
  }
  if (!response) throw transportError(null, 'Settings response unavailable');
  if (!response.ok) throw requestError(response, 'Settings update failed');
  settingsState = response.state;
  return response;
}

async function mutateSettings(message, matches) {
  try {
    return await requestSettings(message);
  } catch (error) {
    if (!error.isTransportError) throw error;
    settingsState = null;
    try {
      await requestSettings({ type: 'byebar.settings.get', host: message.host || '' });
    } catch (verificationError) {
      throw new Error('Save status unknown; reopen ByeBar to verify', {
        cause: verificationError
      });
    }
    if (!matches(settingsState)) throw new Error('Save was not applied', { cause: error });
    return { ok: true, state: settingsState, reconciled: true };
  }
}

async function readActiveContext() {
  const [tab] = await tabsQuery({ active: true, currentWindow: true });
  const tabUrl = typeof tab?.url === 'string' ? tab.url : '';
  const parsed = window.ByeBar.lib.host.parseUrlContext(tabUrl);
  return {
    tabId: Number.isInteger(tab?.id) ? tab.id : null,
    host: parsed.host,
    urlReadable: parsed.readable
  };
}

async function loadActiveContext(context, initial = false) {
  settingsState = null;
  pageState = null;
  tabId = context.tabId;
  host = context.host;
  urlReadable = context.urlReadable;
  if (!host && (initial || scope === 'site')) scope = 'global';
  await requestSettings({ type: 'byebar.settings.get', host });
  await refreshPageState();
}

async function confirmActiveContext() {
  const current = await readActiveContext();
  if (current.tabId === tabId && current.host === host && current.urlReadable === urlReadable) return true;
  await loadActiveContext(current);
  setStatus('Active page changed; review and try again', true);
  return false;
}

async function requestPage(message) {
  let response;
  try {
    response = await sendTabMessage(tabId, { protocol: PROTOCOL, ...message });
  } catch (error) {
    throw transportError(error, 'Page connection unavailable');
  }
  if (!response) throw transportError(null, 'Page response unavailable');
  if (!response.ok) throw requestError(response, 'Page request failed');
  return response;
}

async function refreshPageState() {
  if (tabId === null) {
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

async function recoverActiveState() {
  try {
    const current = await readActiveContext();
    if (current.tabId !== tabId || current.host !== host || current.urlReadable !== urlReadable) {
      await loadActiveContext(current);
    } else await refreshPageState();
    return Boolean(pageState);
  } catch {
    pageState = null;
    return false;
  }
}

async function reconcilePageAfterSettings() {
  if (
    settingsState?.site?.effective.enabled === false &&
    pageState?.picker?.active === true &&
    tabId !== null
  ) {
    try {
      pageState = await requestPage({
        type: 'byebar.page.pick.cancel',
        documentId: pageState.documentId,
        sessionId: pageState.picker.sessionId
      });
      return;
    } catch {
      /* A state read below safely reconciles cancellation or navigation. */
    }
  }
  await refreshPageState();
}

async function updateSetting(key, value) {
  setPending(true);
  setStatus('Saving…');
  try {
    if (!(await confirmActiveContext())) return;
    const requestScope = scope;
    const requestHost = host;
    const response = await mutateSettings(
      {
        type: 'byebar.settings.update',
        scope: requestScope,
        host: requestHost,
        key,
        value
      },
      (state) =>
        requestScope === 'global'
          ? state?.global?.[key] === value
          : state?.site?.host === requestHost && state?.site?.overrides?.[key] === value
    );
    await reconcilePageAfterSettings();
    setStatus(response.reconciled ? 'Saved and verified' : 'Saved');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setPending(false);
    render();
  }
}

Object.entries(FEATURE_ROWS).forEach(([key, row]) => {
  row.input.addEventListener('change', () => {
    if (key === 'tosAccept' && row.input.checked) {
      row.input.checked = false;
      legalConfirmScopeEl.textContent =
        scope === 'site'
          ? `This applies only to ${host || 'the current site'}.`
          : 'This becomes the default for every site without an override.';
      legalConfirmEl.showModal();
      return;
    }
    void updateSetting(key, row.input.checked);
  });
});

legalConfirmEl.addEventListener('close', () => {
  const confirmed = legalConfirmEl.returnValue === 'confirm';
  legalConfirmEl.returnValue = '';
  render();
  if (confirmed) void updateSetting('tosAccept', true);
});

scopeSiteEl.addEventListener('click', () => {
  if (!host) return;
  scope = 'site';
  setStatus();
  render();
});

scopeGlobalEl.addEventListener('click', () => {
  scope = 'global';
  setStatus();
  render();
});

resetSiteEl.addEventListener('click', async () => {
  setPending(true);
  try {
    if (!(await confirmActiveContext())) return;
    const requestHost = host;
    const response = await mutateSettings(
      { type: 'byebar.settings.clearSite', host: requestHost },
      (state) => state?.site?.host === requestHost && state?.site?.hasOverrides === false
    );
    await reconcilePageAfterSettings();
    setStatus(response.reconciled ? 'Global defaults verified' : 'Using global defaults');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setPending(false);
    render();
  }
});

sweepPageEl.addEventListener('click', async () => {
  if (!pageState || tabId === null) return;
  setPending(true);
  setStatus('Sweeping this page...');
  let attemptedDocumentId = '';
  let requestAttempted = false;
  try {
    if (!(await confirmActiveContext())) return;
    if (!pageState || tabId === null) return;
    attemptedDocumentId = pageState.documentId;
    requestAttempted = true;
    const response = await requestPage({
      type: 'byebar.page.sweep',
      documentId: pageState.documentId
    });
    pageState = response;
    if (!response.sweep?.effective?.enabled) setStatus('ByeBar is paused on this page');
    else setStatus(sweepCopy(response.sweep));
  } catch (error) {
    const recovered = await recoverActiveState();
    if (!requestAttempted) setStatus(error.message, true);
    else if (error.code === 'stale-document') {
      setStatus(
        recovered ? 'Page changed; sweep state refreshed' : 'Page changed; current state unavailable',
        true
      );
    } else if (error.code === 'unknown-message') setStatus('Reload this page to use Sweep', true);
    else if (error.isTransportError) {
      const documentChanged = Boolean(pageState?.documentId) && pageState.documentId !== attemptedDocumentId;
      if (documentChanged) setStatus('Page changed during Sweep; the action may already have run', true);
      else if (!recovered) setStatus('Sweep status unknown; page state unavailable', true);
      else setStatus('Sweep status unknown; review the latest action', true);
    } else {
      setStatus(error.message, true);
    }
  } finally {
    setPending(false);
    render();
  }
});

function nextPickerSessionId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

pickPageEl.addEventListener('click', async () => {
  if (!pageState || tabId === null) return;
  setPending(true);
  let cancelling = false;
  let attemptedDocumentId = '';
  let attemptedSessionId = '';
  let requestAttempted = false;
  try {
    if (!(await confirmActiveContext())) return;
    if (!pageState || tabId === null) return;
    cancelling = pageState.picker?.active === true;
    attemptedDocumentId = pageState.documentId;
    attemptedSessionId = cancelling ? pageState.picker?.sessionId || '' : nextPickerSessionId();
    setStatus(cancelling ? 'Cancelling Pick...' : 'Starting Pick...');
    requestAttempted = true;
    const response = await requestPage({
      type: cancelling ? 'byebar.page.pick.cancel' : 'byebar.page.pick.start',
      documentId: attemptedDocumentId,
      sessionId: attemptedSessionId
    });
    pageState = response;
    setStatus(cancelling ? 'Pick cancelled' : 'Pick is active. Point to an interruption and click.');
  } catch (error) {
    const recovered = await recoverActiveState();
    const sameDocument = recovered && pageState?.documentId === attemptedDocumentId;
    const activeSession = sameDocument && pageState?.picker?.active === true;
    const pickerBusy = sameDocument && pageState?.picker?.busy === true;
    const sameSession = activeSession && pageState.picker.sessionId === attemptedSessionId;
    if (!requestAttempted) setStatus(error.message, true);
    else if (error.code === 'stale-document') {
      setStatus(recovered ? 'Page changed; Pick state refreshed' : 'Page changed; Pick unavailable', true);
    } else if (error.code === 'unknown-message' || error.code === 'picker-unavailable') {
      setStatus('Reload this page to use Pick', true);
    } else if (error.code === 'paused') {
      setStatus('ByeBar is paused on this page', true);
    } else if (error.code === 'settings-timeout') {
      setStatus('Page settings took too long; try Pick again', true);
    } else if (error.code === 'page-hidden' || error.code === 'page-changed') {
      setStatus('Page changed; reopen it and start Pick again', true);
    } else if (error.code === 'picker-cancelled') {
      setStatus('Pick was cancelled');
    } else if (error.code === 'picker-busy') {
      setStatus('Pick is finishing; try again in a moment', true);
    } else if (
      error.code === 'native-modal-active' ||
      error.code === 'fullscreen-active' ||
      error.code === 'top-layer-active'
    ) {
      setStatus('Close the active dialog or full-screen view before using Pick', true);
    } else if (error.code === 'picker-active' && activeSession) {
      setStatus('Pick is already active on this page');
    } else if (error.isTransportError && !cancelling && sameSession) {
      setStatus('Pick is active. Point to an interruption and click.');
    } else if (error.isTransportError && cancelling && sameDocument && !activeSession && !pickerBusy) {
      setStatus('Pick cancelled');
    } else if (error.isTransportError && cancelling && activeSession && !sameSession) {
      setStatus('Pick session changed; reopen ByeBar to verify', true);
    } else if (error.isTransportError) {
      setStatus('Pick status unknown; reopen ByeBar to verify', true);
    } else setStatus(error.message, true);
  } finally {
    setPending(false);
    render();
  }
});

undoActionEl.addEventListener('click', async () => {
  if (!pageState?.undoAction || tabId === null) return;
  setPending(true);
  let attemptedDocumentId = '';
  let attemptedActionId = '';
  let requestAttempted = false;
  try {
    if (!(await confirmActiveContext())) return;
    if (!pageState?.undoAction || tabId === null) return;
    attemptedDocumentId = pageState.documentId;
    attemptedActionId = pageState.undoAction.id;
    requestAttempted = true;
    const response = await requestPage({
      type: 'byebar.page.undo',
      documentId: attemptedDocumentId,
      actionId: attemptedActionId
    });
    pageState = response;
    setStatus(undoStatus(undoActionCount(response)));
  } catch (error) {
    const recovered = await recoverActiveState();
    if (!requestAttempted) setStatus(error.message, true);
    else if (error.code === 'stale-document') {
      setStatus(recovered ? 'Page changed; actions refreshed' : 'Page changed; actions unavailable', true);
    } else if (error.code === 'not-latest-hide') {
      setStatus(
        recovered
          ? 'Page actions changed; Undo refreshed'
          : 'Page actions changed; current state unavailable',
        true
      );
    } else if (error.code === 'target-gone') {
      setStatus(
        recovered
          ? 'That hide is no longer available; Undo refreshed'
          : 'That hide is no longer available; current state unavailable',
        true
      );
    } else if (error.isTransportError) {
      const reconciled =
        recovered &&
        pageState?.documentId === attemptedDocumentId &&
        pageState?.lastAction?.operation === 'undo' &&
        pageState.lastAction.id === attemptedActionId;
      if (reconciled) setStatus(undoStatus(undoActionCount()));
      else setStatus('Undo status unknown; review the page before undoing again', true);
    } else setStatus(error.message, true);
  } finally {
    setPending(false);
    render();
  }
});

debugEnabledEl.addEventListener('change', async () => {
  const enabled = debugEnabledEl.checked;
  setPending(true);
  try {
    if (!(await confirmActiveContext())) return;
    const requestHost = host;
    const response = await mutateSettings(
      { type: 'byebar.debug.set', host: requestHost, enabled },
      (state) => state?.debugEnabled === enabled
    );
    await refreshPageState();
    const label = enabled ? 'Local diagnostics enabled' : 'Local diagnostics disabled';
    setStatus(response.reconciled ? `${label} and verified` : label);
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
    if (!(await confirmActiveContext())) return;
    if (!pageState || tabId === null) return;
    const response = await requestPage({
      type: 'byebar.page.debug.clear',
      documentId: pageState.documentId
    });
    pageState = response;
    setStatus('Page decisions cleared');
  } catch (error) {
    await refreshPageState();
    setStatus(error.code === 'stale-document' ? 'Page changed; decisions refreshed' : error.message, true);
  } finally {
    setPending(false);
    render();
  }
});

async function init() {
  setPending(true);
  try {
    await loadActiveContext(await readActiveContext(), true);
    initializationState = 'ready';
  } catch (error) {
    initializationState = 'error';
    setStatus(error.message, true);
  } finally {
    setPending(false);
    render();
  }
}

void init();
