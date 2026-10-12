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

test('choice buttons work like radio buttons from the keyboard', async ({ page }) => {
  await open(page, 'practice/copy');
  const group = page.getByRole('radiogroup', { name: 'Material' });
  const radios = group.getByRole('radio');
  const checked = group.getByRole('radio', { checked: true });
  // One stop in the tab order: the chosen option.
  expect(await radios.evaluateAll((rs) => rs.map((r) => (r as HTMLElement).tabIndex))).toEqual([-1, 0, -1, -1]);
  await expect(checked).toHaveAccessibleName('Groups');
  await checked.focus();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Words' })).toBeFocused();
  await expect(group.getByRole('radio', { name: 'Words' })).toBeChecked();
  await page.keyboard.press('ArrowDown');
  await expect(group.getByRole('radio', { name: 'Short phrases' })).toBeChecked();
  // Wraps round at the ends.
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Characters' })).toBeChecked();
  await expect(group.getByRole('radio', { name: 'Characters' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(group.getByRole('radio', { name: 'Short phrases' })).toBeChecked();
  await page.keyboard.press('Home');
  await expect(group.getByRole('radio', { name: 'Characters' })).toBeChecked();
  await page.keyboard.press('End');
  await expect(group.getByRole('radio', { name: 'Short phrases' })).toBeChecked();
  expect(await radios.evaluateAll((rs) => rs.map((r) => (r as HTMLElement).tabIndex))).toEqual([-1, -1, -1, 0]);
  await page.keyboard.press('ArrowUp');
  await expect(group.getByRole('radio', { name: 'Words' })).toBeChecked();
  // Tab leaves the group instead of walking through each option.
  await page.keyboard.press('Tab');
  await expect(page.locator('main [role="radio"]:focus')).toHaveCount(0);
});

test('each screen has its own title, and focus moves to its heading', async ({ page }) => {
  await open(page, 'practice');
  await expect(page).toHaveTitle('Practice · BeepBeep');
  // On first load focus stays where the browser puts it.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

  await page.locator('header nav').getByRole('link', { name: 'Pocket' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveTitle('Pocket · BeepBeep');
  await expect(page.getByRole('heading', { level: 1, name: 'Pocket' })).toBeFocused();

  await page.getByRole('link', { name: /^Characters/ }).click();
  await expect(page).toHaveTitle('Characters · Pocket · BeepBeep');
  await expect(page.locator('main')).toBeFocused();

  await page.getByRole('link', { name: 'Back to Pocket' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pocket' })).toBeFocused();

  await page.goto('./#/practice/copy');
  await expect(page).toHaveTitle('Copy drill · BeepBeep');
  await expect(page.getByRole('heading', { level: 1, name: 'Copy drill' })).toBeFocused();

  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page).toHaveTitle('Practice · BeepBeep');
  await expect(page.getByRole('heading', { level: 1, name: 'Practice' })).toBeFocused();

  await page.goto('./#/practice/class/bc1/familiarity');
  await expect(page).toHaveTitle(/^Familiarity.* · BeepBeep$/);
  await expect(page.locator('main h1')).toBeFocused();

  // Focus on a heading shows no ring: it is not something you can press.
  expect(await page.locator('main h1').evaluate((h) => getComputedStyle(h).outlineStyle)).toBe('none');
});

test('a skip link is the first stop and moves to the content', async ({ page }) => {
  await open(page, 'practice');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  const box = (await skip.boundingBox())!;
  expect(box.y, 'shown on screen while focused').toBeGreaterThanOrEqual(0);
  expect(box.height).toBeGreaterThanOrEqual(24);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Practice' })).toBeFocused();
  expect(page.url()).toMatch(/#\/practice$/);
  // Hidden again once you move on.
  await page.keyboard.press('Tab');
  expect((await skip.boundingBox())?.y ?? -1).toBeLessThan(0);
});

test('shortcut hints are shown but are not part of the button name', async ({ page }) => {
  await open(page, 'practice/copy');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect(page.locator('main .footer').getByText('Enter', { exact: true })).toBeVisible();
  await open(page, 'practice/ttr');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
});

test('the signal bar is named by what it shows', async ({ page }) => {
  await open(page, 'practice', { input: 'mic' });
  const bar = page.locator('header .signal a');
  await expect(bar).toContainText('Mic off');
  await expect(bar).toHaveAccessibleName(/^Mic off\b.*input setup/i);
  await open(page, 'practice', { input: 'touch' });
  // Same address, so load it again for the new settings to apply.
  await page.reload();
  await expect(page.locator('header .signal a')).toHaveAccessibleName(/^Touch key\b.*input setup/i);
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.locator('header .signal a')).toHaveAccessibleName(/Character speed \d+ wpm/);
});

test('notices are announced', async ({ page }) => {
  await open(page, 'practice');
  const live = await page.locator('[aria-live="polite"], [role="status"]').elementHandles();
  expect(live.length).toBeGreaterThan(0);
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.getByRole('status').filter({ hasText: /^Character speed \d+ wpm$/ })).toHaveCount(1);
  // The region was there before the text arrived, so screen readers notice the change.
  const texts = await Promise.all(live.map((h) => h.evaluate((e) => e.isConnected && e.textContent)));
  expect(texts.some((t) => t && /Character speed \d+ wpm/.test(t))).toBe(true);
});

test('Pocket: the answer after a miss is announced', async ({ page }) => {
  await open(page, 'pocket/round/characters', { level: { koch: 'koch-20', licw: 'licw-bc1-REA' } });
  await page.getByRole('button', { name: 'Start the round' }).click();
  const kb = page.getByRole('group', { name: 'Answer keyboard' });
  await expect(kb).not.toHaveClass(/disabled/, { timeout: 20_000 });
  const live = await page.locator('main [aria-live="polite"]').elementHandles();
  expect(live.length, 'a live region is there before the answer').toBeGreaterThan(0);
  await kb.getByRole('button', { name: 'Q', exact: true }).click();
  await expect(page.getByText(/^You typed Q/)).toBeVisible();
  const texts = await Promise.all(live.map((h) => h.evaluate((e) => e.isConnected && (e as HTMLElement).innerText)));
  expect(texts.some((t) => t && /It was/.test(t) && /You typed Q/.test(t))).toBe(true);
});

test('Sprint: each result is announced', async ({ page }) => {
  // A lesson with digits, so callsigns can be made from it.
  await open(page, 'practice/sprint', { track: 'koch', level: { koch: 'koch-44', licw: 'licw-bc1-REA' } });
  await page.getByRole('button', { name: /^Start/ }).click();
  const kb = page.getByRole('group', { name: 'Answer keyboard' });
  await expect(kb).toBeVisible();
  const live = await page.locator('main [aria-live="polite"]').elementHandles();
  expect(live.length, 'a live region is there before the result').toBeGreaterThan(0);
  await kb.getByRole('button', { name: 'Q', exact: true }).click();
  await kb.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText(/^Typed Q/)).toBeVisible();
  const texts = await Promise.all(live.map((h) => h.evaluate((e) => e.isConnected && (e as HTMLElement).innerText)));
  expect(texts.some((t) => t && /Typed Q/.test(t))).toBe(true);
});

test('Practice: the pointer to the guide reads as one line of text', async ({ page }) => {
  await open(page, 'practice', { guideSeen: false });
  const p = page.getByText(/shows where to start/);
  await expect(p).toBeVisible();
  const parts = await p.evaluate((el) => {
    const range = document.createRange();
    return [...el.childNodes]
      .filter((n) => n.textContent!.trim())
      .map((n) => {
        let r: DOMRect;
        if (n.nodeType === Node.TEXT_NODE) {
          range.selectNodeContents(n);
          r = range.getBoundingClientRect();
        } else r = (n as Element).getBoundingClientRect();
        return { text: n.textContent!.trim(), top: Math.round(r.top), bottom: Math.round(r.bottom), left: r.left, right: r.right };
      });
  });
  // "The", "guide", "shows where to start…", Dismiss: one line, a space apart.
  expect(parts.map((x) => x.text)).toEqual(['The', 'guide', expect.stringMatching(/^shows where to start/), 'Dismiss']);
  for (let i = 1; i < 3; i++) {
    expect(Math.abs(parts[i].top - parts[0].top), `"${parts[i].text}" on the first line`).toBeLessThanOrEqual(2);
    expect(parts[i].left - parts[i - 1].right, `space before "${parts[i].text}"`).toBeLessThan(9);
  }
  // Dismiss follows the sentence on the same line.
  expect(parts[3].top).toBeLessThan(parts[2].bottom);
  expect(parts[3].left).toBeGreaterThan(parts[2].right);
});

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
