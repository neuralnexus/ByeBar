import { hostKey } from './host.mjs';

export const GEOLOCATION_DENIED_CODE = 1;

export function createGeolocationDeniedError() {
  return {
    code: GEOLOCATION_DENIED_CODE,
    message: 'User denied Geolocation',
    PERMISSION_DENIED: GEOLOCATION_DENIED_CODE
  };
}

export function shouldDeclineLocation(settings, hostname) {
  const key = hostKey(hostname);
  const siteOn =
    key && settings?.siteOverrides && key in settings.siteOverrides
      ? settings.siteOverrides[key]
      : settings?.enabled;
  return Boolean(siteOn && settings?.locationDecline);
}

export function isGeolocationPermissionQuery(descriptor) {
  const name = descriptor?.name;
  return name === 'geolocation' || name === 'geolocation-system';
}
