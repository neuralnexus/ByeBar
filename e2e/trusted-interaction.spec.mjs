import { test, expect } from './fixtures.mjs';

test('leaves user-opened dialogs alone and blocks synthetic injection', async ({ page, setSettings }) => {
  await setSettings({ tosAccept: true });
  await page.goto('/trusted-interaction.html');

  await page.locator('#open-trusted').click();
  await expect(page.locator('#trusted-popup')).toBeVisible();
  await expect(page.locator('#trusted-popup')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await page.waitForTimeout(1300);
  await page.locator('#trusted-popup').evaluate((el) => el.classList.add('newsletter-overlay'));
  await expect(page.locator('#trusted-popup')).not.toHaveAttribute('data-byebar-hidden', /.+/);

  await page.evaluate(() => document.querySelector('#open-synthetic').click());
  await expect(page.locator('#synthetic-popup')).toHaveAttribute('data-byebar-hidden', /generic/);

  await page.locator('#unrelated').click();
  await expect(page.locator('#unrelated-popup')).toHaveAttribute('data-byebar-hidden', /generic/);

  await page.locator('#open-custom-consent').click();
  await expect(page.locator('#custom-consent')).toBeVisible();
  expect(await page.evaluate(() => window.fixtureEvents.customRejects)).toBe(0);

  const heldPointer = page.locator('#open-held-pointer');
  const box = await heldPointer.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('#held-consent')).toBeVisible();
  expect(await page.evaluate(() => window.fixtureEvents.heldRejects)).toBe(0);
  await page.mouse.up();
  await expect(page.locator('#held-consent')).toBeVisible();

  await page.locator('#open-held-key').focus();
  await page.keyboard.down('Enter');
  await expect(page.locator('#held-key-popup')).toBeVisible();
  await expect(page.locator('#held-key-popup')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await page.keyboard.up('Enter');

  await page.locator('#held-key-popup').evaluate((element) => element.remove());
  await page.locator('#open-held-key').focus();
  await page.keyboard.down('Shift');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Shift');
  await expect(page.locator('#held-key-popup')).toBeVisible();
  await expect(page.locator('#held-key-popup')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await page.keyboard.up('Enter');

  await page.locator('#manage-consent').click();
  await expect(page.locator('#hydrated-reject')).toBeVisible();
  expect(await page.evaluate(() => window.fixtureEvents.hydratedRejects)).toBe(0);

  await page.locator('#manage-tos').click();
  await expect(page.locator('#hydrated-accept')).toBeVisible();
  expect(await page.evaluate(() => window.fixtureEvents.hydratedAccepts)).toBe(0);
});
