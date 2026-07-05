/**
 * ByeBar — auto-decline navigator.geolocation prompts.
 */
(() => {
  if (window.__byeBarGeoPatched) return;

  const BYEBAR = window.ByeBar;
  const { storageGet, onStorageChanged } = BYEBAR?.browser || {};
  if (!storageGet) return;

  const DEFAULTS = {
    enabled: true,
    locationDecline: true,
    siteOverrides: {}
  };

  const PERMISSION_DENIED = 1;
  const deniedError = {
    code: PERMISSION_DENIED,
    message: 'User denied Geolocation',
    PERMISSION_DENIED
  };

  let shouldDecline = true;

  function hostKey() {
    return location.hostname.replace(/^www\./i, '');
  }

  function updateFromSettings(settings) {
    const key = hostKey();
    const siteOn = key in settings.siteOverrides ? settings.siteOverrides[key] : settings.enabled;
    shouldDecline = Boolean(siteOn && settings.locationDecline);
  }

  function callDenied(errorCallback) {
    if (typeof errorCallback === 'function') {
      queueMicrotask(() => errorCallback(deniedError));
    }
  }

  const nativeGeolocation = navigator.geolocation;

  const blockedGeolocation = {
    getCurrentPosition(success, error, options) {
      if (!shouldDecline && nativeGeolocation) {
        return nativeGeolocation.getCurrentPosition(success, error, options);
      }
      callDenied(error);
    },
    watchPosition(success, error, options) {
      if (!shouldDecline && nativeGeolocation) {
        return nativeGeolocation.watchPosition(success, error, options);
      }
      callDenied(error);
      return 0;
    },
    clearWatch(id) {
      nativeGeolocation?.clearWatch?.(id);
    }
  };

  try {
    Object.defineProperty(navigator, 'geolocation', {
      get() {
        return shouldDecline ? blockedGeolocation : nativeGeolocation;
      },
      configurable: true,
      enumerable: true
    });
  } catch {
    /* ignore */
  }

  if (navigator.permissions?.query) {
    const nativeQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function patchedQuery(descriptor) {
      const name = descriptor?.name;
      if (shouldDecline && (name === 'geolocation' || name === 'geolocation-system')) {
        return Promise.resolve({ state: 'denied', onchange: null });
      }
      return nativeQuery(descriptor);
    };
  }

  window.__byeBarGeoPatched = true;

  void storageGet(DEFAULTS).then(updateFromSettings);
  onStorageChanged(() => {
    void storageGet(DEFAULTS).then(updateFromSettings);
  });

  BYEBAR.geolocation = {
    get shouldDecline() {
      return shouldDecline;
    }
  };
})();
