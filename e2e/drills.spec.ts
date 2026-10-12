// Drill behaviour found broken in the audit: the Copy drill's lesson, replays
// and stray key presses, and the Today checklist after a drill.
import { test, expect, type Page } from '@playwright/test';
import { BASE, instrument, played, sessions, settings } from './probe';

async function nextAudio(page: Page, n: number): Promise<string> {
  await expect.poll(async () => (await played(page)).filter((p) => p.kind === 'cw').length, { timeout: 10_000 }).toBeGreaterThan(n);
  return (await played(page)).filter((x) => x.kind === 'cw')[n].text;
}

async function typeText(page: Page, t: string) {
  for (const c of t.replace(/ /g, '')) await page.keyboard.press(c);
}

/** A Copy drill round of 20, answered right (from the decoded audio) or wrong. */
async function copyRound(page: Page, how: 'right' | 'wrong') {
  const before = (await played(page)).filter((p) => p.kind === 'cw').length;
  await page.getByRole('button', { name: /Start|Another round/ }).first().click();
  for (let k = 0; k < 20; k++) {
    const item = await nextAudio(page, before + k);
    await expect(page.locator('.answer .label').first()).toHaveText(/Type|Listen/);
    await page.waitForTimeout(item.length * 250);
    await typeText(page, how === 'right' ? item : 'Q');
    // A one-character item is submitted by its first key; longer ones need Enter.
    if (item.replace(/ /g, '').length > 1) await page.keyboard.press('Enter');
    await expect(page.getByText('Sent', { exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
  }
  await expect(page.getByText(/% of characters/)).toBeVisible({ timeout: 10_000 });
}

test('Copy drill: Next lesson moves the drill on to the new lesson', async ({ page }) => {
  test.setTimeout(180_000);
  await instrument(page);
  await settings(page, { ...BASE, track: 'koch', level: { koch: 'koch-1', licw: 'licw-bc1-REA' } });
  await page.goto('./#/practice/copy/groups');
  await expect(page.locator('.intro p')).toContainText('the 2 characters you know');
  await copyRound(page, 'right');
  await page.getByRole('button', { name: 'Next lesson' }).click();
  await expect(page.locator('.eyebrow')).toContainText('Lesson 2');
  await expect(page.locator('.intro p')).toContainText('the 3 characters you know');
});

test('Copy drill: Replay after the answer is shown does not take a second answer', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, track: 'koch', level: { koch: 'koch-5', licw: 'licw-bc1-REA' } });
  await page.goto('./#/practice/copy/groups');
  await page.getByRole('button', { name: /Start/ }).click();
  const item = await nextAudio(page, 0);
  await page.keyboard.press('Q');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Sent', { exact: true })).toBeVisible();
  await expect(page.locator('.count')).toHaveText('2 / 20');
  await page.getByRole('button', { name: 'Replay' }).click();
  await nextAudio(page, 1);
  await page.waitForTimeout(item.length * 300 + 500);
  await typeText(page, item);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  // The replayed item was not answered again: Enter moved on to the second one.
  await expect(page.locator('.count')).toHaveText('2 / 20');
  await expect(page.getByText('Sent', { exact: true })).toHaveCount(0);
});

test('Copy drill: an extra Enter right after Next does not submit an empty answer', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, track: 'koch', level: { koch: 'koch-10', licw: 'licw-bc1-REA' } });
  await page.goto('./#/practice/copy/groups');
  await page.getByRole('button', { name: /Start/ }).click();
  const item = await nextAudio(page, 0);
  await page.waitForTimeout(item.length * 300);
  await typeText(page, item);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Sent', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await expect(page.getByText('Typed', { exact: true })).toHaveCount(0);
});

test('Copy drill: a double Enter at the start plays one item', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, track: 'koch', level: { koch: 'koch-5', licw: 'licw-bc1-REA' } });
  await page.goto('./#/practice/copy/groups');
  await page.locator('h1').click();
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(1500);
  expect((await played(page)).filter((p) => p.kind === 'cw').length).toBe(1);
});

test('Today ticks a step when you come back from it, without a reload', async ({ page }) => {
  test.setTimeout(180_000);
  await instrument(page);
  await settings(page, { ...BASE, track: 'koch', level: { koch: 'koch-1', licw: 'licw-bc1-REA' } });
  await page.goto('./#/practice');
  const step = page.locator('ol.steps li').filter({ hasText: 'Copy drill' });
  await expect(step.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
  await step.locator('a').click();
  await copyRound(page, 'wrong');
  expect((await sessions(page)).map((s) => s.mode)).toContain('copy');
  await page.locator('a.back').click();
  await expect(step.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
});


/** Marks characters as seen, so a Pocket round starts with the quiz, not the new-character intro. */
async function seen(page: Page, chars: string) {
  await page.goto('./#/progress');
  await page.evaluate(async (chars) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('beepbeep', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction(['items'], 'readwrite');
    for (const c of chars) tx.objectStore('items').put({ key: `rx:${c}`, heat: 3, seen: 20, correct: 18, avgMs: 900, recent: [1, 1, 1], lastSeen: Date.now() });
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  }, chars);
}

const cwOn = async (page: Page, notHash: RegExp) => (await played(page)).filter((p) => p.kind === 'cw' && !notHash.test(p.hash));

test('Pocket: nothing plays after you leave a round', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, track: 'koch', level: { koch: 'koch-5', licw: 'licw-bc1-REA' } });
  await page.goto('./#/pocket/round/characters');
  await page.getByRole('button', { name: 'Start the round' }).click();
  await nextAudio(page, 0);
  await page.keyboard.press('Q');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/pocket$/);
  await page.waitForTimeout(3000);
  expect(await cwOn(page, /round/)).toEqual([]);
});

