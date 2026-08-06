import { test, expect } from './fixtures.mjs';

async function dropSettingsMutationResponse(popup, dropVerification = false) {
  await popup.addInitScript((shouldDropVerification) => {
    const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    let verificationPending = false;
    chrome.runtime.sendMessage = (message, callback) => {
      if (message?.type === 'byebar.settings.update') {
        verificationPending = shouldDropVerification;
        return sendMessage(message, () => callback?.());
      }
      if (verificationPending && message?.type === 'byebar.settings.get') {
        verificationPending = false;
        return sendMessage(message, () => callback?.());
      }
      return sendMessage(message, callback);
    };
  }, dropVerification);
}

async function dropNextUndoResponse(popup) {
  await popup.addInitScript(() => {
    const sendMessage = chrome.tabs.sendMessage.bind(chrome.tabs);
    let shouldDrop = true;
    chrome.tabs.sendMessage = (tabId, message, callback) => {
      if (shouldDrop && message?.type === 'byebar.page.undo') {
        shouldDrop = false;
        return sendMessage(tabId, message, () => callback?.());
      }
      return sendMessage(tabId, message, callback);
    };
  });
}

test('popup edits site overrides, enables diagnostics, and undoes the latest hide', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/settings-restoration.html');
  await expect(page.locator('#restorable')).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(page.locator('.cookie-banner')).toHaveCount(0);
  await page.evaluate(() => window.detachRestorable());
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );

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
  await expect(popup.locator('#status')).toContainText('Hidden elements restored');
  await page.evaluate(() => window.reinsertRestorable());
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  await expect(page.locator('#restorable')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('#restorable')).toHaveCSS('display', 'block');

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

test('refreshes its context before writing a site override', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/settings-restoration.html');
  const port = new URL(page.url()).port;
  const otherPage = await context.newPage();
  await otherPage.goto(`http://localhost:${port}/settings-restoration.html`);

  const tabIds = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return {
      original: tabs.find((tab) => tab.url?.startsWith('http://127.0.0.1:'))?.id,
      other: tabs.find((tab) => tab.url?.startsWith('http://localhost:'))?.id
    };
  });
  const popup = await context.newPage();
  await serviceWorker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), tabIds.original);
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(popup.locator('#host-label')).toContainText('127.0.0.1');

  await serviceWorker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), tabIds.other);
  await popup.locator('#generic-blocking').uncheck();
  await expect(popup.locator('#host-label')).toContainText('localhost');
  await expect(popup.locator('#generic-blocking')).toBeChecked();
  await expect(popup.locator('#status')).toContainText('Active page changed');
  expect(
    await serviceWorker.evaluate(
      async () => (await chrome.storage.local.get('siteFeatureOverrides')).siteFeatureOverrides
    )
  ).toEqual({});

  await popup.locator('#generic-blocking').uncheck();
  await expect
    .poll(() =>
      serviceWorker.evaluate(
        async () => (await chrome.storage.local.get('siteFeatureOverrides')).siteFeatureOverrides
      )
    )
    .toEqual({ localhost: { genericBlocking: false } });
});

test('requires confirmation before enabling irreversible legal auto-accept', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/settings-restoration.html');
  const fixtureTabId = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.includes('settings-restoration.html'))?.id;
  });
  const popup = await context.newPage();
  await serviceWorker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), fixtureTabId);
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

  await popup.locator('#tos-accept').click();
  const confirmation = popup.locator('#legal-confirm');
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('cannot be undone');
  await expect(popup.locator('#legal-confirm-scope')).toContainText('127.0.0.1');
  expect(
    await serviceWorker.evaluate(
      async () => (await chrome.storage.local.get('siteFeatureOverrides')).siteFeatureOverrides
    )
  ).toEqual({});

  await confirmation.getByRole('button', { name: 'Keep it off' }).click();
  await expect(confirmation).toBeHidden();
  await expect(popup.locator('#tos-accept')).not.toBeChecked();
  expect(
    await serviceWorker.evaluate(
      async () => (await chrome.storage.local.get('siteFeatureOverrides')).siteFeatureOverrides
    )
  ).toEqual({});

  await popup.locator('#tos-accept').click();
  await confirmation.getByRole('button', { name: 'Enable auto-accept' }).click();
  await expect(popup.locator('#status')).toContainText('Saved');
  await expect(popup.locator('#tos-accept')).toBeChecked();
  await expect
    .poll(() =>
      serviceWorker.evaluate(
        async () => (await chrome.storage.local.get('siteFeatureOverrides')).siteFeatureOverrides
      )
    )
    .toEqual({ '127.0.0.1': { tosAccept: true } });
});

