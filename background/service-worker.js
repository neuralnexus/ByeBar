importScripts('../shared/browser.js');

const { storageGet, storageSet } = self.ByeBar.browser;
const DEFAULTS = {
  enabled: true,
  genericBlocking: true,
  cookieDecline: true,
  tosAccept: true,
  siteOverrides: {}
};

self.ByeBar.browser.api.runtime.onInstalled.addListener(async () => {
  const stored = await storageGet(DEFAULTS);
  await storageSet({ ...DEFAULTS, ...stored });
});

self.ByeBar.browser.api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'getSettings') return;

  storageGet(DEFAULTS).then(sendResponse);
  return true;
});
