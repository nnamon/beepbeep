// Hand keying, as people actually send on a straight key or a touch pad:
// gap lengths do not follow mark lengths. Taps are short, the pauses between
// them long, and everything jitters. Fed straight to the decoder, as the
// keyboard and touch keys do (no audio).

import { afterAll, describe, expect, it } from 'vitest';
import { Decoder, type DecoderOutput } from './decoder';
import { outputsToText } from './pipeline';
import { patternOf, tokenize } from '../morse/code';
import { cer } from '../util/text';
import { mulberry32, gaussian } from '../util/random';

interface Fist {
  name: string;
  /** Allowed mean character error rate after the second pass. */
  max: number;
  dit: number; // ms
  dah: number;
  elem: number; // gap inside a character
  char: number; // gap between characters
  word: number;
  jitter: number; // relative sd
}

const FISTS: Fist[] = [
  { name: 'touch, short taps long pauses', max: 0.1, dit: 80, dah: 280, elem: 200, char: 600, word: 1300, jitter: 0.2 },
  { name: 'touch, slow beginner', max: 0.2, dit: 140, dah: 450, elem: 280, char: 900, word: 1800, jitter: 0.25 },
  { name: 'touch, quick', max: 0.1, dit: 60, dah: 200, elem: 140, char: 420, word: 900, jitter: 0.2 },
  { name: 'straight key, textbook 12 wpm', max: 0.02, dit: 100, dah: 300, elem: 100, char: 300, word: 700, jitter: 0.15 },
  { name: 'straight key, heavy weighting', max: 0.05, dit: 120, dah: 380, elem: 80, char: 380, word: 900, jitter: 0.18 },
  { name: 'straight key, 20 wpm', max: 0.02, dit: 60, dah: 180, elem: 60, char: 180, word: 420, jitter: 0.15 },
];

const TEXTS = ['VVV VVV', 'PARIS PARIS', 'CQ CQ DE K1ABC K', 'TNX FER CALL UR RST 579'];
const ROWS: string[] = [];

function key(text: string, f: Fist, seed: number): { down: number; up: number }[] {
  const rng = mulberry32(seed);
  const j = (ms: number) => Math.max(15, ms * (1 + gaussian(rng) * f.jitter)) / 1000;
  const out: { down: number; up: number }[] = [];
  let t = 0.5;
  let first = true;
  for (const tok of tokenize(text)) {
    if (tok === ' ') {
      t += j(f.word) - j(f.char);
      continue;
    }
    if (!first) t += j(f.char);
    first = false;
    const p = patternOf(tok)!;
    for (let i = 0; i < p.length; i++) {
      if (i) t += j(f.elem);
      const len = j(p[i] === '.' ? f.dit : f.dah);
      out.push({ down: t, up: t + len });
      t += len;
    }
  }
  return out;
}

/** Live decoding with 20 ms ticks, as the keyboard and touch keys run; then the second pass. */
function decode(marks: { down: number; up: number }[], initialWpm: number): { live: string; settled: string } {
  const d = new Decoder({ initialWpm });
  const out: DecoderOutput[] = [];
  marks.forEach((m, i) => {
    out.push(...d.keyDown(m.down));
    out.push(...d.keyUp(m.up));
    const next = marks[i + 1]?.down ?? m.up + 5;
    for (let t = m.up + 0.02; t < next; t += 0.02) out.push(...d.tick(t));
  });
  const end = marks[marks.length - 1].up;
  out.push(...d.flush(end + 5));
  const settled = Decoder.redecode(d.model(), marks.map((m) => ({ start: m.down, end: m.up })));
  return { live: outputsToText(out), settled: outputsToText(settled) };
}

describe('hand keying', () => {
  for (const f of FISTS) {
    it(f.name, () => {
      const live: number[] = [];
      const settled: number[] = [];
      const samples: string[] = [];
      for (const wpm of [10, 15, 20, 25]) {
        for (const [k, text] of TEXTS.entries()) {
          const r = decode(key(text, f, 100 + k * 7 + wpm), wpm);
          live.push(cer(text, r.live));
          settled.push(cer(text, r.settled));
          if (k === 0 && wpm === 25) samples.push(`live: ${r.live} | settled: ${r.settled}`);
        }
      }
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      ROWS.push(
        `${f.name.padEnd(34)} live ${(mean(live) * 100).toFixed(1).padStart(5)}%  settled ${(mean(settled) * 100).toFixed(1).padStart(5)}% (worst ${(Math.max(...settled) * 100).toFixed(0).padStart(2)}%)   start 25: ${samples.join('')}`,
      );
      expect(mean(settled)).toBeLessThanOrEqual(f.max);
    });
  }
  // The report that started this: V V V on a touch key read as EEET EEET EEET.
  // Random jitter sometimes draws a dah no longer than a dit beside it (seed 2:
  // a 127 ms dit and a 145 ms dah in one V), which no listener could separate,
  // so one miss in twenty is allowed.
  it('reads V V V from short taps and long pauses as V V V', () => {
    const touch = FISTS[0];
    const misses: string[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const r = decode(key('V V V', touch, seed), 15);
      if ((r.settled.match(/V/g) ?? []).length !== 3) misses.push(`seed ${seed}: ${r.settled}`);
    }
    expect(misses.length, misses.join('; ')).toBeLessThanOrEqual(1);
  });

  afterAll(() => console.log(`\nHand keying scorecard (start speeds 10-25 wpm)\n${ROWS.join('\n')}\n`));
});
