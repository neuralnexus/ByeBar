import { test, expect } from './fixtures.mjs';

test('hides and restores nested shadow content without losing inline styles', async ({
  page,
  setSettings
}) => {
  await page.goto('/shadow-dom.html');
  const shadowPromo = page.locator('#shadow-promo');
  const nestedPromo = page.locator('#nested-promo');

  await expect(shadowPromo).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(nestedPromo).toHaveAttribute('data-byebar-hidden', /generic/);
  expect(
    await shadowPromo.evaluate(
      (el) => `${el.style.getPropertyValue('display')}:${el.style.getPropertyPriority('display')}`
    )
  ).toBe('none:important');
  await expect.poll(() => page.evaluate(() => window.fixtureEvents.shadowReject)).toBe(1);

  await page.evaluate(() => window.overwriteShadowDisplay());
  await expect.poll(() => shadowPromo.evaluate((el) => el.style.getPropertyValue('display'))).toBe('none');

  await setSettings({ genericBlocking: false });
  await expect(shadowPromo).not.toHaveAttribute('data-byebar-hidden', /.+/);
  expect(
    await shadowPromo.evaluate(
      (el) => `${el.style.getPropertyValue('display')}:${el.style.getPropertyPriority('display')}`
    )
  ).toBe('flex:important');
});

test('detects late class activation in light and open shadow DOM', async ({ page }) => {
  await page.goto('/late-class.html');
  await expect(page.locator('#late')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('#late-shadow')).not.toHaveAttribute('data-byebar-hidden', /.+/);

  await page.evaluate(() => window.revealLatePopups());
  await expect(page.locator('#late')).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(page.locator('#late-shadow')).toHaveAttribute('data-byebar-hidden', /generic/);

  await page.evaluate(() => window.revealStylePopup());
  await expect(page.locator('#late-style')).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(page.locator('#deferred-promo')).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(page.locator('#standard-shadow-promo')).toHaveAttribute('data-byebar-hidden', /generic/, {
    timeout: 13_000
  });
  await expect(page.locator('#post-retry-style')).toHaveAttribute('data-byebar-hidden', /generic/);
});
