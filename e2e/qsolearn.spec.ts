// Learn QSOs: guided lessons, typed and keyed, with mistakes along the way.
import { test, expect, type Page } from '@playwright/test';
import { patternOf, tokenize } from '../src/lib/morse/code';

const YOU = { call: 'K1XYZ', name: 'TOM', qth: 'SALEM', state: 'MA', skcc: '' };

async function open(page: Page, route: string, extra: Record<string, unknown> = {}) {
  await page.addInitScript((x) => {
    localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ voice: 'off', guideSeen: true, licwAsked: true, ...x }));
    // Counts the CW playing now: sources started and not yet ended.
    const w = window as unknown as { __active: number };
    w.__active = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...a: number[]) {
      w.__active++;
      this.addEventListener('ended', () => w.__active--);
      return start.apply(this, a as never);
    };
  }, { you: YOU, ...extra });
  await page.goto(`./#/${route}`);
}

const playing = (page: Page) => page.evaluate(() => (window as unknown as { __active: number }).__active);

const THEM = { call: 'W1AW', name: 'BOB', qth: 'NEWINGTON', state: 'CT', skcc: '1234', rig: 'K3', ant: 'DIPOLE', pwr: '100', wx: 'SUNNY', age: '50', job: 'PILOT', rst: '579', serial: 42, pitchOffset: 0, verbosity: 0.5, repeats: 2, pace: 0, abbrev: 1 };

/** A lesson already under way at this step, with W1AW, as after going to Setup and back or a reload. */
async function underway(page: Page, lesson: string, idx: number) {
  await page.addInitScript((r) => sessionStorage.setItem('beepbeep.qsoLearn.run', JSON.stringify({ ...r, at: Date.now() })), { lesson, them: THEM, idx, firstTry: 0 });
}

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

/** Keys text on the Space-bar straight key at 15 wpm, timed inside the page. */
async function key(page: Page, text: string) {
  const dit = 1200 / 15;
  const evs: [number, boolean][] = [];
  let t = 200;
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
  await page.evaluate(async (evs) => {
    const t0 = performance.now();
    for (const [at, down] of evs) {
      const wait = t0 + at - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      // Each event carries the time it was meant for, as a real one does, so a busy test machine can't stretch the gaps.
      const ev = new KeyboardEvent(down ? 'keydown' : 'keyup', { code: 'Space', key: ' ', bubbles: true });
      Object.defineProperty(ev, 'timeStamp', { value: t0 + at });
      document.body.dispatchEvent(ev);
    }
  }, evs);
}

// Keyed tests read the keying against the browser's audio clock, which can
// stall on a very busy test machine and drop a dit or split a word. Each such
// failure misreads differently; a retry tells it from a real fault.
test.describe.configure({ retries: 2 });

