// Screenshots of every screen in both themes for design review, plus checks
// that nothing throws and nothing scrolls sideways.
import { test, expect } from '@playwright/test';

const ROUTES = [
  'practice', 'practice/live', 'practice/send', 'practice/hear-send', 'practice/copy', 'practice/ttr',
  'practice/ifr', 'practice/head-copy', 'practice/sprint', 'pocket', 'pocket/custom', 'pocket/round/characters',
  'qso', 'progress', 'settings', 'setup', 'reference', 'specimen',
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
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: `test-results/screens/${info.project.name}-${theme}-${name}.png`, fullPage: true });
      expect(errors).toEqual([]);
      expect(wide).toBeLessThanOrEqual(1);
    });
  }
}
