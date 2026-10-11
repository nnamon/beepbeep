// Beginner keying, decoded as the app does: live, then the whole-over second
// pass at the end of the over. This scorecard is the decoder's real report
// card: the bar is copying beginners the way an experienced operator does.

import { afterAll, describe, expect, it } from 'vitest';
import { Decoder, type DecoderOutput } from './decoder';
import { outputsToText } from './pipeline';
import { FISTS, HELD_OUT_TEXTS, PRACTICE_TEXTS, keyText, type Fist } from './fists';
import { cer } from '../util/text';

const ROWS: string[] = [];

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

function score(f: Fist, texts: string[], seed: number) {
  const errs: number[] = [];
  for (const [k, text] of texts.entries()) {
    for (let s = 0; s < 2; s++) {
      // The live decoder starts from a speed guess that may be well off.
      errs.push(cer(text, settle(keyText(text, f, seed + k * 31 + s), f.wpm * [0.8, 1.25][s])));
    }
  }
  return errs;
}

describe('beginner keying', () => {
  for (const f of FISTS) {
    it(f.name, () => {
      const practice = score(f, PRACTICE_TEXTS, 1000);
      const held = score(f, HELD_OUT_TEXTS, 2000);
      const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
      const all = [...practice, ...held];
      ROWS.push(
        `${f.name.padEnd(26)} CER ${(mean(all) * 100).toFixed(1).padStart(5)}%  practice ${(mean(practice) * 100).toFixed(1).padStart(5)}%  held-out ${(mean(held) * 100).toFixed(1).padStart(5)}%  perfect ${all.filter((e) => e === 0).length}/${all.length}`,
      );
      expect(mean(all)).toBeLessThanOrEqual(MAX[f.name]);
    });
  }
  afterAll(() => console.log(`\nBeginner keying scorecard (second pass)\n${ROWS.join('\n')}\n`));
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
