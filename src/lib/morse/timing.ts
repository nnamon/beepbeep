// Morse timing on the PARIS standard: one word = 50 dit-units.

/** Seconds per dit at a given character speed. */
export function ditSeconds(wpm: number): number {
  return 1.2 / wpm;
}

/** Character speed (WPM) from a dit length in seconds. */
export function wpmFromDit(dit: number): number {
  return 1.2 / dit;
}

export interface Spacing {
  /** Dit length in seconds (sets the shape of every character). */
  dit: number;
  /** Gap between characters, seconds. */
  charGap: number;
  /** Gap between words, seconds. */
  wordGap: number;
}

/**
 * Spacing for a character speed and an effective (Farnsworth) speed, using the
 * ARRL formula: t_a = (60c - 37.2s) / (cs); char gap = 3t_a/19, word gap = 7t_a/19.
 * When effective >= character speed, spacing is standard 3 and 7 units.
 */
export function spacing(charWpm: number, effectiveWpm = charWpm): Spacing {
  const dit = ditSeconds(charWpm);
  if (effectiveWpm >= charWpm) {
    return { dit, charGap: 3 * dit, wordGap: 7 * dit };
  }
  const c = charWpm;
  const s = effectiveWpm;
  const ta = (60 * c - 37.2 * s) / (c * s);
  return { dit, charGap: (3 * ta) / 19, wordGap: (7 * ta) / 19 };
}
