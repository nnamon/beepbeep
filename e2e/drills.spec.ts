// Drill behaviour found broken in the audit: the Copy drill's lesson, replays
// and stray key presses, and the Today checklist after a drill.
import { test, expect, type Page } from '@playwright/test';
import { BASE, instrument, played, sessions, settings, tones } from './probe';

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

// Before: on the LICW track a new character played 5 times unnamed while you
// tapped along, and nothing depended on the taps.
test('Pocket on the LICW track: a new character is named, then played three times', async ({ page }) => {
  test.setTimeout(60_000);
  await instrument(page);
  await settings(page, { ...BASE, voice: 'builtin', track: 'licw', level: { koch: 'koch-1', licw: 'licw-bc1-REA' } });
  await page.goto('./#/pocket/round/characters');
  await page.getByRole('button', { name: 'Start the round' }).click();
  await expect(page.getByText('New', { exact: true })).toBeVisible();
  await expect(page.locator('.round .center').getByText('R', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tap when it plays' })).toHaveCount(0);
  await expect.poll(async () => (await played(page)).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(5);
  const first = (await played(page)).slice(0, 5).map((p) => (p.kind === 'voice' ? 'name' : p.text));
  expect(first).toEqual(['name', 'R', 'R', 'R', 'name']);
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
  await page.getByRole('link', { name: 'Back', exact: true }).click();
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

test('Enter on a link or radio reached with Tab is for that control, not the drill', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, track: 'koch', level: { koch: 'koch-5', licw: 'licw-bc1-REA' } });
  await page.goto('./#/practice/copy/groups');
  await expect(page.getByRole('button', { name: /Start/ })).toBeVisible();
  // Tab to the Material radio group and press Enter: no round starts.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.getAttribute('role') === 'radio')) break;
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  expect((await played(page)).filter((p) => p.kind === 'cw')).toEqual([]);
  // Enter on the Back link follows it.
  await page.getByRole('link', { name: 'Back', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/practice$/);
  expect((await played(page)).filter((p) => p.kind === 'cw')).toEqual([]);
});

test('Enter after clicking a drill button with the mouse still submits the answer', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, track: 'koch', level: { koch: 'koch-10', licw: 'licw-bc1-REA' } });
  await page.goto('./#/practice/copy/groups');
  await page.getByRole('button', { name: /Start/ }).click();
  const item = await nextAudio(page, 0);
  await page.getByRole('button', { name: 'Replay' }).click();
  await nextAudio(page, 1);
  await page.waitForTimeout(item.length * 300);
  await typeText(page, item);
  if (item.replace(/ /g, '').length > 1) await page.keyboard.press('Enter');
  await expect(page.getByText('Sent', { exact: true })).toBeVisible();
});

test('Pocket words: Enter after a miss goes on without answering the next one', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, track: 'koch', level: { koch: 'koch-44', licw: 'licw-bc1-REA' } });
  await page.goto('./#/pocket/round/words');
  await page.getByRole('button', { name: 'Start the round' }).click();
  await nextAudio(page, 0);
  await page.waitForTimeout(300);
  await page.keyboard.press('Q');
  await page.keyboard.press('Q');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/^You typed QQ/)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText('2 / 20')).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.getByText(/^You typed/)).toHaveCount(0);
});

// ---- Space on a button reached with Tab, on the screens where Space is the straight key ----

/** Presses Tab until a button whose text matches has focus. */
async function tabToButton(page: Page, name: RegExp) {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate((src) => {
      const el = document.activeElement;
      return !!el && el.tagName === 'BUTTON' && new RegExp(src).test(el.textContent?.trim() ?? '');
    }, name.source);
    if (hit) return;
  }
  throw new Error(`Tab never reached a button named ${name}`);
}

async function tapSpace(page: Page) {
  await page.keyboard.down(' ');
  await page.waitForTimeout(120);
  await page.keyboard.up(' ');
}

const YOU = { call: '9V1NE', name: 'AMON', qth: 'SINGAPORE', state: '', skcc: '' };

