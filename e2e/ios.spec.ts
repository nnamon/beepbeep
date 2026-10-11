// iPhone (WebKit) behaviour: the sound gate, and quick taps on the touch key
// that must key without selecting text.
import { test, expect } from '@playwright/test';

test('turn sound on clears the gate', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ voice: 'off', guideSeen: true })));
  await page.goto('./#/practice');
  const gate = page.getByRole('button', { name: 'Turn sound on' });
  await expect(gate).toBeVisible();
  await gate.tap();
  await expect(gate).toBeHidden();
});

test('quick taps on the touch key key and select nothing', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ input: 'touch', sendWpm: 15, voice: 'off', guideSeen: true })),
  );
  await page.goto('./#/practice/live');
  await page.getByRole('button', { name: 'Start' }).tap();
  const pad = page.getByRole('button', { name: /Touch key/ });
  await expect(pad).toBeVisible();
  const box = (await pad.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // Human-length taps (60 ms) key dits.
  await page.mouse.move(x, y);
  for (let i = 0; i < 4; i++) {
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(60);
  }
  await expect(page.getByLabel('Decoded sending')).not.toBeEmpty({ timeout: 5_000 });
  // Rapid double taps, the gesture that selects text on iOS.
  for (let i = 0; i < 6; i++) await page.touchscreen.tap(x, y);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.shell')!).webkitUserSelect)).toBe('none');
});