test('lessons wait for your station details', async ({ page }) => {
  await open(page, 'qso/learn', { you: { call: '', name: '', qth: '', state: '', skcc: '' } });
  await expect(page.getByRole('heading', { name: 'Learn QSOs' })).toBeVisible();
  await expect(page.getByText(/Fill in your call, name and QTH/)).toBeVisible();
  await page.getByLabel('Call').fill('k1xyz');
  await page.getByLabel('Name').fill('tom');
  await page.getByLabel('QTH, where you are').fill('singapore');
  await expect(page.getByText(/Fill in your call, name and QTH/)).toHaveCount(0);
  await page.getByRole('link', { name: /^1\s*Answer a CQ/ }).click();
  await expect(page).toHaveURL(/#\/qso\/learn\/answer-cq$/);
});

test('Answer a CQ, typed, with mistakes and second tries', async ({ page }, info) => {
  await open(page, 'qso/learn/answer-cq', { qsoInput: 'type', qsoHelp: 'text' });
  await page.getByRole('button', { name: /Start/ }).click();
  // Listen: copy their call. A wrong guess first.
  await expect(page.getByText('A station sending CQ is asking for a contact')).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByLabel('Their call').fill('K2ZZZ');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('Not quite. Listen again.')).toBeVisible();
  await page.getByRole('button', { name: 'Show what they sent' }).click();
  const sent = (await page.locator('.sent .text').innerText()).replace(/\s+/g, ' ');
  const call = /DE (\S+)/.exec(sent)![1];
  await page.getByLabel('Their call').fill(call);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('Right', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  // Send: forget the K, then get it right.
  await expect(page.locator('.model .text')).toHaveText(new RegExp(`${call}\\s*DE\\s*K1XYZ\\s*K1XYZ\\s*K`));
  await page.getByLabel('Type what you would send').fill(`${call} de k1xyz k1xyz`);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('Not yet.')).toBeVisible();
  await expect(page.getByText("End with K. It means 'over to you'.")).toBeVisible();
  await page.screenshot({ path: `test-results/screens/${info.project.name}-qso-learn-feedback.png`, fullPage: true });
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByLabel('Type what you would send').fill(`${call} de k1xyz k1xyz k`);
  await page.getByLabel('Type what you would send').press('Enter');
  await expect(page.getByText('Right.')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('You have a contact', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('You finished this lesson.')).toBeVisible();
  // The note at the end is not checked, so it doesn't count.
  await expect(page.getByText('Of the 2 steps where you copied or sent something, 0 were right the first time.')).toBeVisible();
  // Saved under the lesson's own name, so Today can tell a whole QSO from this one.
  await expect.poll(async () => (await all(page, 'sessions')).map((s) => s.mode)).toEqual(['qso-learn:answer-cq']);
  // The next Learn QSOs lesson, by name.
  await expect(page.getByRole('link', { name: 'Next: Copy their first over' })).toBeVisible();
  // Done once, on the list.
  await page.getByRole('link', { name: 'All lessons' }).click();
  await expect(page.getByText('Done once')).toBeVisible();
});

test('leaving a lesson stops its sound', async ({ page }) => {
  await open(page, 'qso/learn/answer-cq', { qsoInput: 'type', qsoHelp: 'text' });
  await page.getByRole('button', { name: /Start/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => playing(page)).toBeGreaterThan(0);
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Learn QSOs' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(await playing(page)).toBe(0);
});

test('Play, Slower and Play again play one at a time', async ({ page }) => {
  await open(page, 'qso/learn/answer-cq', { qsoInput: 'type', qsoHelp: 'text' });
  await page.getByRole('button', { name: /Start/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Slower' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Play again' }).click();
  await page.waitForTimeout(400);
  expect(await playing(page)).toBe(1);
});

test('typing your part needs no touch key over the Check button', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'touch screen');
  await open(page, 'qso/learn/answer-cq', { qsoInput: 'type', qsoHelp: 'text', input: 'touch' });
  await toTheAnswer(page);
  await expect(page.locator('.pad')).toHaveCount(0);
  const check = page.getByRole('button', { name: 'Check' });
  await check.scrollIntoViewIfNeeded();
  const covered = await check.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && !el.contains(top);
  });
  expect(covered).toBe(false);
});

test('after a reload into a keyed step, the first key press starts the sound and keying works', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'keyboard straight key');
  await underway(page, 'answer-cq', 1);
  await open(page, 'qso/learn/answer-cq', { qsoInput: 'key', qsoHelp: 'text', input: 'straight', sendWpm: 15, overTimeout: 2 });
  await expect(page.getByText('Step 2 of 3 · Answer it')).toBeVisible();
  // A real key press (not a script's), as a browser needs before it plays sound: a dit.
  await page.keyboard.down('Space');
  await page.waitForTimeout(80);
  await page.keyboard.up('Space');
  await page.waitForTimeout(700);
  await key(page, 'W1AW DE K1XYZ K1XYZ K');
  await expect(page.getByText('Right.')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.keyed .text')).toContainText(/W1AW\s*DE\s*K1XYZ/);
});

test('POTA: the reply without the leading BK is right', async ({ page }) => {
  await underway(page, 'pota', 3);
  await open(page, 'qso/learn/pota', { qsoInput: 'type', qsoHelp: 'text' });
  await expect(page.getByText('Step 4 of 5 · Your report and region')).toBeVisible();
  await page.getByLabel('Type what you would send').fill('TU 5NN MA MA BK');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('Right.')).toBeVisible();
});

