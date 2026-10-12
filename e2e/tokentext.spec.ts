// Prompted and decoded text (TokenText) on phones: lines break only between
// words, never inside one, and a new line never starts with a space.
import { test, expect, type Page } from '@playwright/test';

// A six-character callsign makes "CQ CQ CQ DE VK7UYJ VK7UYJ K" wrap on most phones.
const YOU = { call: 'VK7UYJ', name: 'AMON', qth: 'HOBART', state: '', skcc: '' };

/** Words whose letters sit on more than one line, and lines that start with a space. */
function wrapFaults(page: Page) {
  return page.evaluate(() => {
    const faults: string[] = [];
    for (const p of document.querySelectorAll('main p.text')) {
      const pr = p.getBoundingClientRect();
      const left = pr.left + parseFloat(getComputedStyle(p).paddingLeft);
      const words: HTMLElement[][] = [[]];
      for (const s of p.children as HTMLCollectionOf<HTMLElement>) {
        if (s.classList.contains('sp')) words.push([]);
        else words[words.length - 1].push(s);
      }
      const full = words.filter((w) => w.length);
      let prevTop = -1;
      for (const w of full) {
        const tops = new Set(w.map((s) => Math.round(s.getBoundingClientRect().top)));
        const text = w.map((s) => s.textContent).join('');
        if (tops.size > 1) faults.push(`"${text}" is split across lines`);
        const r = w[0].getBoundingClientRect();
        if (prevTop >= 0 && Math.round(r.top) > prevTop + 2 && r.left - left > 2) faults.push(`the line with "${text}" starts ${Math.round(r.left - left)} px in`);
        prevTop = Math.round(w[w.length - 1].getBoundingClientRect().top);
      }
    }
    return faults;
  });
}

test('Learn QSOs, Send this: breaks only between words at every phone width', async ({ page }) => {
  await page.addInitScript((you) => localStorage.setItem('beepbeep.settings.v1', JSON.stringify({ you, guideSeen: true, voice: 'off', input: 'touch' })), YOU);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('./#/qso/learn/call-cq');
  await page.getByRole('button', { name: /^Start/ }).first().click();
  await expect(page.locator('main p.text').first()).toBeVisible();
  const faults: string[] = [];
  let lines = 0;
  for (let width = 360; width <= 430; width += 5) {
    await page.setViewportSize({ width, height: 740 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    lines = Math.max(lines, await page.locator('main p.text').first().evaluate((p) => Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight))));
    for (const f of await wrapFaults(page)) faults.push(`${width} px: ${f}`);
  }
  expect(lines, 'the text wraps at these widths, so the test means something').toBeGreaterThan(1);
  expect(faults).toEqual([]);
});
