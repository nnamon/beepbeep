// The QSO simulator: when your turn ends, typing while the station sends,
// copying its last transmission, the visual cue, the phone layout and
// leaving mid-contact.
import { test, expect, type Page } from '@playwright/test';
import { patternOf, tokenize } from '../src/lib/morse/code';

// Keyed tests read the keying against the browser's audio clock, which can
// stall when the test machine is very busy and drop a dit (K read as M).
// Each failure that way is a different misreading; a retry tells them apart
// from a real fault, which fails every time.
test.describe.configure({ retries: 2 });

const YOU = { call: '9V1NE', name: 'AMON', qth: 'SINGAPORE', state: '', skcc: '' };
const WPM = 15;
const desktop = () => test.info().project.name === 'desktop';

/** Opens the QSO screen with these settings, counting the audio that is playing. */
async function open(page: Page, extra: Record<string, unknown> = {}) {
  await page.addInitScript((x) => {
    localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ voice: 'off', guideSeen: true, licwAsked: true, ...x }));
    const w = window as unknown as { __active: number };
    w.__active = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...a: number[]) {
      w.__active++;
      this.addEventListener('ended', () => w.__active--);
      return start.apply(this, a as never);
    };
  }, { you: YOU, input: 'straight', sendWpm: WPM, ...extra });
  await page.goto('./#/qso');
}

async function setup(page: Page, format: string, opener: 'The station' | 'You', speed = 30) {
  await page.locator('.formats label', { has: page.locator('.name', { hasText: new RegExp(`^${format}$`) }) }).click();
  await page.getByRole('radiogroup', { name: 'Who calls CQ' }).getByRole('radio', { name: opener }).click();
  await page.getByLabel(/^Station (character )?speed$/).fill(String(speed));
  await page.getByLabel(/^Station (overall speed|spacing)$/).fill(String(speed));
}

/**
 * Keys text on the Space-bar straight key, each event carrying the time it was
 * meant for. Returns the page time of the last key release.
 */
async function key(page: Page, text: string, wpm = WPM): Promise<number> {
  const dit = 1200 / wpm;
  const evs: [number, boolean][] = [];
  let t = 100;
  for (const tok of tokenize(text)) {
    if (tok === ' ') {
      t += dit * 4;
      continue;
    }
    for (const el of patternOf(tok)!) {
      evs.push([t, true]);
      t += el === '.' ? dit : dit * 3;
      evs.push([t, false]);
      t += dit;
    }
    t += dit * 2;
  }
  return page.evaluate(async (evs) => {
    const t0 = performance.now();
    for (const [at, down] of evs) {
      const wait = t0 + at - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const ev = new KeyboardEvent(down ? 'keydown' : 'keyup', { code: 'Space', key: ' ', bubbles: true });
      Object.defineProperty(ev, 'timeStamp', { value: t0 + at });
      document.body.dispatchEvent(ev);
    }
    return t0 + evs[evs.length - 1][0];
  }, evs);
}

const status = (page: Page) => page.locator('.run .status');
const playing = (page: Page) => page.evaluate(() => (window as unknown as { __active: number }).__active);
const yours = async (page: Page) => (await page.locator('.log .line.mine').allInnerTexts()).map((l) => l.replace(/^You\s*/, '').replace(/\s+/g, ' ').trim());
const theirs = async (page: Page) => (await page.locator('.log .line:not(.mine)').allInnerTexts()).map((l) => l.replace(/\s+/g, ' ').trim());

/** Records each change of the status, with the page's own clock, so a busy test machine can't blur the timing. */
async function watchStatus(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector('.run .status')!;
    const w = window as unknown as { __status: [number, string][] };
    w.__status = [];
    new MutationObserver(() => w.__status.push([performance.now(), el.textContent ?? ''])).observe(el, { subtree: true, childList: true, characterData: true });
  });
}

/** How long after `t` your turn ended (the station started sending), ms, or null if it hasn't. */
const endedAfter = (page: Page, t: number) =>
  page.evaluate((t) => {
    const hit = (window as unknown as { __status: [number, string][] }).__status.find(([at, s]) => at > t && /Station sending|QSO ended/.test(s));
    return hit ? Math.round(hit[0] - t) : null;
  }, t);

function all(page: Page, store: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (store) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('beepbeep', 1);
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const q = r.result.transaction(store).objectStore(store).getAll();
          q.onsuccess = () => res(q.result);
          q.onerror = () => rej(q.error);
        };
      }),
    store,
  );
}

