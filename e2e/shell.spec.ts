// The app around the drills: scroll position on Back, speed keys, Settings'
// data buttons, Setup with a blocked microphone, Progress charts, and picking
// an LICW exercise up where you left it.
import { test, expect, type Page } from '@playwright/test';
import { BASE, instrument, played, settings } from './probe';
import { seed } from './seed';

test.skip(({ browserName }) => browserName !== 'chromium');

function kv(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (key) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('beepbeep', 1);
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const q = r.result.transaction('kv').objectStore('kv').get(key);
          q.onsuccess = () => res(q.result?.value);
        };
      }),
    key,
  );
}

function count(page: Page, store: string): Promise<number> {
  return page.evaluate(
    (store) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('beepbeep', 1);
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const q = r.result.transaction(store).objectStore(store).count();
          q.onsuccess = () => res(q.result);
        };
      }),
    store,
  );
}

test('Back from an exercise returns to the same place on Practice', async ({ page }) => {
  await settings(page, { ...BASE, track: 'licw', level: { koch: 'koch-1', licw: 'licw-bc1-REA' } });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('./#/practice');
  const link = page.getByRole('link', { name: /Speed Racing words, rate 2/ });
  await link.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  expect(before).toBeGreaterThan(500);
  await link.click();
  await expect(page).toHaveURL(/racer-words-2/);
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/#\/practice$/);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before - 50);
  // A drill opened fresh starts at the top.
  await page.getByRole('link', { name: /Speed Racing words, rate 2/ }).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test('Alt+Up on the LICW track with lesson speeds on changes nothing and says why', async ({ page }) => {
  await settings(page, { ...BASE, track: 'licw', charWpm: 20, level: { koch: 'koch-1', licw: 'licw-bc1-REA' } });
  await page.goto('./#/practice');
  await page.locator('h1').click();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.getByText('This lesson sets the speed.').first()).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('beepbeep.settings.v1')!).charWpm)).toBe(20);
});

test('Delete progress says what it deletes and keeps your texts', async ({ page }) => {
  await settings(page, BASE);
  await page.goto('./#/progress');
  await seed(page);
  await page.evaluate(
    () =>
      new Promise<void>((res) => {
        const r = indexedDB.open('beepbeep', 1);
        r.onsuccess = () => {
          const tx = r.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put({ key: 'texts', value: [{ id: 't1', name: 'Story', text: 'THE RIG IS ON', at: 1 }] });
          tx.oncomplete = () => res();
        };
      }),
  );
  await page.goto('./#/settings');
  let message = '';
  page.once('dialog', (d) => {
    message = d.message();
    void d.accept();
  });
  await page.getByRole('button', { name: 'Delete progress' }).click();
  await expect(page.getByText('Your progress was deleted.')).toBeVisible();
  expect(message).toContain('Your saved texts and Pocket custom set are kept');
  expect(await count(page, 'sessions')).toBe(0);
  expect(await kv(page, 'texts')).toHaveLength(1);
});

test('Reset settings asks first', async ({ page }) => {
  await settings(page, { ...BASE, charWpm: 27 });
  await page.goto('./#/settings');
  page.once('dialog', (d) => void d.dismiss());
  await page.getByRole('button', { name: 'Reset settings' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('beepbeep.settings.v1')!).charWpm)).toBe(27);
});

