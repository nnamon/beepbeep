// The on-screen touch key: on a sending screen the pad stays in place (faded
// while nothing listens), keys a straight key, and on a phone takes the tab
// bar's place for as long as the screen is open.
import { test, expect } from '@playwright/test';

test('touch key sends and decodes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ input: 'touch', sendWpm: 12, voice: 'off', guideSeen: true })),
  );
  await page.goto('./#/practice/live');
  const pad = page.locator('.pad');
  await expect(pad).toBeVisible();
  await expect(pad).toHaveAttribute('aria-disabled', 'true');
  const before = await pad.boundingBox();
  const phone = (page.viewportSize()?.width ?? 1280) <= 760;
  if (phone) await expect(page.locator('nav.tabbar')).toBeHidden();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(pad).toHaveAttribute('aria-disabled', 'false');
  expect(await pad.boundingBox()).toEqual(before);

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
  await expect(pad).toHaveAttribute('aria-disabled', 'true');
  expect(await pad.boundingBox()).toEqual(before);
  if (phone) await expect(page.locator('nav.tabbar')).toBeHidden();
  // Leaving the sending screen puts the tab bar back.
  await page.goto('./#/progress');
  await expect(pad).toHaveCount(0);
  if (phone) await expect(page.locator('nav.tabbar')).toBeVisible();
  expect(errors).toEqual([]);
});

// Receive, then send: the decoder starts and stops for every item, and the
// pad must not come and go with it.
test('the touch key stays put through hear it, send it', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ input: 'touch', sendWpm: 15, voice: 'off', guideSeen: true })),
  );
  await page.goto('./#/practice/hear-send');
  const pad = page.locator('.pad');
  await expect(pad).toBeVisible();
  const home = await pad.boundingBox();
  await page.getByRole('button', { name: 'Start' }).click();
  // Sample the pad through listening and sending phases.
  const states = new Set<string>();
  for (let i = 0; i < 25; i++) {
    expect(await pad.boundingBox()).toEqual(home);
    states.add((await pad.getAttribute('aria-disabled')) ?? '');
    await page.waitForTimeout(200);
  }
  // It was live while it was your turn and faded while the app sent.
  expect(states).toEqual(new Set(['true', 'false']));
});
