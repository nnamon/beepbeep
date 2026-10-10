// Fist analysis: measured element and gap lengths of your sending, in units.

import type { DecodedChar, DecoderOutput } from '../decoder/decoder';

export interface FistReport {
  /** Characters measured. */
  chars: number;
  /** Speed from the unit length, WPM. */
  wpm: number;
  /** Unit length, seconds: mean of dit and element gap, so weighting cancels out. */
  unit: number;
  /** Dah length over dit length (standard 3). */
  dahRatio: number;
  /** Gaps in units (standard 1, 3, 7). */
  elemGap: number;
  charGap: number;
  wordGap: number | null;
  /** Dit over element gap (1 = standard; >1 heavy, <1 light). */
  weighting: number;
  /** Speed change across the sample, WPM per minute. */
  drift: number;
  /** Spread of dit lengths, as a fraction of the mean. */
  ditSpread: number;
  /** Share of characters whose element timings fit their classes cleanly (decoder confidence >= 0.5). */
  clean: number;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
};

export function analyseFist(outputs: DecoderOutput[]): FistReport | null {
  const chars: DecodedChar[] = [];
  const wordGaps: number[] = [];
  const charGaps: number[] = [];
  let prev: DecodedChar | null = null;
  let spaceSincePrev = false;
  for (const o of outputs) {
    if (o.kind === 'space') {
      spaceSincePrev = true;
      continue;
    }
    const c = o.char;
    if (prev) {
      const g = c.start - prev.end;
      if (spaceSincePrev) wordGaps.push(g);
      else charGaps.push(g);
    }
    chars.push(c);
    prev = c;
    spaceSincePrev = false;
  }
  if (chars.length < 2) return null;

  const dits: number[] = [];
  const dahs: number[] = [];
  const elem: number[] = [];
  const perChar: { t: number; dit: number }[] = [];
  for (const c of chars) {
    const cd: number[] = [];
    c.marks.forEach((m, i) => {
      const d = m.end - m.start;
      if (m.kind === 'dit') {
        dits.push(d);
        cd.push(d);
      } else {
        dahs.push(d);
        cd.push(d / 3);
      }
      if (i > 0) elem.push(m.start - c.marks[i - 1].end);
    });
    perChar.push({ t: c.start, dit: mean(cd) });
  }
  const dit = mean(dits) || mean(dahs) / 3;
  const dah = mean(dahs) || dit * 3;
  const eg = mean(elem) || dit;
  const unit = (dit + eg) / 2;

  // Least-squares slope of per-character speed over time.
  // A trend needs a real sample: at least 10 characters over 20 seconds.
  let drift = 0;
  const spanSec = perChar.length ? perChar[perChar.length - 1].t - perChar[0].t : 0;
  if (perChar.length >= 10 && spanSec >= 20) {
    const xs = perChar.map((p) => p.t);
    const ys = perChar.map((p) => 1.2 / p.dit);
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    drift = den > 0 ? (num / den) * 60 : 0;
  }

  return {
    chars: chars.length,
    wpm: 1.2 / unit,
    unit,
    dahRatio: dah / dit,
    elemGap: eg / unit,
    charGap: charGaps.length ? mean(charGaps) / unit : 3,
    wordGap: wordGaps.length ? mean(wordGaps) / unit : null,
    weighting: dit / eg,
    drift,
    ditSpread: dits.length > 1 ? sd(dits) / dit : 0,
    clean: chars.filter((c) => c.confidence >= 0.5).length / chars.length,
  };
}

/**
 * How far one character's elements and the gaps inside it are from standard
 * timing at its own decoded speed: mean absolute error relative to each ideal
 * length (0 = textbook). Null for unknown characters.
 */
export function charTimingError(c: DecodedChar): number | null {
  if (!c.token || !c.marks.length || c.marks.length !== c.pattern.length) return null;
  const u = 1.2 / c.wpm;
  const errs: number[] = [];
  c.marks.forEach((m, i) => {
    const ideal = (c.pattern[i] === '-' ? 3 : 1) * u;
    errs.push(Math.abs(m.end - m.start - ideal) / ideal);
    if (i > 0) errs.push(Math.abs(m.start - c.marks[i - 1].end - u) / u);
  });
  return errs.reduce((a, b) => a + b, 0) / errs.length;
}