test('LICW strict mode: prosigns are not drawn as dits and dahs', async ({ page }) => {
  await underway(page, 'sign-off', 0);
  await open(page, 'qso/learn/sign-off', { qsoInput: 'type', qsoHelp: 'text', track: 'licw', licwStrict: true });
  await expect(page.getByText('SK, sent as one character, says the contact is over.', { exact: false })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('· · · – · –');
});

test('your part keyed on the straight key is decoded and checked', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'keyboard straight key');
  await open(page, 'qso/learn/answer-cq', { qsoInput: 'key', qsoHelp: 'text', input: 'straight', sendWpm: 15, overTimeout: 2 });
  await page.getByRole('button', { name: /Start/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Check' }).click();
  await page.getByRole('button', { name: 'Show what they sent' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  const model = (await page.locator('.model .text').innerText()).replace(/\s+/g, ' ').trim();
  await key(page, model);
  // Checked once you stop for 2 s (the over timeout).
  await expect(page.getByText('Right.')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.keyed .text')).toHaveText(new RegExp(model.replace(/ /g, '\\s*')));
});

/** Keys text on the touch pad at 15 wpm, timed inside the page. */
async function tap(page: Page, text: string) {
  const dit = 1200 / 15;
  const evs: [number, boolean][] = [];
  let t = 200;
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
  await page.evaluate(async (evs) => {
    const el = document.querySelector('.pad')!;
    const t0 = performance.now();
    const ev = (type: string, at: number) => {
      const e = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch', isPrimary: true });
      Object.defineProperty(e, 'timeStamp', { value: t0 + at });
      return e;
    };
    for (const [at, down] of evs) {
      const wait = t0 + at - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      el.dispatchEvent(ev(down ? 'pointerdown' : 'pointerup', at));
    }
  }, evs);
}

async function toTheAnswer(page: Page) {
  await page.getByRole('button', { name: /Start/ }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Check' }).click();
  await page.getByRole('button', { name: 'Show what they sent' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Step 2 of 3 · Answer it')).toBeVisible();
}

test('microphone not set up: switch to the touch key on the step and carry on', async ({ page }) => {
  await open(page, 'qso/learn/answer-cq', { qsoInput: 'key', qsoHelp: 'text', input: 'mic', sendWpm: 15, overTimeout: 2 });
  await toTheAnswer(page);
  await expect(page.locator('.pad')).toHaveCount(0);
  await expect(page.getByText(/key with the touch key instead/)).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Key with' }).getByRole('radio', { name: 'Touch key' }).click();
  await expect(page.locator('.pad')).toBeVisible();
  const model = (await page.locator('.model .text').innerText()).replace(/\s+/g, ' ').trim();
  await tap(page, model);
  await expect(page.getByText('Right.')).toBeVisible({ timeout: 15_000 });
});

test('go to Setup mid-lesson and come back to the same step', async ({ page }) => {
  await open(page, 'qso/learn/answer-cq', { qsoInput: 'key', qsoHelp: 'text', input: 'mic', sendWpm: 15, overTimeout: 2 });
  await toTheAnswer(page);
  const model = (await page.locator('.model .text').innerText()).replace(/\s+/g, ' ').trim();
  await page.getByRole('link', { name: 'Setup' }).first().click();
  await expect(page.getByRole('heading', { name: 'Input setup' })).toBeVisible();
  await page.getByRole('radio', { name: 'Touch key' }).first().click();
  await page.getByRole('link', { name: 'Back to the lesson' }).click();
  // Same step, same station.
  await expect(page.getByText('Step 2 of 3 · Answer it')).toBeVisible();
  await expect(page.locator('.model .text')).toHaveText(new RegExp(model.replace(/ /g, '\\s*')));
  await expect(page.locator('.pad')).toBeVisible();
  await tap(page, model);
  await expect(page.getByText('Right.')).toBeVisible({ timeout: 15_000 });
});

test('the same slip twice gives feedback, not a frozen page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, 'qso/learn/answer-cq', { qsoInput: 'type', qsoHelp: 'text' });
  await toTheAnswer(page);
  const call = (await page.locator('.model .text').innerText()).replace(/\s+/g, ' ').trim().split(' ')[0];
  await page.getByLabel('Type what you would send').fill(`${call} DE K1XYA K1XYA K`);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('Almost.')).toBeVisible();
  await expect(page.getByText('Your call: you sent K1XYA; it is K1XYZ.')).toHaveCount(1);
  expect(errors).toEqual([]);
});
