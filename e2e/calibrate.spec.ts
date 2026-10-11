// Calibration on the touch key with a hand fist: short taps, long pauses
// (the case that used to read V V V as EEET EEET EEET).
import { test, expect } from '@playwright/test';

test('calibrates V V V keyed by hand on the touch key', async ({ page }) => {
  test.setTimeout(40_000);
  await page.addInitScript(() =>
    localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ input: 'touch', sendWpm: 15, voice: 'off', guideSeen: true })),
  );
  await page.goto('./#/setup');
  await page.getByRole('button', { name: 'Calibrate' }).click();
  await expect(page.getByRole('button', { name: /Touch key/ })).toBeVisible();
  await page.evaluate(async () => {
    const el = document.querySelector('.pad')!;
    const ev = (type: string) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch', isPrimary: true });
    // ms: dit 80, dah 280, gap inside a letter about 200, between V's about 1300; uneven like a hand.
    const wobble = [1.1, 0.9, 1.2, 0.85, 1.05, 0.95, 1.15, 0.9, 1.0, 1.1, 0.8, 1.2];
    let w = 0;
    const j = (ms: number) => ms * wobble[w++ % wobble.length];
    const evs: [number, boolean][] = [];
    let t = 200;
    for (let v = 0; v < 3; v++) {
      if (v) t += j(1300);
      for (let i = 0; i < 4; i++) {
        if (i) t += j(200);
        evs.push([t, true]);
        t += j(i < 3 ? 80 : 280);
        evs.push([t, false]);
      }
    }
    const t0 = performance.now();
    for (const [at, down] of evs) {
      const wait = t0 + at - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      el.dispatchEvent(ev(down ? 'pointerdown' : 'pointerup'));
    }
  });
  const note = page.locator('.block', { hasText: 'Calibrate' }).locator('p').last();
  await expect(note).toContainText(/3 V\. \d+ wpm/, { timeout: 15_000 });
  await expect(note).not.toContainText('breaking up');
  await expect(note).toContainText('Gaps inside a letter run');
  // The second pass ran in its worker, off the thread that times the key.
  const worker = await page.evaluate(() => performance.getEntriesByType('resource').some((r) => r.name.includes('settle.worker')));
  expect(worker).toBe(true);
});
