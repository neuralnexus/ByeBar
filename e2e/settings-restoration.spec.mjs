import { test, expect } from './fixtures.mjs';

test('restores and reapplies reversible hides when settings change', async ({ page, setSettings }) => {
  await page.goto('/settings-restoration.html');
  const popup = page.locator('#restorable');
  await expect(popup).toHaveAttribute('data-byebar-hidden', /generic/);

  await setSettings({ genericBlocking: false });
  await expect(popup).not.toHaveAttribute('data-byebar-hidden', /.+/);
  await expect(popup).toHaveCSS('display', 'block');

  await setSettings({ genericBlocking: true });
  await expect(popup).toHaveAttribute('data-byebar-hidden', /generic/);

  await setSettings({ siteFeatureOverrides: { '127.0.0.1': { genericBlocking: false } } });
  await expect(popup).not.toHaveAttribute('data-byebar-hidden', /.+/);
});
