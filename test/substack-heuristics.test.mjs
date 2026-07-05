import { describe, expect, it } from 'vitest';
import {
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
  }
};

describe('matchesSubstackSignupText', () => {
  it('detects join-on-substack copy', () => {
    expect(matchesSubstackSignupText('Join Aaron Parnas on Substack')).toBe(true);
    expect(matchesSubstackSignupText('Welcome to our blog.')).toBe(false);
  });
});

describe('isSubstackRadixDialog', () => {
  it('detects radix pencraft signup dialogs', () => {
    expect(isSubstackRadixDialog(SIGNUP_MODAL)).toBe(true);
  });
});

describe('looksLikeSubstackSignupModal', () => {
  it('flags join/get-the-app modals', () => {
    expect(looksLikeSubstackSignupModal(SIGNUP_MODAL)).toBe(true);
  });
});

describe('isSubstackRadixBackdrop', () => {
  it('detects radix scrims and background layers', () => {
    expect(
      isSubstackRadixBackdrop({
        nodeType: 1,
        id: 'radix-P0-1',
        role: null,
        className: 'background-qPxN3C',
        getAttribute(name) {
          if (name === 'data-state') return 'open';
          return null;
        }
      })
    ).toBe(true);
  });
});
