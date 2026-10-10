// Turns text into a keying schedule: when the tone is on, element by element.
// A "fist" adds the human variation real operators have.

import { patternOf, tokenize } from './code';
import { spacing } from './timing';
import { gaussian, mulberry32 } from '../util/random';

export interface FistOptions {
  /** Timing jitter, as a standard deviation in fractions of a dit (0.1 = 10%). */
  jitter?: number;
  /** Weighting in fractions of a dit: added to every mark, taken from the gap after it. */
  weight?: number;
  /** Dah length in dits (standard 3). */
  dahRatio?: number;
  /** Multiplier on character gaps (hand senders often run 0.8 to 1.3). */
  charGapScale?: number;
  /** Multiplier on word gaps. */
  wordGapScale?: number;
  /** Total fractional speed change over the text: 0.3 ends 30% faster. */
  drift?: number;
  /** Bug (semi-automatic key): machine-timed dits, hand-timed heavier dahs. */
  bug?: boolean;
  seed?: number;
}

export interface ScheduleOptions {
  charWpm: number;
  effectiveWpm?: number;
  fist?: FistOptions;
  /** Silence before the first mark, seconds. */
  leadIn?: number;
  /** Silence after the last mark, seconds. */
  tail?: number;
}

export interface Mark {
  start: number;
  end: number;
  kind: 'dit' | 'dah';
  charIndex: number;
}

export interface CharSpan {
  /** Token (letter, digit, <PROSIGN>) or ' ' for a word break. */
  token: string;
  start: number;
  end: number;
}

export interface Schedule {
  marks: Mark[];
  chars: CharSpan[];
  duration: number;
  /** Nominal dit length at the start, seconds. */
  dit: number;
  text: string;
}

export function buildSchedule(text: string, opts: ScheduleOptions): Schedule {
  const tokens = tokenize(text);
  const sp = spacing(opts.charWpm, opts.effectiveWpm ?? opts.charWpm);
  const fist = opts.fist ?? {};
  const rng = mulberry32(fist.seed ?? 1);
  const jitter = fist.jitter ?? 0;
  const weight = fist.weight ?? 0;
  const dahRatio = fist.dahRatio ?? (fist.bug ? 3.4 : 3);
  const charScale = fist.charGapScale ?? 1;
  const wordScale = fist.wordGapScale ?? 1;
  const drift = fist.drift ?? 0;

  const marks: Mark[] = [];
  const chars: CharSpan[] = [];
  let t = opts.leadIn ?? 0.3;
  const n = Math.max(1, tokens.length - 1);

  const vary = (base: number, sigma: number) =>
    Math.max(base * 0.25, base + gaussian(rng) * sigma);

  for (let ti = 0; ti < tokens.length; ti++) {
    const token = tokens[ti];
    // Speed scale for drift: later elements get shorter as speed rises.
    const scale = 1 / (1 + drift * (ti / n));
    const dit = sp.dit * scale;

    if (token === ' ') {
      chars.push({ token, start: t, end: t });
      continue;
    }
    const pattern = patternOf(token);
    if (!pattern) continue;
    const charIndex = chars.length;
    const start = t;
    for (let ei = 0; ei < pattern.length; ei++) {
      const isDit = pattern[ei] === '.';
      const base = (isDit ? 1 : dahRatio) * dit + weight * dit;
      const sigma = fist.bug ? (isDit ? 0.02 : jitter * 1.5) * dit : jitter * dit;
      const len = vary(base, sigma);
      marks.push({ start: t, end: t + len, kind: isDit ? 'dit' : 'dah', charIndex });
      t += len;
      if (ei < pattern.length - 1) {
        const gapBase = Math.max(dit * 0.3, dit - weight * dit);
        t += vary(gapBase, (fist.bug && isDit ? 0.02 : jitter) * dit);
      }
    }
    chars.push({ token, start, end: t });

    // Gap after the character: word gap if a space follows, else character gap.
    const next = tokens[ti + 1];
    if (next === undefined) break;
    const extra = -weight * dit;
    if (next === ' ') {
      const g = sp.wordGap * scale * wordScale + extra;
      t += vary(Math.max(g, 3 * dit), jitter * dit * 2);
    } else {
      const g = sp.charGap * scale * charScale + extra;
      t += vary(Math.max(g, 1.5 * dit), jitter * dit * 1.5);
    }
  }

  return {
    marks,
    chars,
    duration: t + (opts.tail ?? 0.4),
    dit: sp.dit,
    text: tokens.join(''),
  };
}

/** Total length in seconds without building the whole schedule's audio. */
export function scheduleDuration(text: string, opts: ScheduleOptions): number {
  return buildSchedule(text, opts).duration;
}

/** A schedule from measured marks (e.g. your own sending), re-based to start at `leadIn`. */
export function scheduleFromMarks(marks: { start: number; end: number }[], leadIn = 0.15, tail = 0.3): Schedule {
  if (!marks.length) return { marks: [], chars: [], duration: leadIn + tail, dit: 0.08, text: '' };
  const t0 = marks[0].start - leadIn;
  const out: Mark[] = marks.map((m) => ({ start: m.start - t0, end: m.end - t0, kind: 'dit', charIndex: 0 }));
  return { marks: out, chars: [], duration: out[out.length - 1].end + tail, dit: 0.08, text: '' };
}