test('Setup with a blocked microphone: calibration says so and stops', async ({ page }) => {
  await instrument(page, { gumFail: 'NotAllowedError' });
  await settings(page, { ...BASE, input: 'mic' });
  await page.goto('./#/setup');
  await page.getByRole('button', { name: 'Calibrate' }).click();
  await expect(page.getByText(/The microphone isn't on, so there is nothing to calibrate/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calibrate' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(0);
});

test('A blocked microphone offers the touch key on a sending screen', async ({ page }) => {
  await instrument(page, { gumFail: 'NotAllowedError' });
  await settings(page, { ...BASE, input: 'mic' });
  await page.goto('./#/practice/live');
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('button', { name: 'use the touch key' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('beepbeep.settings.v1')!).input)).toBe('touch');
});

test('Progress: a single session draws no negative axis values', async ({ page }) => {
  await settings(page, BASE);
  await page.goto('./#/progress');
  await page.evaluate(
    () =>
      new Promise<void>((res) => {
        const r = indexedDB.open('beepbeep', 1);
        r.onsuccess = () => {
          const tx = r.result.transaction('sessions', 'readwrite');
          tx.objectStore('sessions').add({ at: Date.now(), mode: 'ttr', seconds: 100, sending: false, items: 20, accuracy: 0.9, wpm: 18, ttrDelay: 0.3 });
          tx.oncomplete = () => res();
        };
      }),
  );
  await page.reload();
  const ticks = await page.locator('figure.chart .tick').allTextContents();
  expect(ticks.length).toBeGreaterThan(0);
  expect(ticks.filter((t) => /^[-−]/.test(t))).toEqual([]);
});

test('An LICW exercise left part-way can carry on from there', async ({ page }) => {
  test.setTimeout(90_000);
  await instrument(page);
  await settings(page, { ...BASE, track: 'licw', level: { koch: 'koch-1', licw: 'licw-bc1-TIN' } });
  await page.goto('./#/practice/class/bc1/recognition');
  await page.getByRole('button', { name: /Start/ }).click();
  await expect(page.getByText(/^[3-9] \/ 30$/)).toBeVisible({ timeout: 30_000 });
  await page.locator('nav.nav a', { hasText: 'Pocket' }).click();
  await expect(page).toHaveURL(/#\/pocket$/);
  await expect(page.getByRole('heading', { name: 'Pocket', level: 1 })).toBeVisible();
  await page.goBack();
  const left = page.getByText(/^You left this exercise at \d+ of 30\.$/);
  await expect(left).toBeVisible();
  const at = Number(/at (\d+) of/.exec(await left.innerText())![1]);
  expect(at).toBeGreaterThanOrEqual(3);
  const n = (await played(page)).filter((p) => p.kind === 'cw').length;
  await page.getByRole('button', { name: 'Carry on from there' }).click();
  await expect(page.getByText(`${at} / 30`)).toBeVisible();
  await expect.poll(async () => (await played(page)).filter((p) => p.kind === 'cw').length).toBeGreaterThan(n);
});

test('Pocket shows "not yet" for rounds the lesson has too little for', async ({ page }) => {
  await settings(page, { ...BASE, track: 'koch', level: { koch: 'koch-1', licw: 'licw-bc1-REA' } });
  await page.goto('./#/pocket');
  await expect(page.getByRole('link', { name: /Chunks/ })).toContainText('not yet');
});

test('a later LICW stage stands in for the lesson, and your carousel lesson is kept', async ({ page }) => {
  await settings(page, { ...BASE, track: 'licw', level: { koch: 'koch-1', licw: 'licw-bc1-HOF' } });
  await page.goto('./#/practice');
  const stage = page.getByLabel('Stage');
  await stage.selectOption('int2');
  await expect(page.getByText('Stage INT 2')).toBeVisible();
  await page.goto('./#/practice/copy/groups');
  await expect(page.locator('.eyebrow')).toContainText('Stage INT 2');
  await page.goto('./#/practice');
  await page.getByLabel('Stage').selectOption('bc1');
  await expect(page.getByText('BC1 · HOF')).toBeVisible();
});

test('strict mode keeps the straight key to BC lessons only', async ({ page }) => {
  await settings(page, { ...BASE, track: 'licw', licwStrict: true, licwClass: 'int1', input: 'iambicA', level: { koch: 'koch-1', licw: 'licw-bc1-REA' } });
  await page.goto('./#/setup');
  await expect(page.getByRole('radio', { name: 'Paddles A' })).toBeVisible();
});

// Before: Setup's Input row had no choice selected (the paddle choices are
// taken away on a BC lesson) and the signal bar said Paddles A.
test('strict mode with paddles saved, on a BC lesson: Setup and the signal bar show the straight key in use', async ({ page }) => {
  await settings(page, { ...BASE, track: 'licw', licwStrict: true, licwClass: 'bc1', input: 'iambicA', level: { koch: 'koch-1', licw: 'licw-bc1-REA' } });
  await page.goto('./#/setup');
  const input = page.getByRole('radiogroup', { name: 'Input' });
  await expect(input.getByRole('radio', { name: 'Straight key' })).toHaveAttribute('aria-checked', 'true');
  await expect(input.locator('[aria-checked="true"]')).toHaveCount(1);
  await expect(page.getByRole('link', { name: /^Straight key\b.*Open input setup/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /^Paddles A/ })).toHaveCount(0);
  // The paddles stay chosen for the later stages.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('beepbeep.settings.v1')!).input)).toBe('iambicA');
});

// Before: charWpm 0 was kept, and these drills threw when they played; unknown words were kept too.
test('hand-edited settings out of range still let the drills play', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${page.url().split('#')[1]}: ${e.message}`));
  await instrument(page);
  await settings(page, { ...BASE, charWpm: 0, effectiveWpm: 0, track: 'morse', input: 'keyboard', level: { koch: 'koch-5', licw: 'licw-bc1-REA' } });
  for (const [path, start] of [
    ['practice/copy/groups', /^Start/],
    ['practice/ttr', /^Start/],
    ['pocket/round/characters', /^Start the round/],
    ['practice/head-copy', /^Play/],
  ] as const) {
    await page.goto(`./#/${path}`);
    const before = (await played(page)).filter((p) => p.kind === 'cw').length;
    await page.getByRole('button', { name: start }).first().click();
    await expect.poll(async () => (await played(page)).filter((p) => p.kind === 'cw').length, { message: `${path} plays` }).toBeGreaterThan(before);
  }
  expect(errors).toEqual([]);
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('beepbeep.settings.v1')!));
  expect(s).toMatchObject({ charWpm: 5, effectiveWpm: 3, track: 'koch', input: 'mic' });
});

