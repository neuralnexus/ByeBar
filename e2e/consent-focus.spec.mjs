import { test, expect } from './fixtures.mjs';

test('clicks one visible reject control per banner lifetime', async ({ page }) => {
  await page.goto('/consent.html');
  await expect.poll(() => page.evaluate(() => window.fixtureEvents.visibleReject)).toBe(1);

  await page.evaluate(() => {
    for (let index = 0; index < 50; index += 1) document.body.append(document.createElement('span'));
  });
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.fixtureEvents)).toEqual({
    visibleReject: 1,
    hiddenReject: 0,
    accept: 0,
    outside: 0
  });
});

test('retries a confirmed reject control after delayed hydration', async ({ page }) => {
  await page.goto('/consent-delayed.html');
  await expect.poll(() => page.evaluate(() => window.fixtureEvents.reject), { timeout: 6000 }).toBe(1);
});

test('accepts only visible legal controls when explicitly enabled', async ({ page, setSettings }) => {
  await setSettings({ tosAccept: true });
  await page.goto('/tos.html');
  await expect.poll(() => page.evaluate(() => window.fixtureEvents.visible)).toBe(1);
  expect(await page.evaluate(() => window.fixtureEvents.transparent)).toBe(0);
});

test('lets site close handlers repair focus and leaves unsafe modals intact', async ({ page }) => {
  await page.goto('/focus-inert.html');
  await expect.poll(() => page.evaluate(() => window.fixtureEvents.close)).toBe(1);
  await expect(page.locator('#dismissible')).toHaveCount(0);
  await expect(page.locator('#opener')).toBeFocused();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#undismissible')).toBeVisible();
  await expect(page.locator('#undismissible')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  expect(await page.evaluate(() => document.activeElement?.closest('[data-byebar-hidden]') === null)).toBe(
    true
  );
});

test('repairs focus from a shadow descendant of a hidden overlay', async ({ page }) => {
  await page.goto('/shadow-focus.html');
  await expect(page.locator('#shadow-focus-promo')).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(page.locator('#outside')).toBeFocused();
});
