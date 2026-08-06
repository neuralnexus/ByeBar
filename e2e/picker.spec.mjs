import { test, expect } from './fixtures.mjs';
import { evaluateInExtensionWorld } from './helpers/extension-world.mjs';

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

async function touchTap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }]
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
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

test('preserves a page tabindex mutation made synchronously during focus restoration', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  await page.evaluate(() => {
    const main = document.getElementById('protected-main');
    main.removeAttribute('tabindex');
    document.getElementById('manual-control').focus();
  });
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  expect(
    await evaluateInExtensionWorld(
      page,
      `(() => {
        const target = document.getElementById('protected-main');
        const nativeFocus = target.focus;
        target.focus = function (options) {
          nativeFocus.call(this, options);
          this.setAttribute('tabindex', '7');
        };
        return true;
      })()`
    )
  ).toBe(true);
  await clickCenter(page, page.locator('#manual-control'));
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('protected-main');
  await expect(page.locator('#protected-main')).toHaveAttribute('tabindex', '7');

  await page.locator('#safe-focus').focus();
  await expect(page.locator('#protected-main')).toHaveAttribute('tabindex', '7');
});

test('restores deep shadow focus and falls back when the prior control becomes inert', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  await page.evaluate(() => window.focusClosedControl());
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.closedControlFocused())).toBe(true);

  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await page.locator('#safe-focus').focus();
  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await page.evaluate(() => {
    document.getElementById('safe-focus').inert = true;
  });
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('protected-main');
  await page.evaluate(() => {
    document.getElementById('safe-focus').inert = false;
  });
});

test('releases the picker shield when pointer release is lost during cancellation', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);
  const box = await page.locator('#manual-control').boundingBox();
  expect(box).not.toBeNull();

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
    await expect(page.locator('#manual-interruption')).toBeVisible();
  } finally {
    await page.mouse.up();
  }
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

test('keeps Pick active without Undo when the page strips hide ownership reactively', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  await page.evaluate(() => window.armReactiveHideStrip());
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);
  const target = page.locator('#manual-interruption');

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await clickCenter(page, page.locator('#manual-control'));

  await expect.poll(() => page.evaluate(() => window.reactiveHideStripCount())).toBeGreaterThan(0);
  await expect(target).toBeVisible();
  await expect(target).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);

  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await expect(popup.locator('#pick-page')).toHaveText(/Cancel pick/);
  await expect(popup.locator('#undo-action')).toBeDisabled();
  await popup.locator('#pick-page').click();
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
});

test('keeps Pick active without Undo when the page replaces the provisional target', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  await page.evaluate(() => window.armReactiveTargetReplacement());
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await clickCenter(page, page.locator('#manual-control'));

  await expect.poll(() => page.evaluate(() => window.reactiveTargetReplacementCount())).toBe(1);
  await expect(page.locator('#manual-interruption')).toBeVisible();
  await expect(page.locator('#manual-interruption')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);

  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await expect(popup.locator('#pick-page')).toHaveText(/Cancel pick/);
  await expect(popup.locator('#undo-action')).toBeDisabled();
  await popup.locator('#pick-page').click();
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
});

test('rolls back when a target becomes protected during verification', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);
  const target = page.locator('#manual-interruption');

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await page.evaluate(() => window.armReactiveRolePromotion());
  await clickCenter(page, page.locator('#manual-control'));

  await expect(target).toHaveAttribute('role', 'main');
  await expect(target).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);
  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await expect(popup.locator('#undo-action')).toBeDisabled();
  await popup.locator('#pick-page').click();
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
});