test('refreshes stale undo state after the page reloads', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/settings-restoration.html');
  await expect(page.locator('#restorable')).toHaveAttribute('data-byebar-hidden', /generic/);
  const fixtureTabId = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.includes('settings-restoration.html'))?.id;
  });
  const popup = await context.newPage();
  await serviceWorker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), fixtureTabId);
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(popup.locator('#undo-action')).toBeEnabled();

  await page.reload();
  await expect(page.locator('#restorable')).toHaveAttribute('data-byebar-hidden', /generic/);
  await popup.locator('#undo-action').click();
  await expect(popup.locator('#status')).toContainText('Page changed; actions refreshed');
  await expect(page.locator('#restorable')).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(popup.locator('#undo-action')).toBeEnabled();

  await popup.locator('#undo-action').click();
  await expect(page.locator('#restorable')).not.toHaveAttribute('data-byebar-hidden', /.+/);
});

test('reconciles committed settings when runtime responses are lost', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/settings-restoration.html');
  const fixtureTabId = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.includes('settings-restoration.html'))?.id;
  });

  const verifiedPopup = await context.newPage();
  await dropSettingsMutationResponse(verifiedPopup);
  await serviceWorker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), fixtureTabId);
  await verifiedPopup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await verifiedPopup.locator('#generic-blocking').uncheck();
  await expect(verifiedPopup.locator('#status')).toContainText('Saved and verified');
  await verifiedPopup.close();

  const uncertainPopup = await context.newPage();
  await dropSettingsMutationResponse(uncertainPopup, true);
  await serviceWorker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), fixtureTabId);
  await uncertainPopup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await uncertainPopup.locator('#cookie-decline').uncheck();
  await expect(uncertainPopup.locator('#status')).toContainText('Save status unknown');
  await expect(uncertainPopup.locator('#cookie-decline')).toBeDisabled();
  await expect
    .poll(() =>
      serviceWorker.evaluate(
        async () => (await chrome.storage.local.get('siteFeatureOverrides')).siteFeatureOverrides
      )
    )
    .toEqual({ '127.0.0.1': { genericBlocking: false, cookieDecline: false } });
});

test('refreshes stale decisions before clearing the current page', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.local.set({ 'byebar.debug': { schemaVersion: 1, enabled: true } });
  });
  await page.goto('/settings-restoration.html');
  await expect(page.locator('#restorable')).toHaveAttribute('data-byebar-hidden', /generic/);
  const fixtureTabId = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.includes('settings-restoration.html'))?.id;
  });
  const popup = await context.newPage();
  await serviceWorker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), fixtureTabId);
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.locator('.debug-panel summary').click();
  await expect.poll(() => popup.locator('#debug-list li').count()).toBeGreaterThan(0);
  await expect(popup.locator('#clear-debug')).toBeVisible();

  await page.reload();
  await expect(page.locator('#restorable')).toHaveAttribute('data-byebar-hidden', /generic/);
  await popup.locator('#clear-debug').click();
  await expect(popup.locator('#status')).toContainText('Page changed; decisions refreshed');
  await expect.poll(() => popup.locator('#debug-list li').count()).toBeGreaterThan(0);

  await popup.locator('#clear-debug').click();
  await expect(popup.locator('#status')).toContainText('Page decisions cleared');
  await expect(popup.locator('#debug-list li')).toHaveCount(0);
  await expect(popup.locator('#clear-debug')).toBeHidden();
});

test('sweeps CSS-only page changes after refreshing a stale document', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/sweep.html');
  const fixtureTabId = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.includes('sweep.html'))?.id;
  });
  const popup = await context.newPage();
  await serviceWorker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), fixtureTabId);
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(popup.locator('#sweep-page')).toBeEnabled();

  await page.reload();
  await page.waitForTimeout(8500);
  expect(await page.evaluate(() => window.revealSweepTargetViaCssom())).toBe(0);
  const target = page.locator('#sweep-target');
  await expect(target).toBeVisible();
  await expect(target).not.toHaveAttribute('data-byebar-hidden', /.+/);

  await popup.locator('#sweep-page').click();
  await expect(popup.locator('#status')).toContainText('Page changed; sweep state refreshed');
  await expect(target).toBeVisible();

  await popup.locator('#sweep-page').click();
  await expect(popup.locator('#status')).toContainText('Sweep: 1 element hidden.');
  await expect(target).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(popup.locator('#action-summary')).toContainText('Hidden intrusive page elements');
  await expect(popup.locator('#undo-action')).toBeEnabled();

  await popup.locator('#sweep-page').click();
  await expect(popup.locator('#status')).toContainText('No safe interruptions found.');
  await expect(popup.locator('#undo-action')).toBeEnabled();

  await popup.locator('#undo-action').click();
  await expect(target).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(target).toBeVisible();
});

