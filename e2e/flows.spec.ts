// Whole flows driven by the keyboard straight key: a send drill and a contest QSO.
import { test, expect, type Page } from '@playwright/test';
import { patternOf, tokenize } from '../src/lib/morse/code';

test.skip(({ browserName }) => browserName !== 'chromium');

/** Keys text on the Space-bar straight key at the given speed. */
async function key(page: Page, text: string, wpm = 18) {
  const dit = 1200 / wpm;
  for (const t of tokenize(text)) {
    if (t === ' ') {
      await page.waitForTimeout(dit * 4);
      continue;
    }
    for (const el of patternOf(t)!) {
      await page.keyboard.down('Space');
      await page.waitForTimeout(el === '.' ? dit : dit * 3);
      await page.keyboard.up('Space');
      await page.waitForTimeout(dit);
    }
    await page.waitForTimeout(dit * 2);
  }
}

const SETTINGS = { input: 'straight', sendWpm: 18, voice: 'off', overTimeout: 2, theme: 'dark', you: { call: 'K1ABC', name: 'TOM', qth: 'BOSTON', state: 'MA', skcc: '' } };

test('send drill: key the prompt, see it received', async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem('beepbeep.settings.v1', JSON.stringify(s)), SETTINGS);
  await page.goto('./#/practice/send');
  await page.getByRole('radio', { name: 'Callsigns' }).click();
  await page.getByRole('button', { name: /Start/ }).click();
  const prompt = (await page.locator('.block').first().locator('p').innerText()).trim();
  await key(page, prompt);
  await page.getByRole('button', { name: /Done/ }).click();
  await expect(page.getByText('Received')).toBeVisible();
  const received = (await page.locator('.block').first().locator('p').first().innerText()).trim();
  expect(received.replace(/\s+/g, ' ')).toBe(prompt.replace(/\s+/g, ' '));
  await page.screenshot({ path: 'test-results/screens/flow-send-review.png', fullPage: true });
});

test('contest QSO with the bot, start to log', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript((s) => localStorage.setItem('beepbeep.settings.v1', JSON.stringify(s)), SETTINGS);
  await page.goto('./#/qso');
  await page.getByText('Contest', { exact: true }).click();
  await page.getByRole('button', { name: 'Start QSO' }).click();
  await expect(page.getByText('Your turn')).toBeVisible({ timeout: 30_000 });
  await key(page, 'K1ABC');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Station sending')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Your turn')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Serial').fill('42');
  await page.getByRole('heading', { level: 1 }).click(); // move focus off the field before keying
  await key(page, 'TU 5NN 001');
  await page.keyboard.press('Enter');
  await expect(page.getByText('QSO ended')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('table.res caption')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/flow-qso-result.png', fullPage: true });
});
