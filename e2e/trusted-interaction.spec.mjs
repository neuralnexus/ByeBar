import { test, expect } from './fixtures.mjs';

test('leaves user-opened dialogs alone and blocks synthetic injection', async ({ page }) => {
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
});
