// Whole flows driven by the keyboard straight key: a send drill and a contest QSO.
import { test, expect, type Page } from '@playwright/test';
import { patternOf, tokenize } from '../src/lib/morse/code';

test.skip(({ browserName }) => browserName !== 'chromium');

/**
 * Keys text on the Space-bar straight key at the given speed. Events are timed
 * inside the page against one start time, so test-runner latency under load
 * does not stretch the gaps.
 */
async function key(page: Page, text: string, wpm = 18) {
  const dit = 1200 / wpm;
  const events: [number, boolean][] = [];
  let t = 0;
  for (const tok of tokenize(text)) {
    if (tok === ' ') {
      t += dit * 4;
      continue;
    }
    for (const el of patternOf(tok)!) {
      events.push([t, true]);
      t += el === '.' ? dit : dit * 3;
      events.push([t, false]);
      t += dit;
    }
    t += dit * 2;
  }
  await page.evaluate(async (evs) => {
    const t0 = performance.now();
    for (const [at, down] of evs) {
      const wait = t0 + at - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: 'Space', key: ' ', bubbles: true }));
    }
  }, events);
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
  await expect(page.getByText('Your turn', { exact: true })).toBeVisible({ timeout: 30_000 });
  await key(page, 'K1ABC');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Station sending')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Your turn', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Serial').fill('42');
  await page.getByRole('heading', { level: 1 }).click(); // move focus off the field before keying
  await key(page, 'TU 5NN 001');
  await page.keyboard.press('Enter');
  await expect(page.getByText('QSO ended')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('table.res caption')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/flow-qso-result.png', fullPage: true });
});
