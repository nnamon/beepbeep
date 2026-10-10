// The on-screen touch key: the pad appears while a drill listens, keys a
// straight key, and on a phone takes the tab bar's place.
import { test, expect } from '@playwright/test';

test('touch key sends and decodes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ input: 'touch', sendWpm: 12, voice: 'off', guideSeen: true })),
  );
  await page.goto('./#/practice/live');
  const pad = page.getByRole('button', { name: /Touch key/ });
  await expect(pad).toHaveCount(0);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(pad).toBeVisible();
  const phone = (page.viewportSize()?.width ?? 1280) <= 760;
  if (phone) await expect(page.locator('nav.tabbar')).toBeHidden();

  // K M at 12 wpm, timed inside the page so runner latency cannot stretch gaps.
  await page.evaluate(async ({ pattern, dit }) => {
    const el = document.querySelector('.pad')!;
    const ev = (type: string) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true });
    const evs: [number, boolean][] = [];
    let t = 0;
    for (const ch of pattern) {
      if (ch === ' ') {
        t += dit * 2;
        continue;
      }
      evs.push([t, true]);
      t += ch === '.' ? dit : dit * 3;
      evs.push([t, false]);
      t += dit;
    }
    const t0 = performance.now();
    for (const [at, down] of evs) {
      const wait = t0 + at - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      el.dispatchEvent(ev(down ? 'pointerdown' : 'pointerup'));
    }
  }, { pattern: '-.- --', dit: 100 });

  await expect(page.getByLabel('Decoded sending')).toContainText('KM', { timeout: 5_000 });
  await expect(page.locator('a[aria-label^="Signal"]').first()).toContainText('Touch key');
  await page.screenshot({ path: `test-results/screens/flow-touch-${phone ? 'phone' : 'desktop'}.png` });
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(pad).toHaveCount(0);
  if (phone) await expect(page.locator('nav.tabbar')).toBeVisible();
  expect(errors).toEqual([]);
});
