import { test, expect } from './fixtures.mjs';

async function fixtureTabId(serviceWorker) {
  return serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.includes('/picker.html'))?.id;
  });
}

async function openPopup(context, serviceWorker, extensionId, tabId) {
  const popup = await context.newPage();
  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  return popup;
}

async function dropPickerMutationResponses(popup) {
  await popup.addInitScript(() => {
    const sendMessage = chrome.tabs.sendMessage.bind(chrome.tabs);
    const dropped = new Set();
    chrome.tabs.sendMessage = (tabId, message, callback) => {
      if (
        (message?.type === 'byebar.page.pick.start' || message?.type === 'byebar.page.pick.cancel') &&
        !dropped.has(message.type)
      ) {
        dropped.add(message.type);
        return sendMessage(tabId, message, () => callback?.());
      }
      return sendMessage(tabId, message, callback);
    };
  });
}

async function clickCenter(page, locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('picks one interruption without firing its control and restores it through Undo', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  await page.evaluate(() => window.lockForManualDialog());
  await page.locator('#manual-control').focus();
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);
  const target = page.locator('#manual-interruption');

  await expect(popup.locator('#pick-page')).toBeEnabled();
  await popup.locator('#pick-page').click();
  await expect(popup.locator('#status')).toContainText('Pick is active');

  await page.bringToFront();
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);
  await clickCenter(page, page.locator('#manual-control'));

  await expect(target).toHaveAttribute('data-byebar-hidden', /manual/);
  await expect(page.locator('html')).toHaveAttribute('data-byebar-scroll-unlock', '');
  await expect(page.locator('body')).toHaveCSS('overflow', 'auto');
  expect(await page.evaluate(() => window.fixtureEvents)).toEqual({
    actionClicks: 0,
    pageClicks: 0,
    keydowns: 0
  });
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('protected-main');

  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await expect(popup.locator('#action-summary')).toContainText('Hidden an item you picked');
  await expect(popup.locator('#undo-action')).toBeEnabled();
  await popup.locator('#undo-action').click();
  await expect(target).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(target).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-byebar-scroll-unlock', '');

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await clickCenter(page, page.locator('#manual-control'));
  await expect(target).toHaveAttribute('data-byebar-hidden', /manual/);
  expect(await page.evaluate(() => window.fixtureEvents.actionClicks)).toBe(0);
});

test('cycles safe keyboard targets and restores page focus after success or cancellation', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  const safeFocus = page.locator('#safe-focus');
  await safeFocus.focus();
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  const target = page.locator('#manual-interruption');
  await expect(target).toHaveAttribute('data-byebar-hidden', /manual/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('safe-focus');

  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await popup.locator('#undo-action').click();
  await expect(target).toBeVisible();
  await safeFocus.focus();
  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('safe-focus');
});

test('offers trusted in-page controls for target cycling, hiding, and cancellation', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);
  const target = page.locator('#manual-interruption');
  const viewportCenter = page.viewportSize().width / 2;
  const controlCenterY = 87;

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await page.mouse.click(viewportCenter - 60, controlCenterY);
  await page.mouse.click(viewportCenter + 60, controlCenterY);
  await expect(target).toHaveAttribute('data-byebar-hidden', /manual/);
  expect(await page.evaluate(() => window.fixtureEvents.actionClicks)).toBe(0);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);

  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await popup.locator('#undo-action').click();
  await expect(target).toBeVisible();
  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await page.mouse.click(viewportCenter + 181, controlCenterY);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  await expect(target).toBeVisible();
});

test('rejects unshieldable dialogs and ignores protected or framed targets before Escape', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  await page.evaluate(() => window.openNativeModal());
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);

  await popup.locator('#pick-page').click();
  await expect(popup.locator('#status')).toContainText('Close the active dialog');
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  await page.evaluate(() => window.closeNativeModal());

  await page.evaluate(() => window.openClosedNativeModal());
  await popup.locator('#pick-page').click();
  await expect(popup.locator('#status')).toContainText('Close the active dialog');
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  await page.evaluate(() => window.closeClosedNativeModal());

  await page.evaluate(() => window.openClosedPopover());
  await popup.locator('#pick-page').click();
  await expect(popup.locator('#status')).toContainText('Pick is active');
  await page.bringToFront();
  const popoverRect = await page.evaluate(() => window.closedPopoverRect());
  await page.mouse.click(popoverRect.x + popoverRect.width / 2, popoverRect.y + popoverRect.height / 2);
  expect(await page.evaluate(() => window.closedPopoverClicks())).toBe(0);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  await page.evaluate(() => window.closeClosedPopover());
  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();

  await popup.locator('#pick-page').click();
  await expect(popup.locator('#status')).toContainText('Pick is active');
  await page.bringToFront();

  await page.evaluate(() => {
    const box = document.getElementById('manual-control').getBoundingClientRect();
    const values = { bubbles: true, clientX: box.x + 5, clientY: box.y + 5 };
    document.dispatchEvent(new PointerEvent('pointermove', values));
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
  });
  await expect(page.locator('#manual-interruption')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);

  const controlBox = await page.locator('#manual-control').boundingBox();
  await page.mouse.move(controlBox.x + controlBox.width / 2, controlBox.y + controlBox.height / 2);
  await page.mouse.down();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);
  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await expect(popup.locator('#pick-page')).toBeDisabled();
  await page.mouse.up();
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  await expect(page.locator('#manual-interruption')).toBeVisible();
  expect(await page.evaluate(() => window.fixtureEvents.actionClicks)).toBe(0);
  await expect(popup.locator('#pick-page')).toBeEnabled();
  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);

  const main = page.locator('#protected-main');
  const mainBox = await main.boundingBox();
  await page.mouse.click(mainBox.x + 20, mainBox.y + mainBox.height - 20);
  await expect(main).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);

  await clickCenter(page, page.locator('#fixture-frame'));
  expect(await page.evaluate(() => window.frameClicks())).toBe(0);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  expect(await page.evaluate(() => window.fixtureEvents)).toEqual({
    actionClicks: 0,
    pageClicks: 0,
    keydowns: 0
  });
});

test('reconciles lost Pick start and cancel responses without retrying either mutation', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await context.newPage();
  await dropPickerMutationResponses(popup);
  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

  await popup.locator('#pick-page').click();
  await expect(popup.locator('#status')).toContainText('Pick is active');
  await expect(popup.locator('#pick-page')).toHaveText(/Cancel pick/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);
  await page.evaluate(() => window.addAutomaticPromo());
  const automaticPromo = page.locator('#automatic-promo');
  await page.waitForTimeout(300);
  await expect(automaticPromo).toBeVisible();
  await expect(automaticPromo).not.toHaveAttribute('data-byebar-hidden', /.+/);

  await popup.locator('#pick-page').click();
  await expect(popup.locator('#status')).toContainText('Pick cancelled');
  await expect(popup.locator('#pick-page')).toHaveText(/Pick to hide/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  await expect(automaticPromo).toHaveAttribute('data-byebar-hidden', /generic/);
});

test('cancels active Pick when the site is paused from the same popup', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);

  await popup.locator('#pick-page').click();
  await expect(popup.locator('#pick-page')).toHaveText(/Cancel pick/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);

  await popup.locator('#site-enabled').uncheck();
  await expect(popup.locator('#status')).toContainText('Saved');
  await expect(popup.locator('#site-state-label')).toHaveText('Paused');
  await expect(popup.locator('#pick-page')).toHaveText(/Pick to hide/);
  await expect(popup.locator('#pick-page')).toBeDisabled();
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
});
