// Phone layouts with real notches and home bars: what you need during a drill
// (the answer keyboard) sits fully on screen above the tab bar, without
// scrolling. Browsers under test report safe areas of zero, so the test sets
// the app's safe-area tokens to each phone's.
import { test, expect, type Page } from '@playwright/test';

const SCREENS: { name: string; route: string; start: (p: Page) => Promise<void> }[] = [
  { name: 'Pocket round', route: 'pocket/round/characters', start: (p) => p.getByRole('button', { name: 'Start the round' }).click() },
  { name: 'Copy drill', route: 'practice/copy/groups', start: (p) => p.getByRole('button', { name: /Start/ }).click() },
  { name: 'TTR drill', route: 'practice/ttr', start: (p) => p.getByRole('button', { name: /Start/ }).click() },
  { name: 'IFR', route: 'practice/ifr', start: (p) => p.getByRole('button', { name: /Start/ }).click() },
  { name: 'Sprint', route: 'practice/sprint', start: (p) => p.getByRole('button', { name: /Start/ }).click() },
];

const PHONES = [
  { name: 'iPhone 15, installed', width: 393, height: 852, top: 59, bottom: 34 },
  { name: 'iPhone 15, Safari', width: 393, height: 659, top: 0, bottom: 0 },
  { name: 'iPhone SE, installed', width: 375, height: 667, top: 20, bottom: 0 },
  { name: 'iPhone 15 Pro Max, installed', width: 430, height: 932, top: 59, bottom: 34 },
  { name: 'Android 360', width: 360, height: 740, top: 0, bottom: 0 },
];

for (const phone of PHONES) for (const s of SCREENS) {
  test(`${phone.name}, ${s.name}: the keyboard is on screen above the tab bar`, async ({ page }, info) => {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await page.addInitScript(() => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ voice: 'off', guideSeen: true, level: { koch: 'koch-14', licw: 'licw-bc1-REA' } })));
    await page.goto(`./#/${s.route}`);
    await page.addStyleTag({ content: `:root { --safe-top: ${phone.top}px !important; --safe-bottom: ${phone.bottom}px !important; }` });
    await s.start(page);
    const kb = page.getByRole('group', { name: 'Answer keyboard' });
    await expect(kb).toBeVisible({ timeout: 15_000 });
    // Measured once it has settled: no transition or sound-gate banner moving it.
    await expect.poll(() => kb.evaluate((el) => el.getBoundingClientRect().bottom <= document.querySelector('.tabbar')!.getBoundingClientRect().top), { timeout: 5000 }).toBe(true);
    const m = await page.evaluate(() => {
      const kb = document.querySelector('[aria-label="Answer keyboard"]')!.getBoundingClientRect();
      const bar = document.querySelector('.tabbar')!.getBoundingClientRect();
      return { kbTop: Math.round(kb.top), kbBottom: Math.round(kb.bottom), barTop: Math.round(bar.top), scrollY: window.scrollY, vh: innerHeight };
    });
    await page.screenshot({ path: `test-results/screens/layout-${info.project.name}-${phone.name.replace(/[ ,]+/g, '-')}-${s.name.replace(/ /g, '-')}.png` });
    console.log(`LAYOUT ${phone.name} / ${s.name}: ${JSON.stringify(m)}`);
    expect(m.kbTop, 'keyboard starts on screen').toBeGreaterThanOrEqual(0);
    expect(m.kbBottom, 'keyboard ends above the tab bar').toBeLessThanOrEqual(m.barTop);
  });
}

/** Sets the app's safe-area tokens: test browsers report zero for env(safe-area-inset-*). */
async function safeAreas(page: Page, s: { top?: number; bottom?: number; left?: number; right?: number }) {
  await page.addStyleTag({
    content: `:root { --safe-top: ${s.top ?? 0}px !important; --safe-bottom: ${s.bottom ?? 0}px !important; --safe-left: ${s.left ?? 0}px !important; --safe-right: ${s.right ?? 0}px !important; }`,
  });
}

