// Calibration on the touch key with a hand fist: short taps, long pauses
// (the case that used to read V V V as EEET EEET EEET).
import { test, expect, type Page } from '@playwright/test';

/** Keys `marks` (ms down, ms up after the previous mark) on the touch pad, in real time. */
async function key(page: Page, marks: [number, number][]) {
  await page.evaluate(async (marks) => {
    const el = document.querySelector('.pad')!;
    const ev = (type: string) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch', isPrimary: true });
    const evs: [number, boolean][] = [];
    let t = 0;
    for (const [gap, len] of marks) {
      t += gap;
      evs.push([t, true]);
      t += len;
      evs.push([t, false]);
    }
    const t0 = performance.now();
    for (const [at, down] of evs) {
      const wait = t0 + at - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      el.dispatchEvent(ev(down ? 'pointerdown' : 'pointerup'));
    }
  }, marks);
}

/** V V V by hand: dit 80, dah 280, gap inside a letter about 200, between V's about 1300 ms; uneven. */
function vvv(): [number, number][] {
  const wobble = [1.1, 0.9, 1.2, 0.85, 1.05, 0.95, 1.15, 0.9, 1.0, 1.1, 0.8, 1.2];
  let w = 0;
  const j = (ms: number) => ms * wobble[w++ % wobble.length];
  const out: [number, number][] = [];
  for (let v = 0; v < 3; v++) for (let i = 0; i < 4; i++) out.push([v + i === 0 ? 200 : j(i ? 200 : 1300), j(i < 3 ? 80 : 280)]);
  return out;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ input: 'touch', sendWpm: 15, voice: 'off', guideSeen: true })),
  );
  await page.goto('./#/setup');
});

test('calibrates V V V keyed by hand on the touch key', async ({ page }) => {
  test.setTimeout(40_000);
  await page.getByRole('button', { name: 'Calibrate' }).click();
  await expect(page.getByRole('button', { name: /Touch key/ })).toBeVisible();
  await key(page, vvv());
  const note = page.locator('.block', { hasText: 'Calibrate' }).locator('p').last();
  await expect(note).toContainText(/3 V\. \d+ wpm/, { timeout: 15_000 });
  await expect(note).not.toContainText('breaking up');
  await expect(note).toContainText('Gaps inside a letter run');
  // The second pass ran in its worker, off the thread that times the key.
  const worker = await page.evaluate(() => performance.getEntriesByType('resource').some((r) => r.name.includes('settle.worker')));
  expect(worker).toBe(true);
});

test('starts over mid-calibration and finishes early', async ({ page }) => {
  test.setTimeout(40_000);
  await page.getByRole('button', { name: 'Calibrate' }).click();
  await expect(page.getByText(/Listening, \d s left/)).toBeVisible();
  // A fumble: long dahs that are no V.
  await key(page, [[200, 400], [300, 400], [300, 400]]);
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByText('Listening, 9 s left')).toBeVisible();
  await key(page, vvv());
  await page.getByRole('button', { name: 'Done' }).click();
  const note = page.locator('.block', { hasText: 'Calibrate' }).locator('p').last();
  // Only the V's after starting over count, and well before the 9 s run out.
  await expect(note).toContainText(/^3 V\. \d+ wpm/, { timeout: 5_000 });
  const heard = (await page.locator('.block', { hasText: 'Calibrate' }).locator('p.text').textContent())!.replace(/\s/g, '');
  expect(heard).toBe('VVV');
  await expect(page.getByRole('button', { name: 'Calibrate' })).toBeEnabled();
});
