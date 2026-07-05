const DEFAULTS = {
  enabled: true,
  genericBlocking: true,
  cookieDecline: true,
  siteOverrides: {}
};

const siteEnabledEl = document.getElementById('site-enabled');
const genericBlockingEl = document.getElementById('generic-blocking');
const cookieDeclineEl = document.getElementById('cookie-decline');
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
  hostLabelEl.textContent = host ? `Current site: ${host}` : '';
}

function save(partial) {
  settings = { ...settings, ...partial };
  chrome.storage.sync.set(settings);
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  host = normalizeHost(tab?.url || '');
  chrome.storage.sync.get(DEFAULTS, (stored) => {
    settings = { ...DEFAULTS, ...stored };
    render();
  });
}

siteEnabledEl.addEventListener('change', () => {
  const overrides = { ...settings.siteOverrides };
  if (siteEnabledEl.checked) {
    delete overrides[host];
  } else {
    overrides[host] = false;
  }
  save({ siteOverrides: overrides });
});

genericBlockingEl.addEventListener('change', () => {
  save({ genericBlocking: genericBlockingEl.checked });
});

cookieDeclineEl.addEventListener('change', () => {
  save({ cookieDecline: cookieDeclineEl.checked });
});

init();