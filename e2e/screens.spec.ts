// Screenshots of every screen in both themes for design review, plus checks
// that nothing throws and nothing scrolls sideways.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seed } from './seed';

const ROUTES = [
  'practice', 'practice/live', 'practice/send', 'practice/hear-send', 'practice/copy', 'practice/ttr',
  'practice/ifr', 'practice/head-copy', 'practice/sprint', 'pocket', 'pocket/custom', 'pocket/round/characters',
  'qso', 'progress', 'settings', 'setup', 'reference', 'specimen', 'guide',
  'practice/class/bc1/familiarity', 'practice/class/bc2/vst', 'practice/class/adv1/stories', 'practice/class/overlearn/rhythm',
];

// Screens that only show on the LICW track.
const SCREENS: { route: string; name: string; extra?: Record<string, unknown> }[] = [
  ...ROUTES.map((route) => ({ route, name: route.replaceAll('/', '_') })),
  { route: 'practice', name: 'practice-licw', extra: { track: 'licw', licwAsked: true } },
  { route: 'practice/familiarity', name: 'practice_familiarity', extra: { track: 'licw', licwAsked: true } },
];

for (const theme of ['dark', 'light'] as const) {
  for (const { route, name, extra } of SCREENS) {
    test(`${theme} ${name}`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(
        ([t, x]) => {
          localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ theme: t, voice: 'off', ...x }));
        },
        [theme, extra ?? {}] as const,
      );
      await page.goto(`./#/${route}`);
      await page.waitForTimeout(600);
      // Against the device width: a phone zooms out to fit a page that overflows, so innerWidth grows with it.
      const wide = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
      await page.screenshot({ path: `test-results/screens/${info.project.name}-${theme}-${name}.png`, fullPage: true });
      expect(errors).toEqual([]);
      expect(wide).toBeLessThanOrEqual(1);
    });
  }
}


for (const theme of ['dark', 'light'] as const) {
  test(`${theme} progress with history`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((t) => {
      localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ theme: t, voice: 'off', keepSends: true, level: { koch: 'koch-40', licw: 'licw-bc1-1' } }));
    }, theme);
    await page.goto('./#/progress');
    await page.waitForTimeout(400);
    await seed(page);
    await page.reload();
    await page.waitForTimeout(800);
    const wide = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
    await page.screenshot({ path: `test-results/screens/${info.project.name}-${theme}-progress-data.png`, fullPage: true });
    await page.getByRole('radio', { name: 'Sending' }).click();
    await page.screenshot({ path: `test-results/screens/${info.project.name}-${theme}-progress-data-tx.png`, fullPage: false });
    expect(errors).toEqual([]);
    expect(wide).toBeLessThanOrEqual(1);
    await expect(page.getByText('Spacing slips')).toBeVisible();
    await expect(page.getByText('CQ CQ DE K1ABC')).toBeVisible();
    await page.locator('.block', { hasText: 'Accuracy by character' }).getByRole('button', { name: 'Table', exact: true }).click();
    await expect(page.getByRole('columnheader', { name: 'Timing error' })).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
  });
}
