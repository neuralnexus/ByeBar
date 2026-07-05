const { storageGet, storageSet, api } = window.ByeBar.browser;

const DEFAULTS = {
  enabled: true,
  genericBlocking: true,
  cookieDecline: true,
  tosAccept: true,
  locationDecline: true,
  netsuiteLeadRedirect: true,
  siteOverrides: {}
};

const siteEnabledEl = document.getElementById('site-enabled');
const genericBlockingEl = document.getElementById('generic-blocking');
const cookieDeclineEl = document.getElementById('cookie-decline');
const tosAcceptEl = document.getElementById('tos-accept');
const locationDeclineEl = document.getElementById('location-decline');
const bypassLeadFormsEl = document.getElementById('bypass-lead-forms');
const hostLabelEl = document.getElementById('host-label');

let host = '';
let settings = { ...DEFAULTS };

function normalizeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function siteEnabledForHost() {
  if (host && host in settings.siteOverrides) return settings.siteOverrides[host];
  return settings.enabled;
}

function render() {
  siteEnabledEl.checked = siteEnabledForHost();
  genericBlockingEl.checked = settings.genericBlocking;
  cookieDeclineEl.checked = settings.cookieDecline;
  tosAcceptEl.checked = settings.tosAccept;
  locationDeclineEl.checked = settings.locationDecline;
  bypassLeadFormsEl.checked = settings.netsuiteLeadRedirect;
  hostLabelEl.textContent = host || 'Unknown site';
}

async function save(partial) {
  settings = { ...settings, ...partial };
  await storageSet(settings);
}

async function init() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  host = normalizeHost(tab?.url || '');
  settings = { ...DEFAULTS, ...(await storageGet(DEFAULTS)) };
  render();
}

siteEnabledEl.addEventListener('change', () => {
  const overrides = { ...settings.siteOverrides };
  if (siteEnabledEl.checked) {
    delete overrides[host];
  } else {
    overrides[host] = false;
  }
  void save({ siteOverrides: overrides });
});

genericBlockingEl.addEventListener('change', () => {
  void save({ genericBlocking: genericBlockingEl.checked });
});

cookieDeclineEl.addEventListener('change', () => {
  void save({ cookieDecline: cookieDeclineEl.checked });
});

tosAcceptEl.addEventListener('change', () => {
  void save({ tosAccept: tosAcceptEl.checked });
});

locationDeclineEl.addEventListener('change', () => {
  void save({ locationDecline: locationDeclineEl.checked });
});

bypassLeadFormsEl.addEventListener('change', () => {
  void save({ netsuiteLeadRedirect: bypassLeadFormsEl.checked });
});

void init();