test('restores a detached action copy when it mounts after provisional rollback', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  await page.evaluate(() => window.armDetachedActionCopyRollback());
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await clickCenter(page, page.locator('#manual-control'));

  await expect.poll(() => page.evaluate(() => window.detachedActionCopyReady())).toBe(true);
  await expect(page.locator('#manual-interruption')).toBeVisible();
  await expect(page.locator('#manual-interruption')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);

  expect(await page.evaluate(() => window.mountDetachedActionCopy())).toBe(true);
  const lateCopy = page.locator('#late-action-copy');
  await expect(lateCopy).toBeVisible();
  await expect(lateCopy).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(lateCopy).not.toHaveAttribute('data-byebar-action-copy-7c6f2a', /.+/);
  expect(
    await lateCopy.evaluate((element) => ({
      display: element.style.getPropertyValue('display'),
      displayPriority: element.style.getPropertyPriority('display'),
      variable: element.style.getPropertyValue('--byebar-hidden-display-7c6f2a'),
      variablePriority: element.style.getPropertyPriority('--byebar-hidden-display-7c6f2a')
    }))
  ).toEqual({
    display: 'grid',
    displayPriority: 'important',
    variable: 'inline-fallback',
    variablePriority: 'important'
  });

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
});

test('self-deactivates a copy mounted in a newly attached closed root after rollback', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  await page.evaluate(() => window.armLateClosedActionCopyRollback());
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await clickCenter(page, page.locator('#manual-control'));

  await expect.poll(() => page.evaluate(() => window.lateClosedActionCopyReady())).toBe(true);
  await expect(page.locator('#manual-interruption')).toBeVisible();
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);
  const mounted = await page.evaluate(() => window.mountLateClosedActionCopy());
  expect(mounted).toMatchObject({ display: 'grid', hidden: 'manual' });
  expect(mounted.inlineDisplay).toContain('--byebar-action-active-7c6f2a-');
  expect(mounted.marker).toContain('"r":"manual"');

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
});

test('enforces and restores a live action copy while retaining its scroll ownership', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  await page.evaluate(() => window.lockForManualDialog());
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await clickCenter(page, page.locator('#manual-control'));
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-byebar-scroll-unlock', '');

  expect(await page.evaluate(() => window.mountActiveActionCopy())).toBe(true);
  const copy = page.locator('#active-action-copy');
  await expect(copy).toHaveCSS('display', 'none');
  expect(await page.evaluate(() => window.mutateActiveActionCopyDisplay())).toBe(true);
  await expect(copy).toHaveCSS('display', 'none');
  await expect
    .poll(() => copy.evaluate((element) => element.style.getPropertyValue('display')))
    .toContain('--byebar-action-active-7c6f2a-');
  expect(await page.evaluate(() => window.stripActiveActionCopyMarker())).toBe(true);
  await expect(copy).not.toHaveAttribute('data-byebar-action-copy-7c6f2a', /.+/);

  expect(await page.evaluate(() => window.detachActiveActionOriginal())).toBe(true);
  await evaluateInExtensionWorld(page, 'ByeBar.visibility.syncScrollLock()');
  await expect(page.locator('html')).toHaveAttribute('data-byebar-scroll-unlock', '');

  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await expect(popup.locator('#undo-action')).toBeEnabled();
  await popup.locator('#undo-action').click();
  await expect(copy).toBeVisible();
  await expect(copy).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(copy).not.toHaveAttribute('data-byebar-action-copy-7c6f2a', /.+/);
  expect(
    await copy.evaluate((element) => ({
      display: element.style.getPropertyValue('display'),
      variable: element.style.getPropertyValue('--byebar-hidden-display-7c6f2a')
    }))
  ).toEqual({ display: 'flex', variable: 'page-fallback' });
  await expect(page.locator('html')).not.toHaveAttribute('data-byebar-scroll-unlock', '');
});

