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
  // K then M on Space, timed inside the page so test-runner load cannot stretch the gaps.
  await page.evaluate(async () => {
    const dit = 80;
    const evs: [number, boolean][] = [];
    let t = 0;
    for (const letter of ['-.-', '--']) {
      for (const el of letter) {
        evs.push([t, true]);
        t += el === '.' ? dit : dit * 3;
        evs.push([t, false]);
        t += dit;
      }
      t += dit * 2;
    }
    const t0 = performance.now();
    for (const [at, down] of evs) {
      const wait = t0 + at - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: 'Space', key: ' ', bubbles: true }));
    }
  });
  await expect(page.getByLabel('Decoded sending')).toContainText('KM', { timeout: 5_000 });
});