test('Pocket: Enter after a miss goes to the next one', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, track: 'koch', level: { koch: 'koch-5', licw: 'licw-bc1-REA' } });
  await seen(page, 'KMRSUA');
  await page.goto('./#/pocket/round/characters');
  await page.getByRole('button', { name: 'Start the round' }).click();
  const item = await nextAudio(page, 0);
  await page.waitForTimeout(400);
  await page.keyboard.press(item === 'Q' ? 'Z' : 'Q');
  await expect(page.getByText(/^You typed/)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText('2 / 20')).toBeVisible();
});

test('Pocket in strict mode: no answer after each one; the misses are listed at the end', async ({ page }) => {
  test.setTimeout(120_000);
  await instrument(page);
  await settings(page, { ...BASE, track: 'licw', licwStrict: true, level: { koch: 'koch-1', licw: 'licw-bc1-REA' } });
  await seen(page, 'REA');
  await page.goto('./#/pocket/round/characters');
  await page.getByRole('button', { name: 'Start the round' }).click();
  for (let k = 0; k < 20; k++) {
    await nextAudio(page, k);
    await page.waitForTimeout(200);
    await page.keyboard.press('Q');
    await expect(page.getByText('It was')).toHaveCount(0);
  }
  await expect(page.getByRole('heading', { name: 'Missed' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('you typed Q').first()).toBeVisible();
});

test('Spot the new character: leaving just after Play plays nothing on the next screen', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, track: 'koch', level: { koch: 'koch-5', licw: 'licw-bc1-REA' } });
  await page.goto('./#/practice/familiarity');
  await page.getByRole('button', { name: /Play/ }).click();
  await nextAudio(page, 0);
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page).toHaveURL(/#\/practice$/);
  await page.waitForTimeout(4000);
  expect(await cwOn(page, /familiarity/)).toEqual([]);
});

test('TTR: Stop says nothing more and records no miss', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, voice: 'builtin', track: 'koch', level: { koch: 'koch-5', licw: 'licw-bc1-REA' } });
  await page.goto('./#/practice/ttr');
  await page.getByRole('button', { name: /Start/ }).click();
  await nextAudio(page, 0);
  await page.getByRole('button', { name: /Stop/ }).click();
  const voices = (await played(page)).filter((p) => p.kind === 'voice').length;
  await page.waitForTimeout(3000);
  expect((await played(page)).filter((p) => p.kind === 'voice').length).toBe(voices);
  const rx = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('beepbeep', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const all: { key: string; seen: number }[] = await new Promise((res) => {
      const q = db.transaction('items').objectStore('items').getAll();
      q.onsuccess = () => res(q.result);
    });
    db.close();
    return all.filter((s) => s.key.startsWith('rx:')).length;
  });
  expect(rx).toBe(0);
});

test('Sound surfing: stopping before much has played saves nothing', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, track: 'koch', level: { koch: 'koch-5', licw: 'licw-bc1-REA' } });
  await page.goto('./#/practice/ifr');
  await page.getByRole('button', { name: /Start/ }).click();
  await nextAudio(page, 0);
  await page.getByRole('button', { name: /Stop/ }).click();
  await expect(page.getByRole('button', { name: /Start/ })).toBeVisible();
  expect((await sessions(page)).filter((s) => s.mode === 'ifr')).toEqual([]);
});

test('Sprint: callsigns use only the lesson\'s characters', async ({ page }) => {
  await settings(page, { ...BASE, track: 'koch', level: { koch: 'koch-1', licw: 'licw-bc1-REA' } });
  await page.goto('./#/practice/sprint');
  await page.getByRole('radio', { name: 'Callsigns' }).click();
  await page.getByRole('button', { name: /Start/ }).click();
  await expect(page.getByText(/There aren't enough callsigns yet that use only the characters in Lesson 1/)).toBeVisible();
});

test('Sprint: before the lesson has digits it opens on words, which play', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, track: 'koch', level: { koch: 'koch-14', licw: 'licw-bc1-REA' } });
  await page.goto('./#/practice/sprint');
  await expect(page.getByRole('radio', { name: 'Words' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: /Start/ }).click();
  const word = await nextAudio(page, 0);
  expect(word.split('').every((c) => 'KMRSUAPTLOWI.NJ'.includes(c))).toBe(true);
});

test('Head copy: one letter is not a copy of a name', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, track: 'koch', charWpm: 40, effectiveWpm: 40 });
  await page.goto('./#/practice/head-copy');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Check' })).toBeVisible({ timeout: 60_000 });
  const sent = (await played(page)).filter((p) => p.kind === 'cw')[0].text;
  const name = /NAME HR IS (\S+)/.exec(sent)?.[1] ?? '';
  expect(name.length).toBeGreaterThan(1);
  await page.getByLabel('Name').fill(name[0]);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByLabel('Name').locator('..').getByText('Missed')).toBeVisible();
});

test('LICW exercise: Your text with nothing saved shows how to add one', async ({ page }) => {
  await settings(page, { ...BASE, track: 'licw', level: { koch: 'koch-1', licw: 'licw-bc1-REA' } });
  await page.goto('./#/practice/class/bc1/phrases');
  await page.getByRole('radio', { name: 'Your text' }).click();
  await expect(page.getByRole('radio', { name: 'Your text' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Paste text' })).toBeVisible();
  await page.getByRole('button', { name: 'Paste text' }).click();
  await page.getByLabel('Text', { exact: true }).fill('CQ CQ DE 9V1NE\nTNX FER CALL');
  await page.getByRole('button', { name: 'Save text' }).click();
  await expect(page.getByRole('button', { name: /Start/ })).toBeEnabled();
});
