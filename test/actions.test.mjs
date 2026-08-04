import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGE_PROTOCOL_VERSION } from '../lib/constants.mjs';

const source = readFileSync(new URL('../content/actions.js', import.meta.url), 'utf8');

function loadActions(localGet = async (defaults) => defaults, visibilityOverrides = {}) {
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
  const ByeBar = { browser, engine, visibility, lib: { constants: { MESSAGE_PROTOCOL_VERSION } } };
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
  return { actions: ByeBar.actions, engine, listeners };
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
          capabilities: ['sweep'],
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
});