// After a wrong answer in a Pocket round, what it was, what you typed and the rhythm
// must all be in view: not under the Next button, the answer keys or the tab bar.
const REVEAL_PHONES = [
  ...PHONES,
  { name: 'iPhone 13, Safari', width: 390, height: 664, top: 0, bottom: 0 },
  { name: 'iPhone 13, installed', width: 390, height: 844, top: 47, bottom: 34 },
  { name: 'iPhone SE, Safari', width: 375, height: 548, top: 0, bottom: 0 },
];

for (const phone of REVEAL_PHONES) for (const stage of ['characters', 'words', 'callsigns']) {
  test(`${phone.name}, Pocket ${stage}: after a miss the answer is in view`, async ({ page }) => {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    // Lesson 20 does not have Q yet, so Q is always wrong.
    await page.addInitScript(() => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ voice: 'off', guideSeen: true, level: { koch: 'koch-20', licw: 'licw-bc1-REA' } })));
    await page.goto(`./#/pocket/round/${stage}`);
    await safeAreas(page, phone);
    // iOS shows a sound banner until the first tap; on a phone the Start tap clears it. Clear it here
    // first, so a slow test browser cannot leave it up and push everything down.
    const gate = page.getByRole('button', { name: 'Turn sound on' });
    if (await gate.isVisible()) await gate.click();
    await expect(gate).toBeHidden({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Start the round' }).click();
    const kb = page.getByRole('group', { name: 'Answer keyboard' });
    await expect(kb).not.toHaveClass(/disabled/, { timeout: 20_000 });
    await kb.getByRole('button', { name: 'Q', exact: true }).click();
    if (stage !== 'characters') {
      await kb.getByRole('button', { name: 'Q', exact: true }).click();
      await kb.getByRole('button', { name: 'Done', exact: true }).click();
    }
    const next = page.getByRole('button', { name: /^Next/ });
    await expect(next).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/^You typed/)).toBeVisible();
    await expect(gate, 'sound is on, so the banner is gone').toBeHidden();
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const center = document.querySelector('.round .center')!;
      const parts = [...center.children].filter((e) => e.tagName !== 'BUTTON' && (e as HTMLElement).getClientRects().length);
      const hidden: string[] = [];
      for (const el of parts) {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        for (const y of [r.top + 2, (r.top + r.bottom) / 2, r.bottom - 2]) {
          const hit = y >= 0 && y < innerHeight ? document.elementFromPoint(x, y) : null;
          if (!hit || !(hit === el || el.contains(hit))) {
            hidden.push(`"${(el as HTMLElement).innerText.replace(/\s+/g, ' ').slice(0, 20) || el.className}" at ${Math.round(y)}: ${hit ? `${hit.tagName.toLowerCase()} "${(hit as HTMLElement).innerText?.slice(0, 12) ?? ''}"` : 'off screen'}`);
            break;
          }
        }
      }
      const nextBtn = [...document.querySelectorAll('button')].find((b) => /^Next/.test(b.textContent!.trim()))!.getBoundingClientRect();
      const bar = document.querySelector('.tabbar')!.getBoundingClientRect();
      return { parts: parts.length, hidden, nextBottom: Math.round(nextBtn.bottom), barTop: Math.round(bar.top), scrollY };
    });
    expect(m.parts, 'It was, the answer and You typed').toBeGreaterThanOrEqual(3);
    expect(m.hidden, 'nothing of the answer is covered or off screen').toEqual([]);
    expect(m.nextBottom, 'Next ends above the tab bar').toBeLessThanOrEqual(m.barTop);
    expect(m.scrollY, 'no scrolling needed').toBe(0);
  });
}

// iOS Safari zooms into any text box under 16 px and stays zoomed, cutting the page off.
for (const route of ['qso/learn', 'settings', 'qso', 'pocket/custom', 'setup']) {
  test(`${route}: text boxes are 16 px or more on a touch screen`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ voice: 'off', guideSeen: true })));
    await page.goto(`./#/${route}`);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'the phone project has a touch screen').toBe(true);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('input, textarea, select')]
        .filter((e) => !['checkbox', 'radio', 'range', 'file'].includes((e as HTMLInputElement).type))
        .map((e) => ({ what: e.outerHTML.slice(0, 60), px: parseFloat(getComputedStyle(e).fontSize) }))
        .filter((x) => x.px < 16),
    );
    expect(small).toEqual([]);
  });
}
