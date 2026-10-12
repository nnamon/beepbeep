// The microphone is released after you leave the screens that listen.
import { test, expect, type Page } from '@playwright/test';
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

const gumCalls = (page: Page) => page.evaluate(() => (window as unknown as { __gumCalls?: number }).__gumCalls ?? 0);

// Before: each press while the browser asked for the microphone opened another
// stream, and the extra one was never let go.
for (const c of [
  { name: 'Hear it, send it: Start', path: 'practice/hear-send', button: /^Start/ },
  { name: 'Setup: Calibrate', path: 'setup', button: /^Calibrate$/ },
]) {
  test(`${c.name} pressed twice while the browser asks for the mic opens one stream, let go after leaving`, async ({ page }) => {
    test.setTimeout(60_000);
    await instrument(page, { gumDelayMs: 1500 });
    await settings(page, { ...BASE, input: 'mic' });
    await page.goto(`./#/${c.path}`);
    const button = page.getByRole('button', { name: c.button });
    await button.click();
    await page.waitForTimeout(250);
    await button.click();
    await page.waitForTimeout(3000);
    expect(await gumCalls(page)).toBe(1);
    expect(await liveTracks(page)).toBe(1);
    await page.evaluate(() => (location.hash = '#/progress'));
    await expect.poll(() => liveTracks(page), { timeout: 20_000 }).toBe(0);
  });
}
