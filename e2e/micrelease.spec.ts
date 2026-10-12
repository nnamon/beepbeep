// The microphone is released after you leave the screens that listen.
import { test, expect } from '@playwright/test';
import { BASE, instrument, liveTracks, settings } from './probe';

test('the mic is let go about 10 s after leaving a sending screen', async ({ page }) => {
  test.setTimeout(60_000);
  await instrument(page);
  await settings(page, { ...BASE, input: 'mic' });
  await page.goto('./#/practice/live');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect.poll(() => liveTracks(page)).toBeGreaterThan(0);
  await page.getByRole('button', { name: /Stop/ }).click();
  // A quick look at another listening screen keeps it.
  await page.goto('./#/setup');
  await page.waitForTimeout(500);
  await page.goto('./#/progress');
  await page.waitForTimeout(3000);
  expect(await liveTracks(page)).toBeGreaterThan(0);
  await expect.poll(() => liveTracks(page), { timeout: 15_000 }).toBe(0);
  await expect(page.getByText('Mic off').first()).toBeVisible();
});
