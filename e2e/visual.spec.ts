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
    await expect(page).toHaveScreenshot(`specimen-${theme}.png`, { fullPage: true });
  });
}
