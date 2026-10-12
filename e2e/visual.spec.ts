// Visual regression for the specimen page: every component in both themes,
// with fixed data. Update baselines with --update-snapshots after a deliberate change.
import { test, expect } from '@playwright/test';

for (const theme of ['dark', 'light', 'paper'] as const) {
  test(`specimen ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => {
      localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ theme: t, voice: 'off' }));
    }, theme);
    await page.goto('./#/specimen');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    // The version and build change with every release; they are not part of the look.
    await expect(page).toHaveScreenshot(`specimen-${theme}.png`, { fullPage: true, mask: [page.locator('header .ver')] });
  });
}
