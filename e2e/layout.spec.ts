// Phone layouts with real notches and home bars: what you need during a drill
// (the answer keyboard) sits fully on screen above the tab bar, without
// scrolling. Browsers under test report safe areas of zero, so the test sets
// the app's safe-area tokens to each phone's.
import { test, expect, type Locator, type Page } from '@playwright/test';

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

// A phone on its side gets a short, wide window, and the notch sits at one side.
const LANDSCAPE = [
  { name: 'iPhone 13 on its side, installed', width: 844, height: 390, left: 47, right: 47, bottom: 21 },
  { name: 'iPhone 13 on its side, Safari', width: 844, height: 340, left: 47, right: 47, bottom: 21 },
  { name: 'Android phone on its side', width: 780, height: 330, left: 0, right: 0, bottom: 0 },
];
const KEYBOARD_DRILLS = SCREENS;

for (const sz of LANDSCAPE) {
  test(`${sz.name}: the header fits and nothing sits under the notch`, async ({ page }) => {
    await page.setViewportSize({ width: sz.width, height: sz.height });
    await page.addInitScript(() => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ voice: 'off', guideSeen: true })));
    for (const route of ['practice', 'practice/copy', 'pocket/round/characters']) {
      await page.goto(`./#/${route}`);
      await safeAreas(page, sz);
      await page.waitForTimeout(200);
      const m = await page.evaluate(() => {
        const head = document.querySelector('header.head') as HTMLElement;
        const vw = document.documentElement.clientWidth;
        const out: string[] = [];
        for (const el of document.querySelectorAll('header a, header button, main h1, main a, main button, main p')) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
          out.push(`${Math.round(r.left)} ${Math.round(vw - r.right)} ${(el as HTMLElement).innerText.replace(/\s+/g, ' ').slice(0, 24) || el.getAttribute('aria-label')}`);
        }
        return { headScroll: head.scrollWidth, headClient: head.clientWidth, pageScroll: document.documentElement.scrollWidth, vw, edges: out };
      });
      expect(m.headScroll, `${route}: the header's contents fit`).toBeLessThanOrEqual(m.headClient);
      expect(m.pageScroll, `${route}: no sideways scrolling`).toBeLessThanOrEqual(m.vw);
      const underNotch = m.edges.filter((e) => {
        const [l, r] = e.split(' ').map(Number);
        return l < sz.left || r < sz.right;
      });
      expect(underNotch, `${route}: left and right gaps (px) of anything closer to the edge than the safe area`).toEqual([]);
    }
  });

  for (const s of KEYBOARD_DRILLS) {
    test(`${sz.name}, ${s.name}: the answer keyboard is in view without scrolling`, async ({ page }) => {
      await page.setViewportSize({ width: sz.width, height: sz.height });
      await page.addInitScript(() => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ voice: 'off', guideSeen: true, level: { koch: 'koch-14', licw: 'licw-bc1-REA' } })));
      await page.goto(`./#/${s.route}`);
      await safeAreas(page, sz);
      await s.start(page);
      const kb = page.getByRole('group', { name: 'Answer keyboard' });
      await expect(kb).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      // Measured from the top of the page: tapping Start may have scrolled it (before the first tap, iOS shows the sound banner).
      await page.evaluate(() => window.scrollTo(0, 0));
      const m = await kb.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), vh: innerHeight, vw: document.documentElement.clientWidth };
      });
      expect(m.top, 'keyboard starts on screen').toBeGreaterThanOrEqual(0);
      expect(m.bottom, 'keyboard ends above the home bar').toBeLessThanOrEqual(m.vh - sz.bottom);
      expect(m.left, 'clear of the notch').toBeGreaterThanOrEqual(sz.left);
      expect(m.right, 'clear of the notch').toBeLessThanOrEqual(m.vw - sz.right);
    });
  }

  test(`${sz.name}: the touch key leaves most of the screen to the drill`, async ({ page }) => {
    await page.setViewportSize({ width: sz.width, height: sz.height });
    await page.addInitScript(() => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ voice: 'off', guideSeen: true, input: 'touch' })));
    await page.goto('./#/practice/live');
    await safeAreas(page, sz);
    const pad = page.getByRole('button', { name: /^Touch key/ });
    await expect(pad).toBeVisible();
    const m = await page.evaluate(() => {
      const dock = document.querySelector('.dock')!.getBoundingClientRect();
      const pad = document.querySelector('.dock .pad')!.getBoundingClientRect();
      return { dockH: dock.height, padH: pad.height, padLeft: pad.left, padRight: pad.right, vh: innerHeight, vw: document.documentElement.clientWidth };
    });
    // The strip over the home bar is no use to the drill either way, so it is left out.
    expect((m.dockH - sz.bottom) / (m.vh - sz.bottom), 'share of the usable height the pad takes').toBeLessThanOrEqual(0.25);
    expect(m.padH, 'still a big target').toBeGreaterThanOrEqual(56);
    expect(m.padLeft).toBeGreaterThanOrEqual(sz.left);
    expect(m.padRight).toBeLessThanOrEqual(m.vw - sz.right);
  });
}

