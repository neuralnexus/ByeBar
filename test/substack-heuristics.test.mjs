import { describe, expect, it } from 'vitest';
import {
  isInsideModalViewer,
  isSubstackModalScrim,
  isSubstackRadixBackdrop,
  isSubstackRadixDialog,
  looksLikeSubstackSignupModal,
  matchesSubstackSignupText
} from '../lib/substack-heuristics.mjs';

const SIGNUP_MODAL = {
  nodeType: 1,
  tagName: 'DIV',
  id: 'radix-P0-237',
  role: 'dialog',
  className: 'panel-ulWfet',
  getAttribute(name) {
    const attrs = {
      role: 'dialog',
      id: 'radix-P0-237',
      'data-testid': 'modal',
      'data-state': 'open'
    };
    return attrs[name] ?? null;
  },
  textContent:
    'Join Aaron Parnas on Substack The home for great writing, podcasts, and video. Sign in Get the app',
  querySelector(sel) {
    if (sel.includes('data-modal-role')) return { nodeType: 1 };
    if (sel.includes('button')) return { nodeType: 1 };
    return null;
  },
  closest() {
    return null;
  }
};

const GENERIC_RADIX_DIALOG = {
  nodeType: 1,
  tagName: 'DIV',
  id: 'radix-P0-999',
  className: 'panel-abc123',
  getAttribute(name) {
    return name === 'role' ? 'dialog' : name === 'data-testid' ? null : null;
  },
  textContent: 'Account settings and preferences',
  querySelector: () => null,
  closest: () => null
};

describe('matchesSubstackSignupText', () => {
  it('detects join-on-substack copy', () => {
    expect(matchesSubstackSignupText('Join Aaron Parnas on Substack')).toBe(true);
    expect(matchesSubstackSignupText('Welcome to our blog.')).toBe(false);
  });
});

describe('isSubstackRadixDialog', () => {
  it('detects signup modals with modal chrome', () => {
    expect(isSubstackRadixDialog(SIGNUP_MODAL)).toBe(true);
  });

  it('ignores unrelated radix dialogs', () => {
    expect(isSubstackRadixDialog(GENERIC_RADIX_DIALOG)).toBe(false);
  });
});

describe('looksLikeSubstackSignupModal', () => {
  it('flags join/get-the-app modals', () => {
    expect(looksLikeSubstackSignupModal(SIGNUP_MODAL)).toBe(true);
  });

  it('does not flag unrelated dialogs', () => {
    expect(looksLikeSubstackSignupModal(GENERIC_RADIX_DIALOG)).toBe(false);
  });
});

describe('isSubstackRadixBackdrop', () => {
  it('detects radix scrims', () => {
    expect(
      isSubstackRadixBackdrop({
        nodeType: 1,
        id: 'radix-P0-1',
        role: null,
        className: '',
        textContent: '',
        getAttribute(name) {
          if (name === 'data-state') return 'open';
          return null;
        }
      })
    ).toBe(true);
  });

  it('ignores background layers outside modal viewers unless on a substack page', () => {
    const scrim = {
      nodeType: 1,
      id: '',
      role: null,
      className: 'background-qPxN3C',
      textContent: '',
      getAttribute: () => null,
      closest: () => null
    };

    expect(isSubstackRadixBackdrop(scrim)).toBe(false);
    expect(isSubstackRadixBackdrop(scrim, true)).toBe(true);
  });
});

describe('isInsideModalViewer', () => {
  it('detects modal viewer ancestors', () => {
    expect(
      isInsideModalViewer({
        className: 'post-content',
        closest(sel) {
          return sel.includes('modalViewer') ? { nodeType: 1 } : null;
        }
      })
    ).toBe(true);
  });
});

describe('isSubstackModalScrim', () => {
  const SCRIM = {
    nodeType: 1,
    className: 'background-qPxN3C',
    textContent: '',
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 1200, height: 900 }),
    closest(sel) {
      return sel.includes('modalViewer') ? { nodeType: 1 } : null;
    }
  };

  const ORPHAN_SCRIM = {
    nodeType: 1,
    className: 'background-qPxN3C',
    textContent: '',
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 1200, height: 900 }),
    closest: () => null
  };

  it('requires modal viewer context for hashed scrim classes by default', () => {
    expect(isSubstackModalScrim(SCRIM, () => ({ position: 'fixed' }))).toBe(true);
    expect(isSubstackModalScrim(ORPHAN_SCRIM, () => ({ position: 'fixed' }))).toBe(false);
  });

  it('accepts portaled scrims on substack pages', () => {
    expect(isSubstackModalScrim(ORPHAN_SCRIM, () => ({ position: 'fixed' }), true)).toBe(true);
  });
});