// Before: the keyed step said how the microphone listens, but not that it was blocked.
test('Learn QSOs with a blocked microphone says so and offers the touch key', async ({ page }) => {
  await instrument(page, { gumFail: 'NotAllowedError' });
  await settings(page, { ...BASE, input: 'mic', qsoInput: 'key', qsoHelp: 'text', charWpm: 40, effectiveWpm: 40, you: { call: '9V1NE', name: 'AMON', qth: 'SINGAPORE', state: '', skcc: '' } });
  await page.goto('./#/qso/learn/answer-cq');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Check' }).click();
  await page.getByRole('button', { name: 'Show what they sent' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText(/^The microphone is blocked\. Allow it in the browser's site settings, then try again\./)).toBeVisible();
  await page.getByRole('button', { name: 'use the touch key' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('beepbeep.settings.v1')!).input)).toBe('touch');
  await expect(page.locator('.pad')).toBeVisible();
});

test('TTR in strict mode shows no answer after each character, and the misses at the end', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, track: 'licw', licwStrict: true, level: { koch: 'koch-1', licw: 'licw-bc1-TIN' } });
  await page.goto('./#/practice/ttr');
  await page.getByRole('button', { name: /Start/ }).click();
  for (let k = 0; k < 2; k++) {
    await expect.poll(async () => (await played(page)).filter((p) => p.kind === 'cw').length, { timeout: 10_000 }).toBeGreaterThan(k);
    await page.keyboard.press('Q');
    await page.waitForTimeout(300);
    await expect(page.getByText(/You typed Q|Before the voice|After the voice/)).toHaveCount(0);
  }
  await page.getByRole('button', { name: /Stop/ }).click();
  await expect(page.getByText(/You beat the voice on \d+ of \d+\./)).toBeVisible();
  await expect(page.getByText(/Missed:[\s\S]*you typed Q/)).toBeVisible();
});

test('the Send drill says when your lesson cannot make the chosen material yet', async ({ page }) => {
  await settings(page, { ...BASE, track: 'koch', input: 'straight', level: { koch: 'koch-1', licw: 'licw-bc1-REA' } });
  await page.goto('./#/practice/send');
  await page.getByRole('radio', { name: 'Callsigns' }).click();
  await page.getByRole('button', { name: /Start/ }).click();
  await expect(page.getByText("Your lesson can't make callsigns yet, so you get groups of its characters instead.")).toBeVisible();
});

test('the version number opens the version history, and Back returns', async ({ page }) => {
  await settings(page, BASE);
  await page.goto('./#/progress');
  await page.locator('header a.ver').click();
  await expect(page.getByRole('heading', { name: 'Version history', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/#\/progress$/);
  await page.goto('./#/settings');
  await page.getByRole('link', { name: 'Version history' }).first().click();
  await expect(page.getByRole('heading', { name: 'Version history', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^0\.2\.6/, level: 2 })).toBeVisible();
  await expect(page.getByText('One-letter words keep their spaces: V V V no longer reads as VVV.')).toBeVisible();
});