// The header fits on one row at every width, upright and on its side, with the widest input
// name and a notice showing (Alt+Up shows "Receive 21 wpm").
test('the header fits from 600 to 1280 px wide', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ voice: 'off', guideSeen: true, input: 'straight', visualCue: true })));
  await page.goto('./#/practice');
  const bad: string[] = [];
  for (const height of [900, 390]) {
    for (let width = 600; width <= 1280; width += 20) {
      await page.setViewportSize({ width, height });
      await page.keyboard.press('Alt+ArrowUp');
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const m = await page.evaluate(() => {
        const head = document.querySelector('header.head') as HTMLElement;
        return { head: head.scrollWidth - head.clientWidth, page: document.documentElement.scrollWidth - innerWidth };
      });
      if (m.head > 0 || m.page > 0) bad.push(`${width} x ${height}: ${m.head} px too wide`);
    }
  }
  expect(bad).toEqual([]);
});

// The narrowest phones show the whole version and build, not "v0.1.0 · lo…".
test('360 px: the version and build are shown in full', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.addInitScript(() => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ voice: 'off', guideSeen: true })));
  await page.goto('./#/practice');
  const ver = page.locator('header .ver');
  await expect(ver).toBeVisible();
  const m = await ver.evaluate((el) => ({ text: (el as HTMLElement).innerText, scroll: el.scrollWidth, client: el.clientWidth, right: el.getBoundingClientRect().right, next: el.nextElementSibling!.getBoundingClientRect().left }));
  expect(m.text).toMatch(/v\d+\.\d+\.\d+/);
  expect(m.text).toMatch(/local|[0-9a-f]{7}/);
  expect(m.scroll, 'nothing cut off').toBeLessThanOrEqual(m.client);
});

/** How far a tap still lands on the element, measured across its centre (px). */
async function hitArea(page: Page, loc: Locator) {
  await loc.scrollIntoViewIfNeeded();
  return loc.evaluate((el) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hits = (x: number, y: number) => {
      const h = document.elementFromPoint(x, y);
      return !!h && (h === el || el.contains(h));
    };
    // Sub-pixel search for the edge in one direction.
    const reach = (dx: number, dy: number) => {
      let lo = 0;
      let hi = 40;
      if (!hits(cx, cy)) return -cx;
      if (hits(cx + dx * hi, cy + dy * hi)) return hi;
      while (hi - lo > 0.1) {
        const mid = (lo + hi) / 2;
        if (hits(cx + dx * mid, cy + dy * mid)) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    // Hit testing rounds to whole pixels, so the measured reach can be up to 1 px long: take 1 off.
    // The box itself counts in full.
    const w = Math.max(r.width, reach(-1, 0) + reach(1, 0) - 1);
    const h = Math.max(r.height, reach(0, -1) + reach(0, 1) - 1);
    return { w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 };
  });
}

// Tap targets are at least 44 x 44 px, counting any invisible extra hit area.
const TARGETS: { route: string; settings?: Record<string, unknown>; targets: (p: Page) => Locator[] }[] = [
  {
    route: 'practice',
    settings: { guideSeen: false, level: { koch: 'koch-14', licw: 'licw-bc1-REA' } },
    targets: (p) => [
      p.locator('header a.mark'),
      p.locator('header').getByRole('link', { name: 'Settings' }),
      p.locator('header').getByRole('link', { name: 'Guide' }),
      p.locator('.signal-strip a'),
      p.getByRole('button', { name: 'Turn sound on' }),
      p.getByRole('radio', { name: 'Koch' }),
      p.getByRole('button', { name: 'Dismiss' }),
      p.getByRole('button', { name: 'Previous lesson' }),
      p.getByRole('button', { name: 'Next lesson' }),
      p.getByRole('link', { name: 'Character reference' }),
      p.getByRole('checkbox').first(),
      p.getByRole('checkbox').last(),
    ],
  },
  { route: 'practice/copy', targets: (p) => [p.getByRole('link', { name: 'Back' }), p.getByRole('radio', { name: 'Words' })] },
  { route: 'practice/live', settings: { input: 'mic' }, targets: (p) => [p.getByRole('button', { name: 'Use the touch key' })] },
  { route: 'pocket', targets: (p) => [p.getByRole('button', { name: 'Next lesson' })] },
  { route: 'pocket/round/characters', targets: (p) => [p.getByRole('link', { name: 'Back to Pocket' })] },
  { route: 'settings', targets: (p) => [p.getByRole('slider').first(), p.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Light' })] },
];

for (const width of [390, 360]) for (const t of TARGETS) {
  test(`${width} px, ${t.route}: tap targets are at least 44 px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.addInitScript((s) => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ voice: 'off', guideSeen: true, ...s })), t.settings ?? {});
    await page.goto(`./#/${t.route}`);
    await page.waitForTimeout(300);
    const small: string[] = [];
    for (const loc of t.targets(page)) {
      await expect(loc).toBeVisible();
      const a = await hitArea(page, loc);
      if (a.w < 43.95 || a.h < 43.95) small.push(`${await loc.evaluate((e) => (e as HTMLElement).innerText.trim().slice(0, 30) || e.getAttribute('aria-label') || e.tagName)}: ${a.w} x ${a.h}`);
    }
    expect(small).toEqual([]);
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