test('undoes recent hides newest-first and reconciles a lost response', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/undo-history.html');
  const overlays = [];
  for (let index = 0; index < 3; index += 1) {
    const id = await page.evaluate(() => window.addUndoOverlay());
    const overlay = page.locator(`#${id}`);
    overlays.push(overlay);
    await expect(overlay).toHaveAttribute('data-byebar-hidden', /generic/);
  }

  const fixtureTabId = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.includes('undo-history.html'))?.id;
  });
  const popup = await context.newPage();
  await dropNextUndoResponse(popup);
  await serviceWorker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), fixtureTabId);
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

  const undo = popup.locator('#undo-action');
  await expect(undo).toHaveText('Undo hide (3)');
  await expect(undo).toHaveAccessibleName('Undo hide (3); newest hide first');

  await undo.click();
  await expect(popup.locator('#status')).toContainText('2 more hide actions available');
  await expect(overlays[2]).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(overlays[1]).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(overlays[0]).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(undo).toHaveText('Undo hide (2)');

  await popup.locator('#sweep-page').click();
  await expect(popup.locator('#status')).toContainText('No safe interruptions found');
  await expect(overlays[2]).toBeVisible();
  await expect(undo).toHaveText('Undo hide (2)');

  await undo.click();
  await expect(popup.locator('#status')).toContainText('1 more hide action available');
  await expect(overlays[1]).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(overlays[0]).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(undo).toHaveText('Undo hide');

  await undo.click();
  await expect(popup.locator('#status')).toContainText('Hidden elements restored');
  await expect(overlays[0]).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(undo).toBeDisabled();
});

test('uses the active tab host for incognito Pick gating and fails closed without a URL', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.local.set({ siteOverrides: { '127.0.0.1': false } });
  });
  await page.goto('/picker.html');
  const fixtureTabId = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.includes('/picker.html'))?.id;
  });

  const incognitoPopup = await context.newPage();
  await incognitoPopup.addInitScript(
    ({ tabId, url }) => {
      chrome.tabs.query = (queryInfo, callback) => {
        void queryInfo;
        const tabs = [{ id: tabId, url, incognito: true }];
        if (callback) callback(tabs);
        else return Promise.resolve(tabs);
      };
    },
    { tabId: fixtureTabId, url: page.url() }
  );
  await serviceWorker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), fixtureTabId);
  await incognitoPopup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

  await expect(incognitoPopup.locator('#host-label')).toContainText('127.0.0.1');
  await expect(incognitoPopup.locator('#site-state-label')).toHaveText('Paused');
  await expect(incognitoPopup.locator('#pick-page')).toBeDisabled();
  await incognitoPopup.close();

  const missingUrlPopup = await context.newPage();
  await missingUrlPopup.addInitScript((tabId) => {
    chrome.tabs.query = (queryInfo, callback) => {
      void queryInfo;
      const tabs = [{ id: tabId, incognito: true }];
      if (callback) callback(tabs);
      else return Promise.resolve(tabs);
    };
  }, fixtureTabId);
  await missingUrlPopup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

  await expect(missingUrlPopup.locator('#pick-page')).toBeDisabled();
  await expect(missingUrlPopup.locator('#pick-page')).toHaveAttribute(
    'title',
    'Pick is unavailable because this page address cannot be read'
  );
  await missingUrlPopup.close();

  const hostlessPopup = await context.newPage();
  await hostlessPopup.addInitScript((tabId) => {
    chrome.tabs.query = (queryInfo, callback) => {
      void queryInfo;
      const tabs = [{ id: tabId, url: 'file:///tmp/byebar-picker.html' }];
      if (callback) callback(tabs);
      else return Promise.resolve(tabs);
    };
  }, fixtureTabId);
  await hostlessPopup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

  await expect(hostlessPopup.locator('#scope-global')).toHaveAttribute('aria-pressed', 'true');
  await expect(hostlessPopup.locator('#pick-page')).toBeEnabled();
  await expect(hostlessPopup.locator('#pick-page')).not.toHaveAttribute(
    'title',
    'Pick is unavailable because this page address cannot be read'
  );
  await hostlessPopup.close();

  const ipv6Popup = await context.newPage();
  await ipv6Popup.addInitScript((tabId) => {
    chrome.tabs.query = (queryInfo, callback) => {
      void queryInfo;
      const tabs = [{ id: tabId, url: 'http://[2001:db8::1]/picker.html' }];
      if (callback) callback(tabs);
      else return Promise.resolve(tabs);
    };
  }, fixtureTabId);
  await ipv6Popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

  await expect(ipv6Popup.locator('#host-label')).toContainText('[2001:db8::1]');
  await expect(ipv6Popup.locator('#pick-page')).toBeEnabled();
  await ipv6Popup.close();

  const malformedUrlPopup = await context.newPage();
  await malformedUrlPopup.addInitScript((tabId) => {
    chrome.tabs.query = (queryInfo, callback) => {
      void queryInfo;
      const tabs = [{ id: tabId, url: 'not a url' }];
      if (callback) callback(tabs);
      else return Promise.resolve(tabs);
    };
  }, fixtureTabId);
  await malformedUrlPopup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

  await expect(malformedUrlPopup.locator('#pick-page')).toBeDisabled();
  await expect(malformedUrlPopup.locator('#pick-page')).toHaveAttribute(
    'title',
    'Pick is unavailable because this page address cannot be read'
  );
});
