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
