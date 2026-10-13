// Radio: the fake microphone plays PARIS at 20 wpm, 650 Hz, over and over, as
// a radio's audio would. The screen decodes it, follows it in large text, and
// lets the microphone go on Stop or soon after you leave.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { BASE, collectErrors, instrument, liveTracks, played, settings, tones, wake } from './probe';

const box = (page: Page) => page.getByRole('region', { name: /^Text from the signal at \d+ Hz$/ });

/** Opens Radio, presses Start and waits for PARIS in the followed signal's text. */
async function listen(page: Page, extra: Record<string, unknown> = {}) {
  await instrument(page);
  await settings(page, { ...BASE, input: 'mic', ...extra });
  await page.goto('./#/radio');
  await expect(page.getByText("Connect your radio's audio to the microphone")).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(box(page)).toContainText('PARIS PARIS', { timeout: 20_000 });
}

test('decodes PARIS and follows it at its pitch and speed', async ({ page }) => {
  const errors = collectErrors(page);
  await listen(page);
  const line = page.locator('.following');
  await expect(line).toContainText(/\d+ Hz/);
  const hz = Number((await line.innerText()).match(/(\d+) Hz/)![1]);
  expect(Math.abs(hz - 650), `pitch ${hz} Hz`).toBeLessThan(20);
  await expect(line).toContainText(/\b(19|20|21) wpm/, { timeout: 10_000 });
  // One station: nothing else is listed.
  await expect(page.getByText('No other signals have been heard yet.')).toBeVisible();
  // The signal bar shows the microphone listening, with no pitch (there may be many signals) and no speed of yours.
  const bar = page.getByRole('link', { name: /Open input setup/ }).first();
  await expect(bar).toContainText('Listening');
  await expect(bar).not.toContainText(/Hz|wpm/);
  // The screen stays on while it listens.
  expect(await wake(page)).toContain('request@#/radio');
  expect(errors).toEqual([]);
});

test('Stop lets the microphone go at once and keeps the text', async ({ page }) => {
  await listen(page);
  expect(await liveTracks(page)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect.poll(() => liveTracks(page), { timeout: 3000 }).toBe(0);
  await expect(page.getByText('Mic off').first()).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'BeepBeep has stopped listening. Press Start to listen again.' })).toBeVisible();
  await expect(box(page)).toContainText('PARIS');
  expect(await wake(page)).toContain('release@#/radio');
  // Start goes on from there.
  await page.getByRole('button', { name: 'Start' }).click();
  await expect.poll(() => liveTracks(page)).toBeGreaterThan(0);
});

test('leaving the screen stops listening and lets the microphone go about 10 seconds later', async ({ page }) => {
  test.setTimeout(60_000);
  await listen(page);
  await page.getByRole('link', { name: 'Progress' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeVisible();
  await page.waitForTimeout(3000);
  expect(await liveTracks(page)).toBeGreaterThan(0);
  await expect.poll(() => liveTracks(page), { timeout: 15_000 }).toBe(0);
  expect((await wake(page)).at(-1)).toMatch(/^release@/);
  // Back on Radio, the text is still there and it waits for Start.
  await page.getByRole('link', { name: 'Radio' }).first().click();
  await expect(box(page)).toContainText('PARIS');
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
});

for (const input of ['straight', 'touch'] as const) {
  test(`Space keys nothing while Radio listens (input: ${input})`, async ({ page }) => {
    await listen(page, { input });
    // No touch key pad on this screen.
    await expect(page.locator('.pad')).toHaveCount(0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 4; i++) {
      await page.keyboard.down(' ');
      await page.waitForTimeout(150);
      await page.keyboard.up(' ');
      await page.waitForTimeout(150);
    }
    expect((await tones(page)).filter((t) => t.hash === '#/radio')).toEqual([]);
    expect((await played(page)).filter((p) => p.hash === '#/radio')).toEqual([]);
    // Still listening, and still on Radio.
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    expect(page.url()).toMatch(/#\/radio$/);
  });
}

test('Copy text copies the followed signal, and Save writes every signal with times', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await listen(page);
  await page.getByRole('button', { name: 'Copy text' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Copied the text of the signal at \d+ Hz\.$/ })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^PARIS PARIS/);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^beepbeep-radio-\d{4}-\d\d-\d\d-\d{4}\.txt$/);
  const file = readFileSync((await download.path())!, 'utf8');
  const lines = file.split('\n');
  expect(lines[0]).toBe('BeepBeep Radio');
  expect(lines[1]).toMatch(/^Saved on \d+ \w+ \d{4} at \d\d:\d\d\. Times are this device's local time\.$/);
  expect(lines[3]).toMatch(/^Signal at 6\d\d Hz, (\d+ wpm|speed not measured), first heard at \d\d:\d\d$/);
  expect(lines[4]).toMatch(/^\d\d:\d\d {2}PARIS PARIS/);
  await expect(page.getByRole('status').filter({ hasText: `as ${download.suggestedFilename()} in your downloads` })).toBeVisible();
});

test('Clear with little text clears at once and goes on listening', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await listen(page);
  await page.getByRole('button', { name: 'Clear' }).click();
  expect(dialogs).toEqual([]);
  await expect(page.getByRole('status').filter({ hasText: 'The text of every signal is cleared.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(box(page)).toContainText('PARIS', { timeout: 20_000 });
});

test('the microphone blocked: a plain sentence, and Start works again', async ({ page }) => {
  await instrument(page, { gumFail: 'NotAllowedError' });
  await settings(page, { ...BASE, input: 'mic' });
  await page.goto('./#/radio');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('status').filter({ hasText: "The microphone is blocked. Allow it in the browser's site settings, then try again." })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start' })).toBeEnabled();
  await expect(page.getByText("Connect your radio's audio to the microphone")).toBeVisible();
});

test('at 360 px: no sideways scrolling, five tabs that fit, and nothing under the tab bar', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await listen(page);
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.tabbar')!.getBoundingClientRect();
    const tabs = [...document.querySelectorAll('.tabbar a')].map((a) => ({ text: (a as HTMLElement).innerText, w: a.getBoundingClientRect().width, cut: a.scrollWidth > a.clientWidth }));
    return { scroll: document.documentElement.scrollWidth, barTop: bar.top, tabs };
  });
  expect(m.scroll).toBeLessThanOrEqual(360);
  expect(m.tabs.map((t) => t.text)).toEqual(['Practice', 'Pocket', 'QSO', 'Progress', 'Radio']);
  for (const t of m.tabs) {
    expect(t.cut, `${t.text} fits`).toBe(false);
    expect(t.w, `${t.text} is wide enough to tap`).toBeGreaterThanOrEqual(44);
  }
  // The newest line is at the bottom of the text box: the box, and the buttons under it, end above the tab bar
  // without scrolling the page.
  const fit = await page.evaluate(() => ({
    box: document.querySelector('main .box')!.getBoundingClientRect().bottom,
    tools: document.querySelector('main .tools')!.getBoundingClientRect().bottom,
    barTop: document.querySelector('.tabbar')!.getBoundingClientRect().top,
  }));
  expect(fit.box, 'text box above the tab bar').toBeLessThanOrEqual(fit.barTop);
  expect(fit.tools, 'Copy text, Save and Clear above the tab bar').toBeLessThanOrEqual(fit.barTop);
  // Scrolled to the end, the last of the screen sits above the tab bar.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const end = await page.evaluate(() => {
    const items = [...document.querySelectorAll('main section.radio > *, main .side > *')].filter((e) => e.getBoundingClientRect().height > 0);
    return { bottom: Math.max(...items.map((e) => e.getBoundingClientRect().bottom)), barTop: document.querySelector('.tabbar')!.getBoundingClientRect().top };
  });
  expect(end.bottom).toBeLessThanOrEqual(end.barTop);
  // The buttons are big enough to tap.
  for (const name of ['Stop', 'Copy text', 'Save', 'Clear']) {
    const b = (await page.getByRole('button', { name }).boundingBox())!;
    expect(b.height, name).toBeGreaterThanOrEqual(44);
    expect(b.width, name).toBeGreaterThanOrEqual(44);
  }
});

