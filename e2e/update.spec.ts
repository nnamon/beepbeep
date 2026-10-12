// Settings, Reload the latest version: for the app on a phone's home screen,
// where there is no way to force a refresh.
import { test, expect } from '@playwright/test';
import { BASE, settings } from './probe';

test('Reload the latest version clears the saved copy and keeps your progress and settings', async ({ page }) => {
  await settings(page, { ...BASE, charWpm: 27 });
  await page.goto('./#/settings');
  await page.evaluate(async () => {
    const c = await caches.open('workbox-precache-test');
    await c.put('/stale.txt', new Response('old'));
    localStorage.setItem('probe.kept', 'yes');
  });
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Reload the latest version' }).click();
  await reloaded;
  await expect(page).toHaveURL(/#\/settings$/);
  expect(page.url()).not.toContain('fresh=');
  // The old saved copy is gone (the new version may already have saved a fresh one).
  expect(await page.evaluate(() => caches.keys())).not.toContain('workbox-precache-test');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('beepbeep.settings.v1')!).charWpm)).toBe(27);
  expect(await page.evaluate(() => localStorage.getItem('probe.kept'))).toBe('yes');
});

test('Reload the latest version refuses while offline', async ({ page, context }) => {
  await settings(page, BASE);
  await page.goto('./#/settings');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Reload the latest version' }).click();
  await expect(page.getByText(/You're offline/)).toBeVisible();
  await context.setOffline(false);
});
