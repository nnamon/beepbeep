// Words of one letter: V V V (a common warm-up), R R, E E. With no letter
// gaps in the over, the only gaps above those inside a letter are word gaps,
// and they must be read as word gaps, not as letter gaps (V V V as VVV).
// Joined letters (VVV, RR) must stay joined.

import { describe, expect, it } from 'vitest';
import { Decoder, markTuning, type DecoderOutput } from './decoder';
import { outputsToText } from './pipeline';
import { FISTS, keyText, type Fist } from './fists';
import { StableReading } from './stable';
import { buildSchedule } from '../morse/schedule';
import { cer } from '../util/text';

type Marks = { start: number; end: number }[];

/** Live decoding with 20 ms ticks, then the end-of-over read, as the screens run it. */
async function shown(marks: Marks, initialWpm: number): Promise<string> {
  const d = new Decoder({ initialWpm });
  const reading = new StableReading((m, mk, until, keep, full, prefer) => Promise.resolve(Decoder.redecode(m, mk, until, keep, full, prefer)));
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

// A beginner keys slower than the speed setting far more often than faster.
// EE keyed at 8 wpm with the setting at 15 read as T T: its 150 ms marks sit
// between that setting's dit (80 ms) and dah (240 ms), a little nearer the dah.
describe('the speed setting against the first marks', () => {
  const read = async (text: string, wpm: number, setting: number) => {
    const wrong: string[] = [];
    for (const seed of [1, 2, 3]) {
      const got = await shown(keyText(text, textbook(wpm, 7), 40 + seed), setting);
      if (got !== text) wrong.push(`${text} at ${wpm} wpm, set ${setting}: ${got}`);
    }
    return wrong;
  };

  it('reads slow dits as dits: EE at 8 wpm, the setting at 15', async () => {
    const wrong = await read('EE', 8, 15);
    expect(wrong, wrong.join('; ')).toEqual([]);
  });

  it('still reads quick dahs as dahs: TT and MM at 20 wpm, the setting at 15', async () => {
    const wrong = [...(await read('TT', 20, 15)), ...(await read('MM', 20, 15))];
    expect(wrong, wrong.join('; ')).toEqual([]);
  });

  it('the old even split read them as T T', async () => {
    const was = markTuning.slowFirst;
    markTuning.slowFirst = 0.5;
    try {
      expect((await read('EE', 8, 15)).length).toBe(3);
    } finally {
      markTuning.slowFirst = was;
    }
  });
});

// Practice groups of a Koch lesson's few characters (K M at lesson 1, then
// R, S, U; dah-heavy and all-dah ones such as T M O), read as the screen
// shows them. No language model expects them: before, the end-of-over search
// cut their letters into familiar words or ran them into digits (KKKMM MKMK
// KKMM as K K K MM MK MK K K MM, TTMT MMT as OM TMM, KSMKM as K3KM), and
// all-dah groups keyed faster than the setting read as dits (OTOOT as SESSE).
describe('practice groups of a few characters', () => {
  const GROUPS = [
    'KKKMM MKMK KKMM',
    'KMMMK KKMM MMKMM',
    'MKKM KMM MMK',
    'MKKK KKKM MMRM',
    'RMMKR KMMMM KKRK',
    'SKRR SKSK RSMR',
    'KRKK KSMKM MKMR',
    'TTMT MMT',
    'OTOOT OTOO TOOOO',
    'MTTTM TMTOM OTMTM',
    'TTOM MOMT TMTO',
    'OMOM TOOT MOMO',
  ];
  const textbookMarks = (text: string, wpm: number) => buildSchedule(text, { charWpm: wpm, leadIn: 0, tail: 0 }).marks.map((m) => ({ start: m.start, end: m.end }));

  // Before: 23 of 60 right.
  it('reads them with textbook timing, the setting at 15 wpm', { timeout: 180_000 }, async () => {
    const wrong: string[] = [];
    for (const text of GROUPS) {
      for (const wpm of [12, 15, 18, 20, 25]) {
        const got = await shown(textbookMarks(text, wpm), 15);
        if (got !== text) wrong.push(`${text} at ${wpm} wpm: ${got}`);
      }
    }
    expect(wrong, wrong.join('; ')).toEqual([]);
  });

  // Letters only: a beginner's word gaps are their own. The speed setting is
  // 20% under the sender's or 25% over. Before: 55.8% letter error, now
  // 35.2%. Groups of K, M and R read far better than all-dah ones (T M O),
  // whose dits and dahs only the gaps can tell apart. Some sends stay hard
  // for any listener (rushed letters run K and M together), so the bound is
  // on the average.
  it('reads them from beginner fists', async () => {
    let err = 0;
    let n = 0;
    for (const [i, text] of GROUPS.entries()) {
      for (const [j, f] of FISTS.entries()) {
        const setting = (i + j) % 2 ? 1.25 : 0.8;
        const got = await shown(keyText(text, f, 300 + text.length + 10 * setting), f.wpm * setting);
        err += cer(text.replace(/ /g, ''), got.replace(/ /g, ''));
        n++;
      }
    }
    console.log(`Groups from beginner fists: letter error ${((err / n) * 100).toFixed(1)}%`);
    expect(err / n).toBeLessThanOrEqual(0.38);
  }, 180_000);
});
