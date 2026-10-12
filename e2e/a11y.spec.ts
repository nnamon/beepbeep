// Accessibility: axe-core (WCAG 2.0-2.2 A and AA rules) on every screen in both themes,
// plus keyboard use, names, announcements and focus that axe cannot check.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = [
  'practice', 'practice/live', 'practice/send', 'practice/hear-send', 'practice/copy', 'practice/familiarity', 'practice/ttr',
  'practice/ifr', 'practice/head-copy', 'practice/sprint', 'pocket', 'pocket/custom', 'pocket/round/characters',
  'qso', 'progress', 'settings', 'setup', 'reference', 'specimen', 'guide',
  'qso/learn', 'qso/learn/answer-cq',
  'practice/class/bc1/familiarity', 'practice/class/bc2/vst', 'practice/class/adv1/stories', 'practice/class/overlearn/rhythm',
];

for (const theme of ['dark', 'light', 'paper'] as const) {
  for (const route of ROUTES) {
    test(`${theme} ${route}`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ theme: t, voice: 'off', track: 'licw', licwAsked: true }));
      }, theme);
      await page.goto(`./#/${route}`);
      await page.waitForTimeout(500);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const found = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}× ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
      expect(found).toEqual([]);
    });
  }
}

async function open(page: Page, route: string, settings: Record<string, unknown> = {}) {
  await page.addInitScript((s) => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ voice: 'off', guideSeen: true, ...s })), settings);
  await page.goto(`./#/${route}`);
  await page.waitForTimeout(300);
}

test('a prosign overline sits just above its letters', async ({ page }) => {
  // Koch lesson 40 adds BT.
  await open(page, 'practice', { level: { koch: 'koch-40', licw: 'licw-bc1-REA' } });
  await page.evaluate(() => document.fonts.ready);
  const bt = page.locator('main p.text span', { hasText: /^BT$/ });
  await expect(bt).toBeVisible();
  const r = (await bt.boundingBox())!;
  const size = await bt.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  const pad = 4;
  const shot = await page.screenshot({ clip: { x: r.x - pad, y: r.y - size * 0.4, width: r.width + pad * 2, height: r.height + size * 0.4 } });
  const rows = await page.evaluate(async ({ b64, pad }) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    const lum = (i: number) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const bg = lum(0);
    const out: number[] = [];
    for (let y = 0; y < img.height; y++) {
      let ink = 0;
      for (let x = pad; x < img.width - pad; x++) if (Math.abs(lum((y * img.width + x) * 4) - bg) > 60) ink++;
      out.push(ink / (img.width - pad * 2));
    }
    return out;
  }, { b64: shot.toString('base64'), pad });
  // Rows inked across nearly the whole width are lines; the tops of B and T ink only part of a row.
  const glyph = rows.findIndex((x) => x > 0.1 && x <= 0.85);
  expect(glyph, 'the letters are in the picture').toBeGreaterThan(0);
  const lines: [number, number][] = [];
  for (let y = 0; y < glyph; y++) {
    if (rows[y] <= 0.85) continue;
    if (lines.length && lines[lines.length - 1][1] === y - 1) lines[lines.length - 1][1] = y;
    else lines.push([y, y]);
  }
  expect(lines.length, 'exactly one overline').toBe(1);
  const gap = glyph - lines[0][1] - 1;
  expect(gap, `gap between the overline and the letters at ${size} px`).toBeGreaterThanOrEqual(1);
  expect(gap, `gap between the overline and the letters at ${size} px`).toBeLessThanOrEqual(Math.ceil(size * 0.16));
});