test('reasserts a page-replaced root activation variable and restores page ownership on Undo', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await clickCenter(page, page.locator('#manual-control'));
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  expect(await page.evaluate(() => window.mountActiveActionCopy())).toBe(true);
  const copy = page.locator('#active-action-copy');
  await expect(copy).toHaveCSS('display', 'none');
  const activeVariable = await page.evaluate(() => {
    const marker = JSON.parse(
      document.getElementById('manual-interruption').getAttribute('data-byebar-action-copy-7c6f2a')
    );
    document.documentElement.style.cssText = '--fixture-root-property: retained';
    document.documentElement.style.setProperty(marker.a, 'page-owned');
    return marker.a;
  });

  await expect
    .poll(() =>
      page.evaluate((property) => document.documentElement.style.getPropertyValue(property), activeVariable)
    )
    .toContain('--byebar-hidden-display-7c6f2a');
  await expect(copy).toHaveCSS('display', 'none');

  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await popup.locator('#undo-action').click();
  await expect(copy).toBeVisible();
  expect(
    await page.evaluate(
      (property) => document.documentElement.style.getPropertyValue(property),
      activeVariable
    )
  ).toBe('page-owned');
  expect(
    await page.evaluate(() => document.documentElement.style.getPropertyValue('--fixture-root-property'))
  ).toBe('retained');
});

test('suppresses a detached retired copy when it mounts after Undo', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  await page.evaluate(() => window.armLateUndoActionCopy());
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await clickCenter(page, page.locator('#manual-control'));
  await expect.poll(() => page.evaluate(() => window.lateUndoActionCopyReady())).toBe(true);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);

  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await popup.locator('#undo-action').click();
  expect(await page.evaluate(() => window.mountLateUndoActionCopy())).toBe(true);
  const lateCopy = page.locator('#late-undo-action-copy');
  await expect(lateCopy).toBeVisible();
  await expect(lateCopy).not.toHaveAttribute('data-byebar-action-copy-7c6f2a', /.+/);

  await popup.locator('#sweep-page').click();
  await expect(popup.locator('#sweep-page')).toBeEnabled();
  await expect(lateCopy).toBeVisible();
  await expect(lateCopy).not.toHaveAttribute('data-byebar-hidden', /.+/);
});

test('discovers and restores an active copy in a late closed root', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await clickCenter(page, page.locator('#manual-control'));
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  expect(await page.evaluate(() => window.mountLateActiveClosedActionCopy())).toBe(true);

  await expect
    .poll(() => page.evaluate(() => window.lateActiveClosedActionCopyState()), { timeout: 7_000 })
    .toMatchObject({ display: 'none', hidden: 'manual' });
  expect((await page.evaluate(() => window.lateActiveClosedActionCopyState())).inlineDisplay).toContain(
    '--byebar-action-active-7c6f2a-'
  );

  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await popup.locator('#undo-action').click();
  await expect
    .poll(() => page.evaluate(() => window.lateActiveClosedActionCopyState()))
    .toMatchObject({ display: 'flex', hidden: null, marker: null });
});

test('revalidates every commit guard after restoring page focus', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  await page.locator('#safe-focus').focus();
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  expect(
    await evaluateInExtensionWorld(
      page,
      `(() => {
        const target = document.getElementById('safe-focus');
        const nativeFocus = target.focus;
        target.blur();
        target.focus = function (options) {
          nativeFocus.call(this, options);
          this.setAttribute('data-focus-commit-invalidated', '');
          history.replaceState({ focusCommitInvalidated: true }, '', '?focus-commit=1');
        };
        return document.activeElement !== target;
      })()`
    )
  ).toBe(true);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');

  await expect(page.locator('#safe-focus')).toHaveAttribute('data-focus-commit-invalidated', '');
  await expect(page.locator('#manual-interruption')).toBeVisible();
  await expect(page.locator('#manual-interruption')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await expect(popup.locator('#undo-action')).toBeDisabled();
});

