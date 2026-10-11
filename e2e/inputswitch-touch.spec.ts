// Switching to the touch key in the middle of a drill: the decoder moves over
// at once and decodes what you tap.
import { test, expect } from '@playwright/test';
import { patternOf, tokenize } from '../src/lib/morse/code';

test('Live decoder: Use the touch key mid-drill, then tap', async ({ page }, info) => {
  test.skip(info.project.name !== 'mic', 'needs the fake microphone running first');
  await page.addInitScript(() => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ input: 'mic', sendWpm: 15, voice: 'off', guideSeen: true })));
  await page.goto('./#/practice/live');
  await page.getByRole('button', { name: /Start/ }).click();
  await expect(page.locator('.pad')).toHaveCount(0);
  await page.getByRole('button', { name: 'Use the touch key' }).click();
  await expect(page.locator('.pad')).toBeVisible();
  await page.getByRole('button', { name: /Clear/ }).click();
  const dit = 80;
  const evs: [number, boolean][] = [];
  let t = 200;
  for (const tok of tokenize('TEST')) {
    for (const el of patternOf(tok)!) {
      evs.push([t, true]);
      t += el === '.' ? dit : dit * 3;
      evs.push([t, false]);
      t += dit;
    }
    t += dit * 2;
  }
  await page.evaluate(async (evs) => {
    const el = document.querySelector('.pad')!;
    const ev = (type: string) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch', isPrimary: true });
    const t0 = performance.now();
    for (const [at, down] of evs) {
      const wait = t0 + at - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      el.dispatchEvent(ev(down ? 'pointerdown' : 'pointerup'));
    }
  }, evs);
  await expect(page.getByLabel('Decoded sending')).toContainText('TEST', { timeout: 8000 });
});