for (const c of [
  { name: 'Live decoder', path: 'practice/live', button: /^Stop/ },
  { name: 'Send drill', path: 'practice/send', button: /^Done/ },
  { name: 'Hear it, send it', path: 'practice/hear-send', button: /^Stop/ },
  { name: 'QSO', path: 'qso', button: /^Stop/ },
]) {
  test(`${c.name}: Space on ${c.button.source.slice(1)} reached with Tab presses it and keys nothing`, async ({ page }) => {
    await instrument(page);
    await settings(page, { ...BASE, input: 'straight', track: 'koch', level: { koch: 'koch-5', licw: 'licw-bc1-REA' }, you: YOU });
    await page.goto(`./#/${c.path}`);
    if (c.path === 'qso') {
      await page.getByRole('radio', { name: 'You', exact: true }).click();
      await page.getByRole('button', { name: 'Start QSO' }).click();
      await expect(page.getByRole('button', { name: /^End my turn/ })).toBeEnabled({ timeout: 10_000 });
    } else {
      await page.getByRole('button', { name: /^Start/ }).click();
      // Hear it, send it listens for your sending after it has played the character.
      if (c.path === 'practice/hear-send') await expect(page.getByText('Send', { exact: true })).toBeVisible({ timeout: 10_000 });
      else await page.waitForTimeout(500);
    }
    await tabToButton(page, c.button);
    const before = (await tones(page)).length;
    await tapSpace(page);
    await page.waitForTimeout(800);
    expect((await tones(page)).length - before, 'Space keyed the straight key').toBe(0);
    await expect(page.getByRole('button', { name: c.button })).toHaveCount(0);
  });
}

test('Live decoder: after Start or Done sending is clicked with the mouse, Space still keys', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, input: 'straight' });
  await page.goto('./#/practice/live');
  await page.getByRole('button', { name: /^Start/ }).click();
  await page.waitForTimeout(300);
  let before = (await tones(page)).length;
  await tapSpace(page);
  await page.waitForTimeout(300);
  expect((await tones(page)).length - before).toBe(1);
  await page.getByRole('button', { name: 'Done sending' }).click();
  before = (await tones(page)).length;
  await tapSpace(page);
  await page.waitForTimeout(300);
  expect((await tones(page)).length - before).toBe(1);
  await expect(page.getByRole('button', { name: /^Stop/ })).toBeVisible();
});

test('Learn QSOs: Space on Hear it reached with Tab plays it and keys nothing', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, input: 'straight', qsoInput: 'key', qsoHelp: 'text', charWpm: 40, effectiveWpm: 40, you: YOU });
  await page.goto('./#/qso/learn/answer-cq');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Check' }).click();
  await page.getByRole('button', { name: 'Show what they sent' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('button', { name: 'Hear it' })).toBeVisible();
  await page.waitForTimeout(800);
  await tabToButton(page, /^Hear it$/);
  const keyed = (await tones(page)).length;
  const heard = (await played(page)).filter((p) => p.kind === 'cw').length;
  await tapSpace(page);
  await page.waitForTimeout(1000);
  expect((await tones(page)).length - keyed, 'Space keyed the straight key').toBe(0);
  expect((await played(page)).filter((p) => p.kind === 'cw').length - heard, 'Hear it played').toBe(1);
});

test('LICW exercise: Esc stops it and stays on the exercise, as Stop does', async ({ page }) => {
  await instrument(page);
  await settings(page, { ...BASE, track: 'licw', level: { koch: 'koch-5', licw: 'licw-bc1-TIN' } });
  await page.goto('./#/practice/class/bc1/recognition');
  await page.getByRole('button', { name: /^Start/ }).click();
  await nextAudio(page, 0);
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  const at = await page.evaluate(() => performance.now());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2000);
  await expect(page).toHaveURL(/#\/practice\/class\/bc1\/recognition$/);
  await expect(page.getByRole('button', { name: /^Start/ })).toBeVisible();
  expect((await played(page)).filter((p) => p.at > at + 50)).toEqual([]);
});

/** The keys of the item stats stored so far. */
const itemKeys = (page: Page) =>
  page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('beepbeep', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const keys: string[] = await new Promise((res) => {
      const q = db.transaction('items').objectStore('items').getAllKeys();
      q.onsuccess = () => res(q.result as string[]);
    });
    db.close();
    return keys;
  });

// Before: the space between words was recorded as a missed character ("rx: ").
for (const how of ['right', 'with a letter missed'] as const) {
  test(`Copy drill, Short phrases: the space between words is not a character (answered ${how})`, async ({ page }) => {
    await instrument(page);
    await settings(page, { ...BASE, track: 'koch', level: { koch: 'koch-44', licw: 'licw-bc1-REA' } });
    await page.goto('./#/practice/copy/context');
    await expect(page.getByRole('radio', { name: 'Short phrases' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: /Start/ }).click();
    const item = await nextAudio(page, 0);
    expect(item).toContain(' ');
    await page.waitForTimeout(item.length * 150);
    // Missing a letter puts a letter of the next word against the space.
    await typeText(page, how === 'right' ? item : item.replace(/(\S) /, ' '));
    await page.keyboard.press('Enter');
    await expect(page.getByText('Sent', { exact: true })).toBeVisible();
    await expect.poll(() => itemKeys(page)).not.toEqual([]);
    const keys = await itemKeys(page);
    expect(keys.filter((k) => k.trim() !== k || k === 'rx:')).toEqual([]);
    expect(keys.sort()).toEqual([...new Set(item.replace(/ /g, '').split('').map((c) => `rx:${c}`))].sort());
  });
}
