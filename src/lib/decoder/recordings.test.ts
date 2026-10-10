// Decoder accuracy on real recordings: fixtures/recordings/<name>.wav with
// <name>.txt holding the text that was sent. Same pipeline as the browser.
// Optional header lines in the .txt: "# max 0.08" (allowed character error
// rate, default 0.05) and "# wpm 18" (starting speed guess).

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { decodeSamples } from './pipeline';
import { readWav, writeWav } from '../util/wav';
import { renderText } from '../morse/render';
import { cer } from '../util/text';

const DIR = 'fixtures/recordings';
const names = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => f.endsWith('.wav') && existsSync(`${DIR}/${f.slice(0, -4)}.txt`))
      .map((f) => f.slice(0, -4))
  : [];

describe('WAV reader', () => {
  it('round-trips 16-bit PCM and decodes it', () => {
    const { samples } = renderText('TEST DE K1ABC', { sampleRate: 22050, pitch: 600, amplitude: 0.5, charWpm: 20 });
    const back = readWav(writeWav(samples, 22050));
    expect(back.sampleRate).toBe(22050);
    expect(back.samples.length).toBe(samples.length);
    expect(Math.abs(back.samples[1000] - samples[1000])).toBeLessThan(1e-4);
    expect(decodeSamples(back.samples, 22050, { initialWpm: 20 }).text).toBe('TEST DE K1ABC');
  });
});

describe('decoder accuracy on real recordings', () => {
  if (!names.length) it.skip(`no recordings in ${DIR}`, () => {});
  for (const n of names) {
    it(n, () => {
      const lines = readFileSync(`${DIR}/${n}.txt`, 'utf8').split('\n');
      const header = (k: string) => lines.find((l) => l.startsWith(`# ${k} `))?.split(' ')[2];
      const text = lines.filter((l) => !l.startsWith('#')).join(' ').trim().toUpperCase();
      const max = Number(header('max') ?? 0.05);
      const { samples, sampleRate } = readWav(readFileSync(`${DIR}/${n}.wav`));
      const r = decodeSamples(samples, sampleRate, { initialWpm: Number(header('wpm') ?? 15) });
      const e = cer(text, r.text);
      console.log(`${n}: CER ${(e * 100).toFixed(1)}%, ${r.wpm.toFixed(1)} wpm, ${r.pitch?.toFixed(0)} Hz\n  sent: ${text}\n  got:  ${r.text}`);
      expect(e).toBeLessThanOrEqual(max);
    });
  }
});
