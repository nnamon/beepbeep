// Words of one letter: V V V (a common warm-up), R R, E E. With no letter
// gaps in the over, the only gaps above those inside a letter are word gaps,
// and they must be read as word gaps, not as letter gaps (V V V as VVV).
// Joined letters (VVV, RR) must stay joined.

import { describe, expect, it } from 'vitest';
import { Decoder, type DecoderOutput } from './decoder';
import { outputsToText } from './pipeline';
import { FISTS, keyText, type Fist } from './fists';
import { StableReading } from './stable';

type Marks = { start: number; end: number }[];

/** Live decoding with 20 ms ticks, then the end-of-over read, as the screens run it. */
async function shown(marks: Marks, initialWpm: number): Promise<string> {
  const d = new Decoder({ initialWpm });
  const reading = new StableReading((m, mk, until, keep, full) => Promise.resolve(Decoder.redecode(m, mk, until, keep, full)));
  const read = async (out: DecoderOutput[], t: number, n: number) => {
    if (out.length) await reading.update(d.model(), marks.slice(0, n), t);
  };
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    await read(d.keyDown(m.start), m.start, i);
    await read(d.keyUp(m.end), m.end, i + 1);
    const next = marks[i + 1]?.start ?? m.end + 5;
    for (let t = m.end + 0.02; t < next; t += 0.02) await read(d.tick(t), t, i + 1);
  }
  d.flush(marks[marks.length - 1].end + 5);
  return outputsToText(await reading.finish(d.model(), marks));
}

const fair = FISTS.find((f) => f.name.startsWith('straight'))!;
/** Textbook timing with a little jitter, word gaps of `word` dits. */
const textbook = (wpm: number, word: number): Fist => ({ ...fair, wpm, word, jitter: 0.05, gapJitter: 0.05, perChar: 0.02, hesitate: 0 });

describe('words of one letter', () => {
  it('keeps the word spaces in textbook V V V, R R and E E', async () => {
    const wrong: string[] = [];
    let n = 0;
    const cases: [string, number[]][] = [
      ['V V V', [7, 10, 14]],
      ['R R', [7, 10, 14]],
      ['K K K', [7, 10, 14]],
      ['V V V V V', [7, 10, 14]],
      // A single gap: the language model knows the closing dit dit as EE as
      // well as E E, and at exactly 7 units the two readings tie.
      ['E E', [10, 14]],
    ];
    for (const [text, words] of cases) {
      for (const wpm of [8, 12, 18]) {
        for (const word of words) {
          n++;
          const got = await shown(keyText(text, textbook(wpm, word), wpm * 3 + word), wpm);
          if (got !== text) wrong.push(`${text} at ${wpm} wpm, word gap ${word}: ${got}`);
        }
      }
    }
    // Before: 0 of the 9 V V V, 0 of the 9 R R and 0 of the 6 E E came out right.
    expect(wrong, wrong.join('; ')).toEqual([]);
    expect(n).toBe(42);
  });

  it('keeps joined letters joined: VVV, RR, EE', async () => {
    const wrong: string[] = [];
    for (const text of ['VVV', 'RR', 'EE', 'VVV VVV', 'TEST']) {
      for (const wpm of [8, 12, 18]) {
        const got = await shown(keyText(text, textbook(wpm, 7), wpm * 5), wpm);
        if (got !== text) wrong.push(`${text} at ${wpm} wpm: ${got}`);
      }
    }
    expect(wrong, wrong.join('; ')).toEqual([]);
  });

  // The beginner fists of the scorecard (fists.ts), each sending V V V twelve
  // times from a speed guess 20% slow or 25% fast, read as the screen shows it.
  // Some sends have a word gap no longer than a letter gap, or a long gap
  // inside a V (read as S T), which no listener could copy as V V V.
  // Measured on 12 Oct 2026: 61 of 96 (before: 0).
  it('reads V V V from beginner fists', async () => {
    const rows: string[] = [];
    let right = 0;
    let n = 0;
    for (const f of FISTS) {
      let ok = 0;
      for (let s = 0; s < 12; s++) {
        const got = await shown(keyText('V V V', f, 700 + s), f.wpm * [0.8, 1.25][s % 2]);
        if (got === 'V V V') ok++;
      }
      rows.push(`${f.name}: ${ok}/12`);
      right += ok;
      n += 12;
    }
    console.log(`V V V from beginner fists: ${right}/${n} (${rows.join(', ')})`);
    expect(right / n, rows.join(', ')).toBeGreaterThanOrEqual(0.58);
  });
});
