// Screenshots of every screen in both themes for design review, plus checks
// that nothing throws and nothing scrolls sideways.
import { test, expect } from '@playwright/test';

const ROUTES = [
  'practice', 'practice/live', 'practice/send', 'practice/hear-send', 'practice/copy', 'practice/ttr',
  'practice/ifr', 'practice/head-copy', 'practice/sprint', 'pocket', 'pocket/custom', 'pocket/round/characters',
  'qso', 'progress', 'settings', 'setup', 'reference', 'specimen',
];

for (const theme of ['dark', 'light'] as const) {
  for (const route of ROUTES) {
    test(`${theme} ${route}`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript((t) => {
        localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ theme: t, voice: 'off' }));
      }, theme);
      await page.goto(`./#/${route}`);
      await page.waitForTimeout(600);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: `test-results/screens/${info.project.name}-${theme}-${route.replaceAll('/', '_')}.png`, fullPage: true });
      expect(errors).toEqual([]);
      expect(wide).toBeLessThanOrEqual(1);
    });
  }
}
