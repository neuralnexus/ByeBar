import { describe, expect, it } from 'vitest';
import {
  createGeolocationDeniedError,
  GEOLOCATION_DENIED_CODE,
  isGeolocationPermissionQuery,
  shouldDeclineLocation
} from '../lib/geolocation.mjs';
import { DEFAULT_SETTINGS } from '../lib/constants.mjs';

describe('shouldDeclineLocation', () => {
  it('declines when enabled globally', () => {
    expect(shouldDeclineLocation(DEFAULT_SETTINGS, 'www.mercedes-benz.com')).toBe(true);
  });

  it('respects per-site disable', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      siteOverrides: { 'mercedes-benz.com': false }
    };
    expect(shouldDeclineLocation(settings, 'www.mercedes-benz.com')).toBe(false);
  });

  it('skips when locationDecline is off', () => {
    expect(shouldDeclineLocation({ ...DEFAULT_SETTINGS, locationDecline: false }, 'example.com')).toBe(false);
  });
});

describe('createGeolocationDeniedError', () => {
  it('matches PERMISSION_DENIED shape', () => {
    const error = createGeolocationDeniedError();
    expect(error.code).toBe(GEOLOCATION_DENIED_CODE);
    expect(error.PERMISSION_DENIED).toBe(GEOLOCATION_DENIED_CODE);
  });
});

describe('isGeolocationPermissionQuery', () => {
  it('detects geolocation permission names', () => {
    expect(isGeolocationPermissionQuery({ name: 'geolocation' })).toBe(true);
    expect(isGeolocationPermissionQuery({ name: 'geolocation-system' })).toBe(true);
    expect(isGeolocationPermissionQuery({ name: 'notifications' })).toBe(false);
  });
});
