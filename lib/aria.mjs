export function roleTokens(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function hasRole(el, role) {
  const expected = String(role || '').toLowerCase();
  return Boolean(expected && roleTokens(el?.getAttribute?.('role')).includes(expected));
}

export function hasAnyRole(el, roles) {
  const expected = roles instanceof Set ? roles : new Set(roles || []);
  return roleTokens(el?.getAttribute?.('role')).some((role) => expected.has(role));
}
