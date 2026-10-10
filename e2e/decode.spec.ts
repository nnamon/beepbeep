// The full browser path: fake microphone -> AudioWorklet detector -> decoder -> screen.
import { test, expect } from '@playwright/test';

test('decodes CW from the microphone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ input: 'mic', sendWpm: 20, voice: 'off' })));
  await page.goto('./#/practice/live');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByLabel('Decoded sending')).toContainText('PARIS PARIS', { timeout: 20_000 });
  await expect(page.locator('a[aria-label^="Signal"]').first()).toContainText(/6[45]\d Hz/);
  expect(errors).toEqual([]);
});

test('decodes the keyboard straight key', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ input: 'straight', sendWpm: 15, voice: 'off' })));
  await page.goto('./#/practice/live');
  await page.getByRole('button', { name: 'Start' }).click();
  const dit = 80;
  // K = dah dit dah, then pause; M = dah dah.
  const send = async (pattern: string) => {
    for (const el of pattern) {
      await page.keyboard.down('Space');
      await page.waitForTimeout(el === '.' ? dit : dit * 3);
      await page.keyboard.up('Space');
      await page.waitForTimeout(dit);
    }
    await page.waitForTimeout(dit * 3);
  };
  await send('-.-');
  await send('--');
  await expect(page.getByLabel('Decoded sending')).toContainText('KM', { timeout: 5_000 });
});
