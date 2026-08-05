import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGE_PROTOCOL_VERSION } from '../lib/constants.mjs';

const source = readFileSync(new URL('../content/actions.js', import.meta.url), 'utf8');

function loadActions(
  localGet = async (defaults) => defaults,
  visibilityOverrides = {},
  pickerOverrides = {}
) {
  const listeners = {};
  const browser = {
    localGet: vi.fn(localGet),
    onStorageChanged: (listener) => (listeners.storage = listener),
    api: {
      runtime: {
        onMessage: { addListener: (listener) => (listeners.message = listener) }
      }
    }
  };
  const visibility = {
    isHidden: () => false,
    hasAction: () => false,
    hide: () => false,
    restoreAction: () => [],
    forgetAction: () => false,
    ...visibilityOverrides
  };
  const document = {
    activeElement: null,
    body: null,
    hasFocus: () => true,
    addEventListener: vi.fn(),
    querySelector: () => null
  };
  const engine = {
    sweepPage: vi.fn(async () => ({
      effective: { enabled: true },
      result: {
        outcome: 'no-op',
        counts: { reversibleHides: 0, dismissActions: 0, cookieDeclines: 0, legalAccepts: 0 }
      }
    }))
  };
  const picker = {
    state: () => ({ active: false, busy: false, sessionId: '' }),
    blocksAutomation: () => false,
    start: vi.fn(async () => ({ ok: true })),
    cancel: vi.fn(() => ({ ok: true })),
    ...pickerOverrides
  };
  const ByeBar = { browser, engine, picker, visibility, lib: { constants: { MESSAGE_PROTOCOL_VERSION } } };
  const window = { ByeBar };
  const context = vm.createContext({
    window,
    document,
    crypto: { randomUUID: () => 'document-id' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    requestAnimationFrame: vi.fn(),
    console
  });
  vm.runInContext(source, context);
  return { actions: ByeBar.actions, engine, listeners, picker };
}

function createActionVisibility() {
  const entries = new Map();
  return {
    isHidden: () => false,
    hide: vi.fn((el, _reason, { actionId }) => {
      if (!entries.has(actionId)) entries.set(actionId, []);
      entries.get(actionId).push(el);
      return true;
    }),
    hasAction: vi.fn((actionId) => entries.has(actionId)),
    restoreAction: vi.fn((actionId) => {
      const restored = entries.get(actionId) || [];
      entries.delete(actionId);
      return restored;
    }),
    forgetAction: vi.fn((actionId) => entries.delete(actionId))
  };
}

function commitHide(actions, element = {}) {
  const action = actions.begin({ operation: 'hide' });
  expect(actions.hide(action, element, 'generic')).toBe(true);
  expect(actions.commit(action)).toBe(true);
  return { action, element };
}

async function sendPageRequest(listeners, type, values = {}) {
  return new Promise((resolve) => {
    const handled = listeners.message({ protocol: MESSAGE_PROTOCOL_VERSION, type, ...values }, {}, resolve);
    expect(handled).toBe(true);
  });
}

describe('page action state', () => {
  it('does not let a stale diagnostics read overwrite a newer storage event', async () => {
    let resolveInitial;
    const initial = new Promise((resolve) => {
      resolveInitial = resolve;
    });
    const { actions, listeners } = loadActions(() => initial);

    listeners.storage({ 'byebar.debug': { newValue: { schemaVersion: 1, enabled: true } } }, 'local');
    resolveInitial({ 'byebar.debug': { schemaVersion: 1, enabled: false } });
    await actions.ready;

    expect(actions.pageState().debugEnabled).toBe(true);
  });

  it('responds to protocol mismatches and unknown page requests', async () => {
    const { actions, listeners } = loadActions();
    await actions.ready;

    const protocolResponse = vi.fn();
    listeners.message(
      { protocol: MESSAGE_PROTOCOL_VERSION + 1, type: 'byebar.page.getState' },
      {},
      protocolResponse
    );
    expect(protocolResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'protocol-mismatch' }) })
    );

    const unknownResponse = vi.fn();
    expect(
      listeners.message(
        { protocol: MESSAGE_PROTOCOL_VERSION, type: 'byebar.page.unknown' },
        {},
        unknownResponse
      )
    ).toBe(true);
    await vi.waitFor(() =>
      expect(unknownResponse).toHaveBeenCalledWith(
        expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'unknown-message' }) })
      )
    );
  });

  it('rejects stale sweeps before scanning and returns the current sweep result', async () => {
    const { actions, engine, listeners } = loadActions();
    await actions.ready;

    const staleResponse = vi.fn();
    listeners.message(
      {
        protocol: MESSAGE_PROTOCOL_VERSION,
        type: 'byebar.page.sweep',
        documentId: 'old-document'
      },
      {},
      staleResponse
    );
    await vi.waitFor(() =>
      expect(staleResponse).toHaveBeenCalledWith(
        expect.objectContaining({ ok: false, error: { code: 'stale-document' } })
      )
    );
    expect(engine.sweepPage).not.toHaveBeenCalled();

    const currentResponse = vi.fn();
    listeners.message(
      {
        protocol: MESSAGE_PROTOCOL_VERSION,
        type: 'byebar.page.sweep',
        documentId: 'document-id'
      },
      {},
      currentResponse
    );
    await vi.waitFor(() =>
      expect(currentResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          documentId: 'document-id',
          capabilities: ['sweep', 'pick'],
          picker: { active: false, busy: false, sessionId: '' },
          sweep: {
            effective: { enabled: true },
            result: {
              outcome: 'no-op',
              counts: { reversibleHides: 0, dismissActions: 0, cookieDeclines: 0, legalAccepts: 0 }
            }
          }
        })
      )
    );
    expect(engine.sweepPage).toHaveBeenCalledOnce();
  });

  it('counts only actions applied during the captured sweep pass', () => {
    const { actions } = loadActions(undefined, { hide: vi.fn(() => true) });
    actions.recordIrreversible({ operation: 'dismiss' });

    const transaction = actions.begin({ operation: 'hide' });
    const result = actions.captureSweepResult(() => {
      actions.hide(transaction, {}, 'generic');
      actions.hide(transaction, {}, 'generic');
      actions.commit(transaction);
      actions.recordIrreversible({ operation: 'dismiss' });
      actions.recordIrreversible({ operation: 'decline' });
      actions.recordIrreversible({ operation: 'accept' });
    });

    expect(result).toEqual({
      outcome: 'applied',
      counts: { reversibleHides: 2, dismissActions: 1, cookieDeclines: 1, legalAccepts: 1 }
    });
  });

  it('routes document-scoped picker sessions and blocks other page actions while active', async () => {
    let activeSessionId = '';
    const picker = {
      state: () => ({
        active: Boolean(activeSessionId),
        busy: Boolean(activeSessionId),
        sessionId: activeSessionId
      }),
      blocksAutomation: () => Boolean(activeSessionId),
      start: vi.fn(async (requestedSessionId) => {
        activeSessionId = requestedSessionId;
        return { ok: true };
      }),
      cancel: vi.fn((requestedSessionId) => {
        if (requestedSessionId !== activeSessionId) {
          return { ok: false, error: { code: 'stale-picker-session' } };
        }
        activeSessionId = '';
        return { ok: true };
      })
    };
    const loaded = loadActions(undefined, {}, picker);
    await loaded.actions.ready;

    expect(
      await sendPageRequest(loaded.listeners, 'byebar.page.pick.start', {
        documentId: 'old-document',
        sessionId: 'pick-1'
      })
    ).toEqual({ ok: false, error: { code: 'stale-document' } });
    expect(picker.start).not.toHaveBeenCalled();

    const started = await sendPageRequest(loaded.listeners, 'byebar.page.pick.start', {
      documentId: 'document-id',
      sessionId: 'pick-1'
    });
    expect(started).toMatchObject({
      ok: true,
      documentId: 'document-id',
      picker: { active: true, busy: true, sessionId: 'pick-1' }
    });
    expect(
      await sendPageRequest(loaded.listeners, 'byebar.page.sweep', { documentId: 'document-id' })
    ).toEqual({ ok: false, error: { code: 'picker-active' } });
    expect(loaded.engine.sweepPage).not.toHaveBeenCalled();

    expect(
      await sendPageRequest(loaded.listeners, 'byebar.page.pick.cancel', {
        documentId: 'document-id',
        sessionId: 'other-pick'
      })
    ).toEqual({ ok: false, error: { code: 'stale-picker-session' } });
    const cancelled = await sendPageRequest(loaded.listeners, 'byebar.page.pick.cancel', {
      documentId: 'document-id',
      sessionId: 'pick-1'
    });
    expect(cancelled.picker).toEqual({ active: false, busy: false, sessionId: '' });
  });

  it('reports a no-op for skipped and unsuccessful sweep actions', () => {
    const { actions } = loadActions();
    const transaction = actions.begin({ operation: 'hide' });

    expect(
      actions.captureSweepResult(() => {
        actions.hide(transaction, {}, 'generic');
        actions.skip({ operation: 'hide' });
      })
    ).toEqual({
      outcome: 'no-op',
      counts: { reversibleHides: 0, dismissActions: 0, cookieDeclines: 0, legalAccepts: 0 }
    });
  });

  it('clears sweep accounting when a pass throws', () => {
    const { actions } = loadActions();
    expect(() =>
      actions.captureSweepResult(() => {
        actions.recordIrreversible({ operation: 'dismiss' });
        throw new Error('scan failed');
      })
    ).toThrow('scan failed');
    expect(actions.captureSweepResult(() => {})).toEqual({
      outcome: 'no-op',
      counts: { reversibleHides: 0, dismissActions: 0, cookieDeclines: 0, legalAccepts: 0 }
    });
  });

  it('keeps ten recent hide actions without restoring the expired marker', () => {
    const visibility = createActionVisibility();
    const { actions } = loadActions(undefined, visibility);
    const committed = Array.from({ length: 11 }, () => commitHide(actions));

    expect(actions.pageState()).toMatchObject({
      undoAction: { id: committed[10].action.id, canUndo: true },
      undoActionCount: 10
    });
    expect(visibility.forgetAction).toHaveBeenCalledOnce();
    expect(visibility.forgetAction).toHaveBeenCalledWith(committed[0].action.id);
    expect(visibility.restoreAction).not.toHaveBeenCalled();
  });

  it('undoes hide actions newest-first while preserving irreversible history', async () => {
    const visibility = createActionVisibility();
    const { actions, listeners } = loadActions(undefined, visibility);
    const first = commitHide(actions);
    const second = commitHide(actions);
    const third = commitHide(actions);
    actions.recordIrreversible({ operation: 'decline' });
    await actions.ready;

    expect(actions.pageState()).toMatchObject({
      lastAction: { operation: 'decline', reversible: false },
      undoAction: { id: third.action.id },
      undoActionCount: 3
    });

    expect(
      await sendPageRequest(listeners, 'byebar.page.undo', {
        documentId: 'document-id',
        actionId: first.action.id
      })
    ).toEqual({ ok: false, error: { code: 'not-latest-hide' } });

    const thirdResponse = await sendPageRequest(listeners, 'byebar.page.undo', {
      documentId: 'document-id',
      actionId: third.action.id
    });
    expect(thirdResponse).toMatchObject({
      lastAction: { id: third.action.id, operation: 'undo' },
      undoAction: { id: second.action.id },
      undoActionCount: 2
    });
    expect(actions.isSuppressed(third.element)).toBe(true);
    const retry = actions.begin({ operation: 'hide' });
    expect(actions.hide(retry, third.element, 'generic')).toBe(false);

    expect(
      await sendPageRequest(listeners, 'byebar.page.undo', {
        documentId: 'document-id',
        actionId: third.action.id
      })
    ).toEqual({ ok: false, error: { code: 'not-latest-hide' } });
    expect(visibility.restoreAction).toHaveBeenCalledTimes(1);

    const secondResponse = await sendPageRequest(listeners, 'byebar.page.undo', {
      documentId: 'document-id',
      actionId: second.action.id
    });
    expect(secondResponse).toMatchObject({
      undoAction: { id: first.action.id },
      undoActionCount: 1
    });
  });

  it('allows an explicit manual pick to hide an element again after Undo suppression', async () => {
    const visibility = createActionVisibility();
    const { actions, listeners } = loadActions(undefined, visibility);
    const { action, element } = commitHide(actions);
    await actions.ready;

    await sendPageRequest(listeners, 'byebar.page.undo', {
      documentId: 'document-id',
      actionId: action.id
    });
    expect(actions.isSuppressed(element)).toBe(true);

    const repick = actions.begin({ operation: 'hide', feature: 'manualHide' });
    expect(actions.hide(repick, element, 'manual', { userInitiated: true })).toBe(true);
    expect(actions.commit(repick)).toBe(true);
    expect(actions.isSuppressed(element)).toBe(false);
  });
});
