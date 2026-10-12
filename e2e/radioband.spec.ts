// Radio with three stations in turn (e2e/.fixtures/radio-band.wav, played
// over and over by the fake microphone): 9V1NE at 600 Hz, G4ABC at 780 Hz and
// JA1XYZ at 500 Hz. Each is a signal of its own; one is followed in large
// text and the others are listed by pitch.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { BASE, collectErrors, instrument, settings } from './probe';

test.setTimeout(150_000);

const rows = (page: Page) => page.locator('.side ul li button');
const following = (page: Page) => page.locator('.following');
const box = (page: Page) => page.getByRole('region', { name: /^Text from the signal at \d+ Hz$/ });
const hzOf = (s: string) => Number(s.match(/(\d+) Hz/)![1]);

/** Listens until all three stations have been heard. */
async function listen(page: Page, extra: Record<string, unknown> = {}) {
  await instrument(page);
  await settings(page, { ...BASE, input: 'mic', ...extra });
  await page.goto('./#/radio');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(rows(page)).toHaveCount(2, { timeout: 120_000 });
}

test('every station is a signal: one followed, the others listed by pitch', async ({ page }) => {
  const errors = collectErrors(page);
  await listen(page);
  const listed = (await rows(page).allInnerTexts()).map(hzOf);
  const followedHz = hzOf(await following(page).innerText());
  const all = [...listed, followedHz].sort((a, b) => a - b);
  expect(all.map((hz, i) => Math.abs(hz - [500, 600, 780][i]) < 20), `pitches ${all.join(', ')}`).toEqual([true, true, true]);
  expect(listed[0]).toBeLessThan(listed[1]);
  // Each row ends with what that station sent.
  const texts = await rows(page).allInnerTexts();
  for (const t of texts) expect(t).toMatch(/9V1NE|G4ABC|JA1XYZ|CQ|599/);
  expect(errors).toEqual([]);
});

test('arrow keys move through the list and Enter follows a signal; Follow automatically goes back', async ({ page }) => {
  await listen(page);
  const first = rows(page).first();
  await first.focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows(page).nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(rows(page).first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(rows(page).nth(1)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(rows(page).first()).toBeFocused();
  // One stop in the tab order.
  expect(await rows(page).evaluateAll((bs) => bs.map((b) => (b as HTMLElement).tabIndex))).toEqual([0, -1]);
  const want = hzOf(await rows(page).first().innerText());
  await page.keyboard.press('Enter');
  await expect(following(page)).toContainText(`${want} Hz`);
  // The row moved up into the big text; focus went with it.
  await expect(box(page)).toBeFocused();
  await expect(box(page)).toHaveAccessibleName(`Text from the signal at ${want} Hz`);
  const auto = page.getByRole('button', { name: 'Follow automatically' });
  await expect(auto).toBeVisible();
  // Chosen, it stays followed while the others send.
  await page.waitForTimeout(12_000);
  await expect(following(page)).toContainText(`${want} Hz`);
  await auto.click();
  await expect(auto).toBeHidden();
});

test('tapping a row follows that signal', async ({ page }) => {
  await listen(page);
  const want = hzOf(await rows(page).nth(1).innerText());
  await rows(page).nth(1).click();
  await expect(following(page)).toContainText(`${want} Hz`);
  await expect(box(page)).toHaveAccessibleName(`Text from the signal at ${want} Hz`);
});

test('at 360 px the list fits, rows are big enough to tap, and nothing sits under the tab bar', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await listen(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  for (const b of await rows(page).all()) {
    const r = (await b.boundingBox())!;
    expect(r.height).toBeGreaterThanOrEqual(44);
    expect(r.x + r.width).toBeLessThanOrEqual(360);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const m = await page.evaluate(() => ({
    last: document.querySelector('.side ul li:last-child')!.getBoundingClientRect().bottom,
    bar: document.querySelector('.tabbar')!.getBoundingClientRect().top,
  }));
  expect(m.last).toBeLessThanOrEqual(m.bar);
});

// A 390 x 844 phone, in Safari and installed (notch and home bar set with the app's safe-area tokens).
for (const insets of [
  { name: 'Safari', top: 0, bottom: 0 },
  { name: 'installed', top: 47, bottom: 34 },
]) {
  test(`390 x 844 phone, ${insets.name}: six lines of text and the first of Other signals without scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await listen(page);
    await page.addStyleTag({ content: `:root { --safe-top: ${insets.top}px !important; --safe-bottom: ${insets.bottom}px !important; }` });
    await page.evaluate(() => window.scrollTo(0, 0));
    const m = await page.evaluate(() => {
      const box = document.querySelector('main .box')!;
      const cs = getComputedStyle(box);
      const inner = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      return {
        lines: Math.floor(inner / parseFloat(cs.lineHeight)),
        firstRow: document.querySelector('.side ul li')!.getBoundingClientRect().bottom,
        helper: document.querySelector('.side p')!.getBoundingClientRect().bottom,
        bar: document.querySelector('.tabbar')!.getBoundingClientRect().top,
      };
    });
    expect(m.lines, 'lines of text in the box').toBeGreaterThanOrEqual(6);
    expect(m.helper, 'Other signals help above the tab bar').toBeLessThanOrEqual(m.bar);
    expect(m.firstRow, 'first of Other signals above the tab bar').toBeLessThanOrEqual(m.bar);
  });
}

test('axe passes with signals listed', async ({ page }) => {
  await listen(page);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
});

for (const theme of ['dark', 'light'] as const) {
  for (const size of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 860 },
  ]) {
    test(`screenshot: ${size.name}, ${theme}, three stations`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await listen(page, { theme });
      await page.screenshot({ path: `test-results/screens/radio-${size.name}-${theme}-band.png` });
      await page.screenshot({ path: `test-results/screens/radio-${size.name}-${theme}-band-full.png`, fullPage: true });
    });
  }
}