test('your turn runs to the end: HW?, 73 and BK in the middle do not end it', async ({ page }) => {
  test.skip(!desktop(), 'keyboard straight key');
  test.setTimeout(120_000);
  await open(page, { overTimeout: 6 });
  await setup(page, 'Ragchew', 'You');
  await page.getByRole('button', { name: 'Start QSO' }).click();
  await expect(status(page)).toHaveText(/Your turn/);
  await watchStatus(page);
  const last = await key(page, 'CQ CQ HW? 73 BK DE 9V1NE K');
  // It ends by itself a moment after K, well before 6 s of silence.
  await expect.poll(() => endedAfter(page, last), { timeout: 30_000 }).not.toBeNull();
  expect(await endedAfter(page, last)).toBeLessThan(4000);
  await expect.poll(async () => (await theirs(page)).length, { timeout: 60_000 }).toBe(1);
  expect(await yours(page)).toEqual(['CQ CQ HW? 73 BK DE 9V1NE K']);
  // Screen readers hear the change of turn.
  await expect(status(page)).toHaveAttribute('aria-live', 'polite');
});

test('a contest exchange needs no K: your call, then a pause, ends your turn', async ({ page }) => {
  test.skip(!desktop(), 'keyboard straight key');
  test.setTimeout(120_000);
  await open(page, { overTimeout: 6 });
  await setup(page, 'Contest', 'The station');
  await page.getByRole('button', { name: 'Start QSO' }).click();
  await expect(status(page)).toHaveText(/Your turn/, { timeout: 30_000 });
  await watchStatus(page);
  const last = await key(page, '9V1NE');
  await expect.poll(() => endedAfter(page, last), { timeout: 30_000 }).not.toBeNull();
  expect(await endedAfter(page, last)).toBeLessThan(4500);
});

test('typing in a copy box while the station sends does not cut it off', async ({ page }) => {
  test.skip(!desktop(), 'desktop keyboard');
  test.setTimeout(120_000);
  await open(page);
  // A slow station: its CQ lasts long enough to type into the boxes.
  await setup(page, 'Ragchew', 'The station', 10);
  await page.getByRole('button', { name: 'Start QSO' }).click();
  await expect(status(page)).toHaveText(/Station sending/);
  await page.getByLabel('QTH').click();
  await page.keyboard.type('NEW YORK, X Z . [ ]', { delay: 40 });
  await page.waitForTimeout(500);
  await expect(status(page)).toHaveText(/Station sending/);
  expect(await page.evaluate(() => (window as unknown as { __active: number }).__active)).toBeGreaterThan(0);
  await expect(page.getByLabel('QTH')).toHaveValue('NEW YORK, X Z . [ ]');
});

test('what the station sends last can still be copied, and is scored; the QSO is logged and counted', async ({ page }) => {
  test.skip(!desktop(), 'keyboard straight key');
  test.setTimeout(150_000);
  await open(page, { overTimeout: 3 });
  await setup(page, 'Contest', 'You');
  await page.getByRole('button', { name: 'Start QSO' }).click();
  await expect(status(page)).toHaveText(/Your turn/);
  await key(page, 'CQ TEST 9V1NE');
  await page.keyboard.press('Enter');
  // The station answers with its call.
  await expect.poll(async () => (await theirs(page)).length, { timeout: 60_000 }).toBe(1);
  const call = (await page.locator('.log .line:not(.mine) .who').last().innerText()).trim();
  await expect(status(page)).toHaveText(/Your turn/);
  await key(page, `${call} 5NN 001`);
  await page.keyboard.press('Enter');
  // Their last transmission carries the serial number: TU 5NN 123.
  await expect.poll(async () => `${await status(page).innerText()} | ${(await page.locator('.log').innerText()).replace(/\s+/g, ' ')}`, { timeout: 60_000 }).toMatch(/^QSO ended/);
  const serial = /5NN (\d+)/.exec((await theirs(page)).at(-1)!)![1];
  const box = page.getByLabel(/^Serial/);
  await expect(box).toBeEditable();
  await box.fill(serial);
  await page.getByRole('button', { name: 'Score' }).click();
  await expect(page.locator('table.res caption')).toContainText('100%');
  await expect.poll(async () => (await all(page, 'qsos')).length).toBe(1);
  const [logged] = await all(page, 'qsos');
  expect(logged).toMatchObject({ format: 'contest', call, rstRcvd: '599', rstSent: '599' });
  await expect.poll(async () => (await all(page, 'sessions')).map((s) => s.mode)).toContain('qso');
});

test('the copy boxes say Region, not State', async ({ page }) => {
  test.skip(!desktop(), 'one screen size is enough');
  await open(page);
  await setup(page, 'POTA', 'The station');
  await page.getByRole('button', { name: 'Start QSO' }).click();
  await expect(page.locator('.copy').getByText('Region', { exact: true })).toBeVisible();
  await expect(page.getByText('State', { exact: true })).toHaveCount(0);
});

