import { test, expect } from './fixtures.mjs';

test('hides and restores nested shadow content without losing inline styles', async ({
  page,
  setSettings
}) => {
  await page.goto('/shadow-dom.html');
  const shadowPromo = page.locator('#shadow-promo');
  const nestedPromo = page.locator('#nested-promo');
  const movablePromo = page.locator('#movable-promo');
  const syncStylePromo = page.locator('#sync-style-promo');

  await expect(shadowPromo).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(nestedPromo).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(movablePromo).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(page.locator('#closed-movable-promo')).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(syncStylePromo).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect(syncStylePromo).toHaveCSS('display', 'none');
  expect(await page.evaluate(() => window.fixtureEvents.syncStyle)).toBe(1);
  expect(
    await shadowPromo.evaluate((el) => ({
      computed: getComputedStyle(el).display,
      priority: el.style.getPropertyPriority('display')
    }))
  ).toEqual({ computed: 'none', priority: 'important' });
  await expect.poll(() => page.evaluate(() => window.fixtureEvents.shadowReject)).toBe(1);
  await page.evaluate(() => window.overrideInheritedHiddenVariable());
  await expect(shadowPromo).toHaveCSS('display', 'none');

  await page.evaluate(() => window.overwriteShadowDisplay());
  await expect.poll(() => shadowPromo.evaluate((el) => getComputedStyle(el).display)).toBe('none');

  await page.evaluate(() => window.movePromoIntoShadow());
  await expect
    .poll(() =>
      movablePromo.evaluate((el) => ({
        computed: getComputedStyle(el).display,
        priority: el.style.getPropertyPriority('display')
      }))
    )
    .toEqual({ computed: 'none', priority: 'important' });
  await page.evaluate(() => window.movePromoIntoClosedShadow());
  await expect
    .poll(() => page.evaluate(() => window.closedPromoState()))
    .toEqual({
      computed: 'none',
      inline: 'var(--byebar-hidden-display-7c6f2a, none)',
      priority: 'important',
      variable: 'none',
      hidden: true
    });

  await page.evaluate(() => window.startShadowDisplayFight());
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.fixtureEvents.displayFight)).toBeLessThan(20);

  await setSettings({ genericBlocking: false });
  await expect(shadowPromo).not.toHaveAttribute('data-byebar-hidden', /.+/);
  expect(
    await shadowPromo.evaluate(
      (el) => `${el.style.getPropertyValue('display')}:${el.style.getPropertyPriority('display')}`
    )
  ).toBe('flex:important');
  await expect(movablePromo).not.toHaveAttribute('data-byebar-hidden', /.+/);
  expect(
    await movablePromo.evaluate(
      (el) => `${el.style.getPropertyValue('display')}:${el.style.getPropertyPriority('display')}`
    )
  ).toBe('grid:');
  await expect(syncStylePromo).not.toHaveAttribute('data-byebar-hidden', /.+/);
  expect(
    await syncStylePromo.evaluate(
      (el) => `${el.style.getPropertyValue('display')}:${el.style.getPropertyPriority('display')}`
    )
  ).toBe('flex:important');
  await expect
    .poll(() => page.evaluate(() => window.closedPromoState()))
    .toEqual({
      computed: 'none',
      inline: 'none',
      priority: 'important',
      variable: 'block',
      hidden: false
    });
});

test('detects late class activation in light and open shadow DOM', async ({ page }) => {
  await page.goto('/late-class.html');
  await expect(page.locator('#late')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('#late-shadow')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(page.locator('#late-text')).not.toHaveAttribute('data-byebar-hidden', /.+/);
  expect(await page.evaluate(() => window.fixtureEvents)).toEqual({
    lateReject: 0,
    lateClassReject: 0
  });

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

  await page.evaluate(() => window.hydrateLateContent());
  await expect(page.locator('#late-text')).toHaveAttribute('data-byebar-hidden', /generic/);
  await expect.poll(() => page.evaluate(() => window.fixtureEvents.lateReject)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.fixtureEvents.lateClassReject)).toBe(1);
});
