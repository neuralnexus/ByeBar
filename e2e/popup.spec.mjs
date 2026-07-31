import { test, expect } from './fixtures.mjs';

test('popup edits site overrides, enables diagnostics, and undoes the latest hide', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/settings-restoration.html');
  await expect(page.locator('#restorable')).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(page.locator('.cookie-banner')).toHaveCount(0);

  const fixtureTabId = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.includes('settings-restoration.html'))?.id;
  });
  const popup = await context.newPage();
  await serviceWorker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), fixtureTabId);
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

  await expect(popup.locator('#host-label')).toContainText('127.0.0.1');
  await expect(popup.locator('#action-summary')).toContainText('Clicked a cookie reject control');
  await expect(popup.locator('#undo-action')).toBeEnabled();
  await popup.locator('#undo-action').click();
  await expect(page.locator('#restorable')).not.toHaveAttribute('data-byebar-hidden', /.+/);

  await popup.locator('#generic-blocking').uncheck();
  await expect
    .poll(() =>
      serviceWorker.evaluate(
        async () => (await chrome.storage.local.get('siteFeatureOverrides')).siteFeatureOverrides
      )
    )
    .toEqual({ '127.0.0.1': { genericBlocking: false } });
  await popup.locator('#reset-site').click();
  await expect
    .poll(() =>
      serviceWorker.evaluate(
        async () => (await chrome.storage.local.get('siteFeatureOverrides')).siteFeatureOverrides
      )
    )
    .toEqual({});

  await popup.locator('.debug-panel summary').click();
  await popup.locator('#debug-enabled').check();
  await expect
    .poll(() =>
      serviceWorker.evaluate(async () => (await chrome.storage.local.get('byebar.debug'))['byebar.debug'])
    )
    .toEqual({ schemaVersion: 1, enabled: true });
});
