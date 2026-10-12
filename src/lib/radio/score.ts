// Scores a decoder's reading of band audio against the truth (band.ts).
//
// The decoder gives a list of signals, each a pitch and the text read there.
// Each signal goes to the station nearest its pitch, if that is within
// `tolHz` of where the station's pitch goes while it sends; a signal near no
// station is false text. A station's error is the edit distance from its text
// to the best signal it got, in Morse tokens (a prosign is one, a run of
// spaces is one), and its character error rate that over the length of its
// text. More signals at the same station are false text too: the screen would
// show that station twice.
//
// Two stations taking turns within `pairHz` of each other (a QSO) may come out
// as one signal holding both sides, and that is a fair reading. Such a pair is
// scored both ways, as two signals against their own texts and as one signal
// against both sides in the order they were sent, and the better one counts.

import { editDistance, textTokens } from '../util/text';
import type { StationTruth } from './band';

export interface Signal {
  pitch: number;
  text: string;
}

export interface ScoreOptions {
  /** How far a signal may sit from a station's pitch and still be that station, Hz (default 30). */
  tolHz?: number;
  /** Stations taking turns this close are a pair that may be read as one signal, Hz (default 50). */
  pairHz?: number;
}

export interface StationScore {
  name: string;
  pitch: number;
  /** Tokens in its text (in the pair's text if joined), the edit distance of the reading, and their ratio. */
  length: number;
  errors: number;
  cer: number;
  /** The signal read as this station (an index into the output), or null. */
  signal: number | null;
  /** The other station, when the pair was scored as one signal. */
  joined: string | null;
}

export interface BandScore {
  stations: StationScore[];
  /** Characters (spaces aside) in signals that no station got, and those signals' indices. */
  falseChars: number;
  falseSignals: number[];
  /** All stations together, a joined pair counted once: errors, length and their ratio (NaN with no stations). */
  errors: number;
  length: number;
  cer: number;
}

/** How far a pitch is from a range, Hz. */
function away(hz: number, [lo, hi]: [number, number]): number {
  return hz < lo ? lo - hz : hz > hi ? hz - hi : 0;
}

/** Stations that take turns (no transmissions at the same time) within `pairHz`, nearest first. */
function pairs(truth: StationTruth[], pairHz: number): number[] {
  const partner = truth.map(() => -1);
  const found: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < truth.length; i++) {
    for (let j = i + 1; j < truth.length; j++) {
      const a = truth[i];
      const b = truth[j];
      const d = Math.max(0, Math.max(a.pitchRange[0], b.pitchRange[0]) - Math.min(a.pitchRange[1], b.pitchRange[1]));
      const overlap = a.sends.some((x) => b.sends.some((y) => x.start < y.end && y.start < x.end));
      if (d <= pairHz && !overlap) found.push({ i, j, d });
    }
  }
  found.sort((x, y) => x.d - y.d);
  for (const { i, j } of found) {
    if (partner[i] < 0 && partner[j] < 0) {
      partner[i] = j;
      partner[j] = i;
    }
  }
  return partner;
}

/** The signal among `candidates` nearest `want`, and its edit distance (all of `want` with none). */
function best(candidates: number[], tokens: string[][], want: string[]): { signal: number | null; errors: number } {
  let out: { signal: number | null; errors: number } = { signal: null, errors: want.length };
  for (const c of candidates) {
    const e = editDistance(want, tokens[c]);
    if (out.signal === null || e < out.errors) out = { signal: c, errors: e };
  }
  return out;
}

export function scoreBand(truth: StationTruth[], output: Signal[], opts: ScoreOptions = {}): BandScore {
  const tol = opts.tolHz ?? 30;
  const tokens = output.map((s) => textTokens(s.text));
  // Each signal to its nearest station within the tolerance.
  const owner = output.map((s) => {
    let at = -1;
    let near = Infinity;
    for (let i = 0; i < truth.length; i++) {
      const d = away(s.pitch, truth[i].pitchRange);
      if (d <= tol && d < near) {
        at = i;
        near = d;
      }
    }
    return at;
  });
  const owned = (i: number) => output.map((_, k) => k).filter((k) => owner[k] === i);
  const partner = pairs(truth, opts.pairHz ?? 50);
  const want = truth.map((t) => textTokens(t.text));

  const stations: StationScore[] = [];
  const used = new Set<number>();
  let errors = 0;
  let length = 0;
  const own = (i: number, r: { signal: number | null; errors: number }, joined: string | null, len = want[i].length): StationScore => ({
    name: truth[i].name,
    pitch: truth[i].pitch,
    length: len,
    errors: r.errors,
    cer: len ? r.errors / len : r.errors ? 1 : 0,
    signal: r.signal,
    joined,
  });

  truth.forEach((t, i) => {
    const j = partner[i];
    if (j >= 0 && j < i) return;
    const alone = best(owned(i), tokens, want[i]);
    if (j < 0) {
      stations[i] = own(i, alone, null);
      if (alone.signal !== null) used.add(alone.signal);
      errors += alone.errors;
      length += want[i].length;
      return;
    }
    // A pair: two signals, or one with both sides in the order they were sent.
    const other = best(owned(j), tokens, want[j]);
    const both = textTokens([...t.sends, ...truth[j].sends].sort((x, y) => x.start - y.start).map((s) => s.text).join(' '));
    const one = best([...owned(i), ...owned(j)], tokens, both);
    if (one.errors < alone.errors + other.errors) {
      stations[i] = own(i, one, truth[j].name, both.length);
      stations[j] = own(j, one, t.name, both.length);
      if (one.signal !== null) used.add(one.signal);
      errors += one.errors;
      length += both.length;
    } else {
      stations[i] = own(i, alone, null);
      stations[j] = own(j, other, null);
      for (const r of [alone, other]) if (r.signal !== null) used.add(r.signal);
      errors += alone.errors + other.errors;
      length += want[i].length + want[j].length;
    }
  });

  const falseSignals = output.map((_, k) => k).filter((k) => !used.has(k));
  const falseChars = falseSignals.reduce((n, k) => n + tokens[k].filter((x) => x !== ' ').length, 0);
  return { stations, falseChars, falseSignals, errors, length, cer: length ? errors / length : NaN };
}