test('activates every picker control exactly once from trusted touch input', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  await page.evaluate(() => window.showTouchPickerTargets());
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const center = page.viewportSize().width / 2;
  const controlsY = 87;

  try {
    await popup.locator('#pick-page').click();
    await page.bringToFront();
    await touchTap(cdp, center - 60, controlsY);
    await page.waitForTimeout(50);
    await touchTap(cdp, center + 60, controlsY);

    await expect(page.locator('#touch-candidate-1')).toHaveAttribute('data-byebar-hidden', /manual/);
    await expect(page.locator('#touch-candidate-2')).not.toHaveAttribute('data-byebar-hidden', /.+/);
    await expect(page.locator('#manual-interruption')).not.toHaveAttribute('data-byebar-hidden', /.+/);
    await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);

    await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
    await popup.reload();
    await popup.locator('#undo-action').click();
    await popup.locator('#pick-page').click();
    await page.bringToFront();
    await touchTap(cdp, center - 181, controlsY);
    await page.waitForTimeout(50);
    await touchTap(cdp, center + 60, controlsY);

    await expect(page.locator('#manual-interruption')).toHaveAttribute('data-byebar-hidden', /manual/);
    await expect(page.locator('#touch-candidate-3')).not.toHaveAttribute('data-byebar-hidden', /.+/);
    await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);

    await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
    await popup.reload();
    await popup.locator('#undo-action').click();
    await popup.locator('#pick-page').click();
    await page.bringToFront();
    await touchTap(cdp, center + 181, controlsY);
    await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
    expect(await page.evaluate(() => window.fixtureEvents)).toEqual({
      actionClicks: 0,
      pageClicks: 0,
      keydowns: 0
    });
  } finally {
    await cdp.detach();
  }
});

test('deduplicates queued compatibility clicks by control and activation count', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  await page.evaluate(() => window.showTouchPickerTargets());
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const center = page.viewportSize().width / 2;
  const controlsY = 87;

  try {
    await popup.locator('#pick-page').click();
    await page.bringToFront();
    await touchTap(cdp, center - 60, controlsY);
    await touchTap(cdp, center - 60, controlsY);

    await page.mouse.click(center - 181, controlsY);
    await page.mouse.click(center - 60, controlsY);
    await page.mouse.click(center - 60, controlsY);
    await touchTap(cdp, center + 60, controlsY);

    await expect(page.locator('#touch-candidate-1')).toHaveAttribute('data-byebar-hidden', /manual/);
    await expect(page.locator('#touch-candidate-2')).not.toHaveAttribute('data-byebar-hidden', /.+/);
    await expect(page.locator('#touch-candidate-3')).not.toHaveAttribute('data-byebar-hidden', /.+/);
    await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  } finally {
    await cdp.detach();
  }
});

test('protects landmarks in open and closed roots while allowing a safe overlay', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  await page.evaluate(() => window.showShadowPickerFixture('open'));
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await clickCenter(page, page.locator('#open-picker-shell'));
  await expect(page.locator('#open-picker-shell')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);

  await page.evaluate(() => window.showShadowPickerFixture('closedCustom'));
  await clickCenter(page, page.locator('#closed-custom-picker-shell'));
  await expect(page.locator('#closed-custom-picker-shell')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);

  await page.evaluate(() => window.showShadowPickerFixture('closedBuiltIn'));
  await clickCenter(page, page.locator('#closed-built-in-picker-shell'));
  await expect(page.locator('#closed-built-in-picker-shell')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);

  await page.evaluate(() => window.showShadowPickerFixture('slotted'));
  const slottedRect = await page.evaluate(() => window.slottedPickerRect());
  await page.mouse.click(slottedRect.x + slottedRect.width / 2, slottedRect.y + slottedRect.height / 2);
  await expect(page.locator('#slotted-picker-main')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);

  await page.evaluate(() => window.showShadowPickerFixture('safe'));
  await clickCenter(page, page.locator('#safe-picker-overlay'));
  await expect(page.locator('#safe-picker-overlay')).toHaveAttribute('data-byebar-hidden', /manual/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
});

test('rejects stale pushState and replaceState keyboard commits synchronously', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);
  const target = page.locator('#manual-interruption');

  for (const method of ['pushState', 'replaceState']) {
    await popup.locator('#pick-page').click();
    await page.bringToFront();
    await page.keyboard.press('Tab');
    await page.evaluate((historyMethod) => {
      history[historyMethod]({}, '', `?picker-route=${historyMethod}`);
    }, method);
    await page.keyboard.press('Enter');

    await expect(target).not.toHaveAttribute('data-byebar-hidden', /.+/);
    await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
    await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
    await popup.reload();
    await expect(popup.locator('#undo-action')).toBeDisabled();
  }
});

