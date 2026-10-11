// Accessibility: axe-core (WCAG 2.0-2.2 A and AA rules) on every screen in both themes.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = [
  'practice', 'practice/live', 'practice/send', 'practice/hear-send', 'practice/copy', 'practice/familiarity', 'practice/ttr',
  'practice/ifr', 'practice/head-copy', 'practice/sprint', 'pocket', 'pocket/custom', 'pocket/round/characters',
  'qso', 'progress', 'settings', 'setup', 'reference', 'specimen', 'guide',
];

for (const theme of ['dark', 'light', 'paper'] as const) {
  for (const route of ROUTES) {
    test(`${theme} ${route}`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ theme: t, voice: 'off', track: 'licw', licwAsked: true }));
      }, theme);
      await page.goto(`./#/${route}`);
      await page.waitForTimeout(500);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const found = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}× ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
      expect(found).toEqual([]);
    });
  }
}
