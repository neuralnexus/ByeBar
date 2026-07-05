const DEFAULTS = {
  enabled: true,
  genericBlocking: true,
  cookieDecline: true,
  siteOverrides: {}
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULTS, (stored) => {
    chrome.storage.sync.set({ ...DEFAULTS, ...stored });
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'getSettings') return;

  chrome.storage.sync.get(DEFAULTS, (settings) => {
    sendResponse(settings);
  });
  return true;
});