test('invalidates same-URL pushState and replaceState entries before keyboard commit', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);
  const target = page.locator('#manual-interruption');

  for (const method of ['pushState', 'replaceState']) {
    await popup.locator('#pick-page').click();
    await page.bringToFront();
    await page.keyboard.press('Tab');
    const startedUrl = page.url();
    await page.evaluate((historyMethod) => {
      history[historyMethod]({ pickerRoute: historyMethod }, '', location.href);
    }, method);
    expect(page.url()).toBe(startedUrl);
    await page.keyboard.press('Enter');

    await expect(target).not.toHaveAttribute('data-byebar-hidden', /.+/);
    await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
    await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
    await popup.reload();
    await expect(popup.locator('#undo-action')).toBeDisabled();
  }
});

test('invalidates a same-value replaceState before a provisional hide can commit', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);
  const target = page.locator('#manual-interruption');

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await page.keyboard.press('Tab');
  const startedUrl = page.url();
  await page.evaluate(() => history.replaceState(history.state, '', location.href));
  expect(page.url()).toBe(startedUrl);
  await page.keyboard.press('Enter');

  await expect(target).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await expect(popup.locator('#undo-action')).toBeDisabled();
});

test('Escape rolls back a provisional hide during verification', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  await page.evaluate(() => window.watchProvisionalHide());
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);
  const target = page.locator('#manual-interruption');

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await page.keyboard.press('Tab');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await page.keyboard.down('Escape');
  await page.keyboard.up('Escape');

  await expect.poll(() => page.evaluate(() => window.provisionalHideCount())).toBe(1);
  await expect(target).toBeVisible();
  await expect(target).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await expect(popup.locator('#undo-action')).toBeDisabled();
});

test('rejects an occluded keyboard target and still permits a fresh pointer commit', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);
  const target = page.locator('#manual-interruption');

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await page.keyboard.press('Tab');
  await page.evaluate(() => window.coverManualInterruption());
  await page.keyboard.press('Enter');

  await expect(target).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(1);

  await page.evaluate(() => window.removeManualInterruptionCover());
  await clickCenter(page, page.locator('#manual-control'));
  await expect(target).toHaveAttribute('data-byebar-hidden', /manual/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
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
  await expect(popup.locator('#status')).toContainText('Close the active dialog');
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

test('rolls back a provisional hide when paused during verification', async ({
  page,
  context,
  serviceWorker,
  extensionId
}) => {
  await page.goto('/picker.html');
  await page.evaluate(() => window.watchProvisionalHide());
  const tabId = await fixtureTabId(serviceWorker);
  const popup = await openPopup(context, serviceWorker, extensionId, tabId);
  const target = page.locator('#manual-interruption');
  const control = page.locator('#manual-control');

  await popup.locator('#pick-page').click();
  await page.bringToFront();
  await evaluateInExtensionWorld(
    page,
    `(() => {
      const target = document.getElementById('manual-interruption');
      const observer = new MutationObserver(() => {
        if (!target.getAttribute('data-byebar-hidden')?.includes('manual')) return;
        observer.disconnect();
        ByeBar.engine.applySettings({ ...ByeBar.engine.settings, enabled: false });
        void chrome.storage.local.set({ enabled: false });
      });
      observer.observe(target, { attributes: true, attributeFilter: ['data-byebar-hidden'] });
      return true;
    })()`
  );
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => window.provisionalHideCount())).toBe(1);
  await page.waitForTimeout(200);
  await expect(target).toBeVisible();
  await expect(target).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);

  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await expect(popup.locator('#site-state-label')).toHaveText('Paused');
  await expect(popup.locator('#pick-page')).toBeDisabled();
  await expect(popup.locator('#undo-action')).toBeDisabled();

  await page.bringToFront();
  await clickCenter(page, control);
  await page.waitForTimeout(200);
  await expect(target).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('[data-byebar-picker-root]')).toHaveCount(0);
});
