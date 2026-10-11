// LICW class exercises: the class list on Practice, the exercise player with
// lesson material and with your own text.
import { test, expect, type Page } from '@playwright/test';

async function open(page: Page, route: string, extra: Record<string, unknown> = {}) {
  await page.addInitScript(
    (x) => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ track: 'licw', licwAsked: true, guideSeen: true, voice: 'builtin', ...x })),
    extra,
  );
  await page.goto(`./#/${route}`);
}

const shot = (page: Page, name: string, project: string) => page.screenshot({ path: `test-results/screens/${project}-classes-${name}.png`, fullPage: true });

test('in a class, Practice lists the class exercises for your carousel group', async ({ page }, info) => {
  await open(page, 'practice', { licwEnrolled: true, level: { koch: 'koch-1', licw: 'licw-bc1-PSG' }, carousel: { bc1: 'TIN', bc2: 'KMY' } });
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Class exercises' }) });
  await expect(section.getByLabel('Class')).toHaveValue('bc1');
  await expect(section.getByLabel('Joined at')).toHaveValue('TIN');
  await expect(section.getByRole('link', { name: /Familiarity/ })).toBeVisible();
  await expect(section.getByRole('link', { name: /^VET/ })).toBeVisible();
  // Joined at TIN, on PSG: TIN and PSG known.
  await expect(page.getByText('BC1 · PSG')).toBeVisible();
  await shot(page, 'list', info.project.name);
  // Picking BC2 moves you onto its carousel.
  await section.getByLabel('Class').selectOption('bc2');
  await expect(page.getByText('BC2 · KMY')).toBeVisible();
  await expect(section.getByLabel('Joined at')).toHaveValue('KMY');
  await section.getByLabel('Class').selectOption('int2');
  await expect(section.getByRole('link', { name: /Speed Racing, words/ })).toBeVisible();
});

test('Familiarity: the voice first, then the card, with pause and resume', async ({ page }, info) => {
  await open(page, 'practice/class/bc1/familiarity', { level: { koch: 'koch-1', licw: 'licw-bc1-TIN' } });
  await expect(page.getByRole('heading', { name: 'Familiarity' })).toBeVisible();
  await expect(page.getByText('Say the name with it, out loud.')).toBeVisible();
  await page.getByRole('button', { name: /Start/ }).click();
  // The new group's characters, shown as the voice says them.
  await expect(page.locator('.stage .text')).toHaveText(/^[TIN]$/, { timeout: 10_000 });
  await expect(page.getByText(/^\d+ \/ 12$/)).toBeVisible();
  await shot(page, 'familiarity', info.project.name);
  await page.getByRole('button', { name: /Pause/ }).click();
  await expect(page.getByText('Paused')).toBeVisible();
  await page.getByRole('button', { name: /Resume/ }).click();
  await expect(page.getByRole('button', { name: /Pause/ })).toBeVisible();
  await page.getByRole('button', { name: /Stop/ }).click();
  await expect(page.getByRole('button', { name: /Start/ })).toBeVisible();
});

test('your own text, with Morse Browser markup, plays one card per line', async ({ page }, info) => {
  await open(page, 'practice/class/adv1/stories');
  await expect(page.getByText('No texts yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Paste text' }).click();
  await page.getByLabel('Name').fill('My story');
  await page.getByLabel('Text', { exact: true }).fill('{CQ|} cq\nTHE RIG IS ON\n{|that is all}');
  await page.getByRole('button', { name: 'Save text' }).click();
  await expect(page.getByText('3 lines. Each line plays on its own.')).toBeVisible();
  await page.getByText('Show each one after it plays').click();
  await page.getByRole('radio', { name: '30 wpm' }).click();
  await page.getByRole('button', { name: /Start/ }).click();
  await expect(page.getByText('ADV 1 · 30/30 wpm')).toBeVisible();
  await expect(page.locator('.played li').first()).toHaveText('CQ CQ', { timeout: 15_000 });
  await shot(page, 'text', info.project.name);
  // Saved for next time.
  await page.reload();
  await expect(page.getByLabel('Text', { exact: true })).toHaveValue(/.+/);
  await expect(page.getByText('3 lines. Each line plays on its own.')).toBeVisible();
});

test('VET runs two minutes of groups with the spacing stepping up', async ({ page }, info) => {
  await open(page, 'practice/class/bc1/vet', { level: { koch: 'koch-1', licw: 'licw-bc1-REA' } });
  await expect(page.getByText('Groups of three to copy. The gaps between characters start wide and shrink every 30 seconds.')).toBeVisible();
  await page.getByRole('button', { name: /Start/ }).click();
  await expect(page.getByText(/^[12]:\d\d left$/)).toBeVisible();
  await expect(page.getByText('BC1 · REA · 12/8 wpm')).toBeVisible();
  // Nothing shows while it plays: the groups are read back at the end.
  await page.waitForTimeout(3000);
  await expect(page.locator('.stage .text')).toHaveCount(0);
  await shot(page, 'vet', info.project.name);
});

test('an exercise with too little material says so and waits', async ({ page }) => {
  await open(page, 'practice/class/bc1/phrases', { level: { koch: 'koch-1', licw: 'licw-bc1-REA' } });
  await expect(page.getByText(/Too few characters for this exercise yet/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Start/ })).toBeDisabled();
});

test('a BC2 exercise opened from the Koch track uses your BC2 group', async ({ page }) => {
  await open(page, 'practice/class/bc2/vst', { track: 'koch', level: { koch: 'koch-3', licw: 'licw-bc1-TIN' } });
  await expect(page.getByText('BC2 · KMY · 24/10 wpm')).toBeVisible();
});

test('not in a class: stages, no carousel start, no class wording', async ({ page }) => {
  // A starting group saved earlier is ignored until you say you are in a class.
  await open(page, 'practice', { level: { koch: 'koch-1', licw: 'licw-bc1-REA' }, carousel: { bc1: 'TIN', bc2: 'KMY' } });
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'LICW exercises' }) });
  await expect(section.getByLabel('Stage')).toHaveValue('bc1');
  await expect(section.getByLabel('Joined at')).toHaveCount(0);
  await expect(section.getByText(/your class/)).toHaveCount(0);
  await expect(page.getByText('BC1 · REA')).toBeVisible();
  await page.getByRole('button', { name: 'Next lesson' }).click();
  await expect(page.getByText('BC1 · TIN')).toBeVisible();
  await expect(page.getByText('Characters known').locator('..')).toContainText('6');
  // Turning it on in Settings brings the class controls back.
  await page.goto('./#/settings');
  await page.getByText('In an LICW class').click();
  await page.goto('./#/practice');
  await expect(page.getByRole('heading', { name: 'Class exercises' })).toBeVisible();
  await expect(page.getByLabel('Joined at')).toHaveValue('TIN');
});
