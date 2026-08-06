import { describe, expect, it } from 'vitest';
import { hasAnyRole, hasRole, roleTokens } from '../lib/aria.mjs';

describe('ARIA role tokens', () => {
  it('normalizes case and whitespace across fallback role lists', () => {
    const element = { getAttribute: () => '  alertdialog   DIALOG  ' };

    expect(roleTokens(element.getAttribute('role'))).toEqual(['alertdialog', 'dialog']);
    expect(hasRole(element, 'dialog')).toBe(true);
    expect(hasAnyRole(element, new Set(['main', 'dialog']))).toBe(true);
  });
});