test('on a wide screen the text box and the buttons under it fit in the window', async ({ page }) => {
  await listen(page);
  const m = await page.evaluate(() => ({
    box: document.querySelector('main .box')!.getBoundingClientRect().bottom,
    tools: document.querySelector('main .tools')!.getBoundingClientRect().bottom,
    vh: innerHeight,
  }));
  expect(m.tools, 'buttons in the window').toBeLessThanOrEqual(m.vh);
  expect(m.box, 'the box uses most of the height').toBeGreaterThan(m.vh - 160);
});

test('before Start: the instructions are plain text, with no reading box', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, input: 'mic' });
  for (const size of [
    { width: 360, height: 740 },
    { width: 1280, height: 860 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('./#/radio');
    const intro = page.getByText("Connect your radio's audio to the microphone");
    await expect(intro).toBeVisible();
    await expect(page.locator('main .box')).toHaveCount(0);
    expect(await intro.evaluate((p) => getComputedStyle(p).fontSize)).toBe('15px');
    // Nothing is cut off: every paragraph shows in full.
    const cut = await page.evaluate(() => [...document.querySelectorAll('main .intro p')].filter((p) => p.scrollHeight > p.clientHeight + 1).length);
    expect(cut).toBe(0);
  }
});

test('scrolled up to read, the text stays put until Show newest', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await listen(page);
  // A short box, so a few words of PARIS fill it.
  await page.addStyleTag({ content: 'main .box { height: 100px !important; }' });
  // Enough lines to scroll: wait until the box overflows.
  await expect.poll(() => box(page).evaluate((b) => b.scrollHeight > b.clientHeight + 40), { timeout: 30_000 }).toBe(true);
  expect(await box(page).evaluate((b) => b.scrollHeight - b.scrollTop - b.clientHeight)).toBeLessThan(24);
  await box(page).evaluate((b) => b.scrollTo(0, 0));
  const newest = page.getByRole('button', { name: 'Show newest' });
  await expect(newest).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await box(page).evaluate((b) => b.scrollTop)).toBe(0);
  await newest.click();
  await expect(newest).toBeHidden();
  expect(await box(page).evaluate((b) => b.scrollHeight - b.scrollTop - b.clientHeight)).toBeLessThan(24);
});

for (const theme of ['dark', 'light', 'paper'] as const) {
  test(`axe passes while listening, ${theme}`, async ({ page }) => {
    await listen(page, { theme });
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
  });
}

for (const theme of ['dark', 'light'] as const) {
  for (const size of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 860 },
  ]) {
    test(`screenshot: ${size.name}, ${theme}, listening`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await listen(page, { theme });
      await page.waitForTimeout(15_000);
      await page.screenshot({ path: `test-results/screens/radio-${size.name}-${theme}-paris.png` });
    });
  }
}