test("the visual cue lights with the station's keying", async ({ page }) => {
  test.skip(!desktop(), 'one screen size is enough');
  await open(page, { visualCue: true });
  await setup(page, 'Ragchew', 'The station', 12);
  await page.getByRole('button', { name: 'Start QSO' }).click();
  await expect(status(page)).toHaveText(/Station sending/);
  await page.evaluate(() => {
    const cue = document.querySelector('.cue')!;
    const w = window as unknown as { __lit: boolean };
    w.__lit = cue.classList.contains('on');
    new MutationObserver(() => (w.__lit ||= cue.classList.contains('on'))).observe(cue, { attributes: true });
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __lit: boolean }).__lit), { timeout: 10_000 }).toBe(true);
});

test('leaving mid-QSO and coming back: it waits for you, and Carry on goes on from your turn', async ({ page }) => {
  test.skip(!desktop(), 'keyboard straight key');
  test.setTimeout(120_000);
  await open(page, { overTimeout: 3 });
  await setup(page, 'Ragchew', 'You');
  await page.getByRole('button', { name: 'Start QSO' }).click();
  await expect(status(page)).toHaveText(/Your turn/);
  await key(page, 'CQ CQ DE 9V1NE 9V1NE K');
  await expect.poll(async () => (await theirs(page)).length, { timeout: 60_000 }).toBe(1);
  await expect(status(page)).toHaveText(/Your turn/);
  const before = await theirs(page);
  await page.getByRole('link', { name: 'Progress' }).first().click();
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __active: number }).__active)).toBe(0);
  await page.getByRole('link', { name: 'QSO', exact: true }).first().click();
  await expect(status(page)).toHaveText(/Paused/);
  expect(await theirs(page)).toEqual(before);
  await page.getByRole('button', { name: 'Carry on' }).click();
  await expect(status(page)).toHaveText(/Your turn/);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(status(page)).toHaveText(/QSO ended/);
});

test('leaving while the station sends: Carry on plays its transmission again, then it is your turn', async ({ page }) => {
  test.skip(!desktop(), 'one screen size is enough');
  test.setTimeout(120_000);
  await open(page);
  await setup(page, 'Ragchew', 'The station', 20);
  await page.getByRole('button', { name: 'Start QSO' }).click();
  await expect(status(page)).toHaveText(/Station sending/);
  await page.getByRole('link', { name: 'Progress' }).first().click();
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(await playing(page)).toBe(0);
  await page.getByRole('link', { name: 'QSO', exact: true }).first().click();
  await expect(status(page)).toHaveText(/Paused/);
  await expect(page.getByText('after their last transmission plays again')).toBeVisible();
  await page.getByRole('button', { name: 'Carry on' }).click();
  await expect(status(page)).toHaveText(/Station sending/);
  expect(await playing(page)).toBeGreaterThan(0);
  await expect(status(page)).toHaveText(/Your turn/, { timeout: 60_000 });
  expect((await theirs(page)).length).toBe(1);
  expect((await theirs(page))[0]).toMatch(/CQ CQ CQ DE/);
});

test('on a phone with a notch and a home bar, your turn and its buttons show above the touch key', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'phone layout');
  test.setTimeout(90_000);
  await open(page, { input: 'touch' });
  await setup(page, 'Ragchew', 'You');
  await page.addStyleTag({ content: ':root { --safe-top: 47px !important; --safe-bottom: 34px !important; }' });
  // Start QSO is at the bottom of the setup page: the QSO opens with your turn in view, without scrolling.
  await page.getByRole('button', { name: 'Start QSO' }).click();
  await expect(status(page)).toHaveText(/Your turn/);
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const bottom = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().bottom ?? Infinity;
    const end = [...document.querySelectorAll('.run button')].find((b) => /End (my turn|over)/.test(b.textContent ?? ''));
    return {
      title: document.querySelector('.run h1')!.getBoundingClientRect().top,
      pad: document.querySelector('.dock')!.getBoundingClientRect().top,
      status: bottom('.run .status'),
      over: bottom('.run .over'),
      end: end?.getBoundingClientRect().bottom ?? Infinity,
    };
  });
  await page.screenshot({ path: 'test-results/screens/qso-phone-safe-area.png' });
  expect(m.title, 'the top of the QSO is on screen').toBeGreaterThanOrEqual(0);
  expect(m.status, 'status').toBeLessThanOrEqual(m.pad);
  expect(m.end, 'End my turn').toBeLessThanOrEqual(m.pad);
  expect(m.over, 'what you are sending').toBeLessThanOrEqual(m.pad);
});
