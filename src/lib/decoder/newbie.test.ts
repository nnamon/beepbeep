// Beginner keying, decoded as the app does: live, then the whole-over second
// pass at the end of the over. This scorecard is the decoder's real report
// card: the bar is copying beginners the way an experienced operator does.

import { afterAll, describe, expect, it } from 'vitest';
import { Decoder, type DecoderOutput } from './decoder';
import { outputsToText } from './pipeline';
import { FISTS, HELD_OUT_TEXTS, PRACTICE_TEXTS, keyText, type Fist } from './fists';
import { StableReading, WRITE_AFTER } from './stable';
import { cer } from '../util/text';

const ROWS: string[] = [];
const SHOWN: string[] = [];

/** Live decoding with 20 ms ticks, then the second pass. */
function settle(marks: { start: number; end: number }[], initialWpm: number): string {
  const d = new Decoder({ initialWpm });
  const out: DecoderOutput[] = [];
  marks.forEach((m, i) => {
    out.push(...d.keyDown(m.start), ...d.keyUp(m.end));
    const next = marks[i + 1]?.start ?? m.end + 5;
    for (let t = m.end + 0.02; t < next; t += 0.02) out.push(...d.tick(t));
  });
  out.push(...d.flush(marks[marks.length - 1].end + 5));
  return outputsToText(Decoder.redecode(d.model(), marks));
}

/**
 * As shown while keying: read again on every live letter, finished words
 * written down and kept (stable.ts), the rest read once more at the end of
 * the over. Also checks that no written word ever changes.
 */
async function shown(marks: { start: number; end: number }[], initialWpm: number): Promise<string> {
  const d = new Decoder({ initialWpm });
  const reading = new StableReading((m, mk, until, keep, full, prefer) => Promise.resolve(Decoder.redecode(m, mk, until, keep, full, prefer)));
  // Words shown with WRITE_AFTER marks after them, which must never change.
  let kept = '';
  const check = (outs: DecoderOutput[]) => {
    const text = outputsToText(outs);
    if (!text.startsWith(kept)) throw new Error(`rewrote "${kept}" as "${text}"`);
    let after = 0;
    for (let i = outs.length - 1; i >= 0; i--) {
      const o = outs[i];
      if (o.kind === 'char') after += o.char.marks.length;
      else if (i < outs.length - 1 && after >= WRITE_AFTER) {
        const k = outputsToText(outs.slice(0, i));
        if (k.length > kept.length) kept = k;
        break;
      }
    }
    return text;
  };
  const read = async (out: DecoderOutput[], t: number, n: number) => {
    if (out.length) check(await reading.update(d.model(), marks.slice(0, n), t));
  };
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    await read(d.keyDown(m.start), m.start, i);
    await read(d.keyUp(m.end), m.end, i + 1);
    const next = marks[i + 1]?.start ?? m.end + 5;
    for (let t = m.end + 0.02; t < next; t += 0.02) await read(d.tick(t), t, i + 1);
  }
  d.flush(marks[marks.length - 1].end + 5);
  return check(await reading.finish(d.model(), marks));
}

// Mean character error rate allowed per fist: measured on 11 Oct 2026, plus a
// margin. Regression guards, not targets; lower them as the decoder improves.
const MAX: Record<string, number> = {
  'newbie, short dahs': 0.33,
  'newbie, rushed letters': 0.34,
  'newbie, hesitant': 0.33,
  'newbie, speeding up': 0.18,
  'touch key, short taps': 0.13,
  'touch key, beginner': 0.26,
  'straight key, fair': 0.04,
  'clean, 20 wpm (control)': 0.005,
};

// The same, as shown while keying: measured on 11 Oct 2026 with words written
// down after 20 marks, plus a margin.
const MAX_SHOWN: Record<string, number> = {
  'newbie, short dahs': 0.31,
  'newbie, rushed letters': 0.25,
  'newbie, hesitant': 0.36,
  'newbie, speeding up': 0.22,
  'touch key, short taps': 0.13,
  'touch key, beginner': 0.25,
  'straight key, fair': 0.04,
  'clean, 20 wpm (control)': 0.005,
};

type Read = (marks: { start: number; end: number }[], initialWpm: number) => string | Promise<string>;

async function score(f: Fist, texts: string[], seed: number, read: Read) {
  const errs: number[] = [];
  for (const [k, text] of texts.entries()) {
    for (let s = 0; s < 2; s++) {
      // The live decoder starts from a speed guess that may be well off.
      errs.push(cer(text, await read(keyText(text, f, seed + k * 31 + s), f.wpm * [0.8, 1.25][s])));
    }
  }
  return errs;
}

async function card(f: Fist, read: Read, rows: string[]) {
  const practice = await score(f, PRACTICE_TEXTS, 1000, read);
  const held = await score(f, HELD_OUT_TEXTS, 2000, read);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const all = [...practice, ...held];
  rows.push(
    `${f.name.padEnd(26)} CER ${(mean(all) * 100).toFixed(1).padStart(5)}%  practice ${(mean(practice) * 100).toFixed(1).padStart(5)}%  held-out ${(mean(held) * 100).toFixed(1).padStart(5)}%  perfect ${all.filter((e) => e === 0).length}/${all.length}`,
  );
  return mean(all);
}

describe('beginner keying', () => {
  for (const f of FISTS) {
    it(f.name, async () => {
      expect(await card(f, settle, ROWS)).toBeLessThanOrEqual(MAX[f.name]);
    });
  }
  afterAll(() => console.log(`\nBeginner keying scorecard (second pass)\n${ROWS.join('\n')}\n`));
});

describe('beginner keying, as shown while keying', () => {
  for (const f of FISTS) {
    it(f.name, async () => {
      expect(await card(f, shown, SHOWN)).toBeLessThanOrEqual(MAX_SHOWN[f.name]);
    }, 120_000);
  }
  afterAll(() => console.log(`\nBeginner keying scorecard (as shown while keying)\n${SHOWN.join('\n')}\n`));
});

// The language knowledge settles what timing leaves open; it must never
// "correct" a letter that was sent clearly. Plausible wrong text, sent well,
// decodes as sent.
describe('no correcting what was sent clearly', () => {
  const cases = ['TNX FEB CALL', 'CQ CQ DE K1ABD K', 'NAME IS TIM', 'UR RST 589 589', 'QTH BOSTIN MA', 'THE QUIKC BROWN FOX'];
  for (const fist of [FISTS.find((f) => f.name.startsWith('clean'))!, FISTS.find((f) => f.name.startsWith('straight'))!]) {
    it(fist.name, () => {
      for (const [k, text] of cases.entries()) {
        for (let s = 0; s < 3; s++) {
          const marks = keyText(text, { ...fist, hesitate: 0 }, 3000 + k * 13 + s);
          expect(settle(marks, fist.wpm), `${text} seed ${s}`).toBe(text);
        }
      }
    });
  }
});
