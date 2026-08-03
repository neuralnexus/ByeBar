import { test, expect } from './fixtures.mjs';

test('blocks only visible intrusive promotional chrome', async ({ page }) => {
  await page.goto('/overlay-safety.html');

  await expect(page.locator('#promo')).toHaveAttribute('data-byebar-hidden', /generic/);
  for (const selector of [
    '#inline-newsletter',
    '#navigation',
    '#paywall',
    '#account',
    '#checkout',
    '#authentication',
    '#sign-in',
    '#dormant',
    '#offscreen'
  ]) {
    await expect(page.locator(selector)).not.toHaveAttribute('data-byebar-hidden', /.+/);
  }
  expect(await page.evaluate(() => window.fixtureEvents.functionalClose)).toBe(0);
});
