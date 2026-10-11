// Simulated hand keying for decoder tests: the faults beginners actually make.
// Timing is in dit units scaled by a speed, with multiplicative (log-normal)
// jitter per element and per gap, a tempo that wanders per character and can
// drift across the over, and occasional hesitations.

import { patternOf, tokenize } from '../morse/code';
import { gaussian, mulberry32 } from '../util/random';

export interface Fist {
  name: string;
  /** Character speed from the dit length, wpm. */
  wpm: number;
  /** Dah length in dits (textbook 3). */
  dah: number;
  /** Gaps in dits: inside a letter (1), between letters (3), between words (7). */
  elem: number;
  char: number;
  word: number;
  /** Relative spread of each element and each gap. */
  jitter: number;
  gapJitter: number;
  /** Relative spread of tempo from one letter to the next. */
  perChar: number;
  /** Tempo change from the start of the over to the end (0.4: 40% faster). */
  drift: number;
  /** Chance that a gap carries a hesitation (2-3 times longer). */
  hesitate: number;
}

export const FISTS: Fist[] = [
  { name: 'newbie, short dahs', wpm: 12, dah: 2.1, elem: 1.2, char: 3, word: 6, jitter: 0.2, gapJitter: 0.3, perChar: 0.15, drift: 0, hesitate: 0.05 },
  { name: 'newbie, rushed letters', wpm: 14, dah: 2.8, elem: 1.1, char: 1.9, word: 4.5, jitter: 0.18, gapJitter: 0.3, perChar: 0.12, drift: 0, hesitate: 0.05 },
  { name: 'newbie, hesitant', wpm: 10, dah: 3, elem: 1.3, char: 3.5, word: 7, jitter: 0.2, gapJitter: 0.35, perChar: 0.2, drift: 0, hesitate: 0.15 },
  { name: 'newbie, speeding up', wpm: 12, dah: 2.7, elem: 1.2, char: 3, word: 6.5, jitter: 0.18, gapJitter: 0.3, perChar: 0.15, drift: 0.5, hesitate: 0.05 },
  { name: 'touch key, short taps', wpm: 15, dah: 3.4, elem: 2.5, char: 7.5, word: 16, jitter: 0.2, gapJitter: 0.25, perChar: 0.1, drift: 0, hesitate: 0.05 },
  { name: 'touch key, beginner', wpm: 9, dah: 3.2, elem: 2, char: 6.5, word: 13, jitter: 0.25, gapJitter: 0.3, perChar: 0.2, drift: 0, hesitate: 0.1 },
  { name: 'straight key, fair', wpm: 15, dah: 3, elem: 1, char: 3, word: 7, jitter: 0.12, gapJitter: 0.18, perChar: 0.08, drift: 0, hesitate: 0.02 },
  { name: 'clean, 20 wpm (control)', wpm: 20, dah: 3, elem: 1, char: 3, word: 7, jitter: 0.05, gapJitter: 0.08, perChar: 0.03, drift: 0, hesitate: 0 },
];

/** Practice material as sent: calls, reports, names, numbers, prosigns. */
export const PRACTICE_TEXTS = [
  'CQ CQ DE K1ABC K',
  'TNX FER CALL UR RST 579 579',
  'NAME IS TOM QTH BOSTON MA',
  'W1AW DE KD9XYZ 5NN 042 TU',
  'THE QUICK BROWN FOX JUMPS',
  '73 ES GL CUL <SK>',
  'VVV VVV',
  'PARIS PARIS',
];

/**
 * Held out: operating text with words, names and calls the language model has
 * not seen, to check that it helps without needing the exact text.
 */
export const HELD_OUT_TEXTS = [
  'KB2RTZ DE VE7QXA QSL',
  'MY RIG IS A HOMEBREW QRP',
  'OP JOSE HR NR TACOMA',
  'WX IS FOGGY ES CHILLY',
  'TNX FB RPT 449 449',
  'N4VQ DE G3YKP <KN>',
];

export function keyText(text: string, f: Fist, seed: number): { start: number; end: number }[] {
  const rng = mulberry32(seed);
  const unit = 1.2 / f.wpm;
  const ln = (sd: number) => Math.exp(gaussian(rng) * sd);
  const toks = tokenize(text);
  const letters = toks.filter((t) => t !== ' ').length;
  const out: { start: number; end: number }[] = [];
  let t = 0.5;
  let n = 0;
  let pendingSpace = false;
  for (const tok of toks) {
    if (tok === ' ') {
      pendingSpace = true;
      continue;
    }
    // Tempo for this letter: drift across the over, wander per letter.
    const tempo = unit / (1 + f.drift * (n / Math.max(1, letters - 1))) * ln(f.perChar);
    const hes = () => (rng() < f.hesitate ? 2 + rng() : 1);
    if (out.length) t += (pendingSpace ? f.word : f.char) * tempo * ln(f.gapJitter) * hes();
    pendingSpace = false;
    const p = patternOf(tok)!;
    for (let i = 0; i < p.length; i++) {
      if (i) t += f.elem * tempo * ln(f.gapJitter) * hes();
      const len = (p[i] === '.' ? 1 : f.dah) * tempo * ln(f.jitter);
      out.push({ start: t, end: t + len });
      t += len;
    }
    n++;
  }
  return out;
}
