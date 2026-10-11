// Learn QSOs: guided lessons, typed and keyed, with mistakes along the way.
import { test, expect, type Page } from '@playwright/test';
import { patternOf, tokenize } from '../src/lib/morse/code';

const YOU = { call: 'K1XYZ', name: 'TOM', qth: 'SALEM', state: 'MA', skcc: '' };

async function open(page: Page, route: string, extra: Record<string, unknown> = {}) {
  await page.addInitScript((x) => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ voice: 'off', guideSeen: true, ...x })), { you: YOU, ...extra });
  await page.goto(`./#/${route}`);
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
      document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: 'Space', key: ' ', bubbles: true }));
    }
  }, evs);
}

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
  await expect(page.getByText('Lesson done.')).toBeVisible();
  await expect(page.getByText('1 of 3 steps right the first time.')).toBeVisible();
  // Done once, on the list.
  await page.getByRole('link', { name: 'All lessons' }).click();
  await expect(page.getByText('Done once')).toBeVisible();
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
    const ev = (type: string) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch', isPrimary: true });
    const t0 = performance.now();
    for (const [at, down] of evs) {
      const wait = t0 + at - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      el.dispatchEvent(ev(down ? 'pointerdown' : 'pointerup'));
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
