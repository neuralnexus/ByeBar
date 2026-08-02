import { test, expect } from './fixtures.mjs';
import { evaluateInExtensionWorld } from './helpers/extension-world.mjs';

test('runs in the top frame only', async ({ page }) => {
  await page.goto('/frames.html');
  await expect(page.locator('#top-promo')).toHaveAttribute('data-byebar-hidden', /generic/);

  const same = page.frameLocator('#same-frame').locator('#frame-promo');
  const cross = page.frameLocator('#cross-frame').locator('#frame-promo');
  await expect(same).toBeVisible();
  await expect(cross).toBeVisible();
  await expect(same).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(cross).not.toHaveAttribute('data-byebar-hidden', /.+/);

  await page.goto('/frame-child.html');
  await expect(page.locator('#frame-promo')).toHaveAttribute('data-byebar-hidden', /generic/);
});

test('batches mutation bursts into one observer flush', async ({ page }) => {
  await page.goto('/mutation-burst.html');
  await evaluateInExtensionWorld(page, 'ByeBar.engine.loadSettings()');
  await evaluateInExtensionWorld(page, 'ByeBar.engine.resetMetrics()');
  await page.evaluate(() => window.sameRootBurst());
  await expect
    .poll(() => evaluateInExtensionWorld(page, 'ByeBar.engine.metrics'))
    .toEqual({ mutationFlushes: 1, mutationRoots: 1 });

  await evaluateInExtensionWorld(page, 'ByeBar.engine.resetMetrics()');
  await page.evaluate(() => window.manyRootBurst());
  await expect
    .poll(() => evaluateInExtensionWorld(page, 'ByeBar.engine.metrics'))
    .toEqual({ mutationFlushes: 1, mutationRoots: 1 });
});
