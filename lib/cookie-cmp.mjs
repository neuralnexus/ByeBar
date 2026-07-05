export function declineSourcepoint(win = globalThis) {
  try {
    const sp = win._sp_;
    if (!sp) return false;

    const scopes = [sp.gdpr, sp.cc, sp.usnat, sp.ccpa, sp];
    for (const scope of scopes) {
      if (scope && typeof scope.rejectAll === 'function') {
        scope.rejectAll();
        return true;
      }
    }
  } catch {
    /* ignore */
  }

  return false;
}

export function declineCookiebot(win = globalThis) {
  try {
    const bot = win.Cookiebot;
    if (!bot) return false;

    if (typeof bot.withdraw === 'function') {
      bot.withdraw();
      return true;
    }

    if (typeof bot.hide === 'function') {
      bot.hide();
      return true;
    }
  } catch {
    /* ignore */
  }

  return false;
}

export function declineQuantcast(win = globalThis) {
  try {
    const cmp = win.__cmp;
    if (typeof cmp === 'function') {
      cmp('rejectAll');
      return true;
    }
  } catch {
    /* ignore */
  }

  return false;
}

export function declineIubenda(win = globalThis) {
  try {
    const api = win._iub?.cs?.api;
    if (api) {
      if (typeof api.reject === 'function') {
        api.reject();
        return true;
      }
      if (typeof api.close === 'function') {
        api.close();
        return true;
      }
    }
  } catch {
    /* ignore */
  }

  return false;
}

export function declineOneTrust(win = globalThis) {
  try {
    if (typeof win.OneTrust?.RejectAll === 'function') {
      win.OneTrust.RejectAll();
      return true;
    }

    if (typeof win.Optanon?.RejectAll === 'function') {
      win.Optanon.RejectAll();
      return true;
    }

    if (typeof win.OneTrust?.ToggleInfoDisplay === 'function') {
      const handler = win.document?.getElementById?.('onetrust-reject-all-handler');
      if (handler) {
        handler.click();
        return true;
      }
    }
  } catch {
    /* ignore */
  }

  return false;
}

export function declineKetch(win = globalThis) {
  try {
    const ketch = win.ketch;
    if (typeof ketch === 'function') {
      ketch('deny', { showRightsForm: false });
      return true;
    }
  } catch {
    /* ignore */
  }

  return false;
}
