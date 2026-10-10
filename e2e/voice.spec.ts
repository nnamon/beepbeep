// Built-in voice clips: every clip is served and decodes in the browser.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const names = Object.keys(JSON.parse(readFileSync('scripts/voice-lines.json', 'utf8')));

test('every built-in voice clip decodes', async ({ page }) => {
  await page.goto('./');
  const results = await page.evaluate(async (list) => {
    const ctx = new OfflineAudioContext(1, 48000, 48000);
    const out: { name: string; seconds: number; peak: number }[] = [];
    for (const name of list) {
      const r = await fetch(`voice/${name}.mp3`);
      if (!r.ok) {
        out.push({ name, seconds: 0, peak: 0 });
        continue;
      }
      const buf = await ctx.decodeAudioData(await r.arrayBuffer());
      const ch = buf.getChannelData(0);
      let peak = 0;
      for (const s of ch) peak = Math.max(peak, Math.abs(s));
      out.push({ name, seconds: buf.duration, peak });
    }
    return out;
  }, names);
  expect(results).toHaveLength(58);
  for (const r of results) {
    expect(r.seconds, r.name).toBeGreaterThan(0.3);
    expect(r.seconds, r.name).toBeLessThan(1.6);
    expect(r.peak, r.name).toBeGreaterThan(0.5);
  }
});
