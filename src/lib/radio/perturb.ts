// Key events for testing the Radio tab's channel decoder (channel.ts) without
// audio: the channels a detector would give for a band (band.ts), built from
// the truth of every mark, either exact or with the errors a real detector
// makes. Edges move a little, some marks are lost, a fade cuts a mark in two,
// noise and static add short false marks, and the two stations of a QSO on
// nearly one pitch come out as one channel.

import type { StationTruth } from './band';
import { Decoder, isGlitch, isHeld } from '../decoder/decoder';
import { outputsToText } from '../decoder/pipeline';
import { gaussian, mulberry32, type Rng } from '../util/random';

export interface Mark {
  start: number;
  end: number;
}

export interface DetectorErrors {
  /** Each edge moves at random by this much (standard deviation), as a fraction of the station's dit. */
  jitter: number;
  /** Share of marks lost. */
  drop: number;
  /** Share of marks cut in two by a short fade in the middle. */
  split: number;
  /** Short false marks from noise or static, per second, from 2 seconds before the first mark to 2 after the last. */
  falsePerSec: number;
}

export interface TestChannel {
  /** Where the detector would put it: its station's pitch, or the louder one's of a QSO pair. */
  pitch: number;
  /** The stations heard on it, by name. */
  stations: string[];
  marks: Mark[];
}

/** Stations taking turns within `pairHz` of each other (a QSO), as index pairs, nearest first. */
export function qsoPairs(truth: StationTruth[], pairHz: number): [number, number][] {
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
  const used = new Set<number>();
  const out: [number, number][] = [];
  for (const { i, j } of found) {
    if (used.has(i) || used.has(j)) continue;
    used.add(i);
    used.add(j);
    out.push([i, j]);
  }
  return out;
}

/** Overlapping or touching marks become one, as a detector hears them. */
export function joinMarks(marks: Mark[]): Mark[] {
  const sorted = [...marks].sort((a, b) => a.start - b.start);
  const out: Mark[] = [];
  for (const m of sorted) {
    const last = out[out.length - 1];
    if (last && m.start <= last.end + 0.002) last.end = Math.max(last.end, m.end);
    else out.push({ ...m });
  }
  return out;
}

/** One station's marks as a detector with these errors would give them. */
export function perturb(marks: Mark[], dit: number, e: DetectorErrors, rng: Rng): Mark[] {
  let out: Mark[] = [];
  for (const m of marks) {
    if (rng() < e.drop) continue;
    const len = m.end - m.start;
    if (rng() < e.split && len >= 0.8 * dit) {
      // A fade in the middle: a dropout of a fifth to nearly half a dit.
      const mid = m.start + len * (0.3 + 0.4 * rng());
      const hole = dit * (0.2 + 0.25 * rng());
      const a = { start: m.start, end: mid - hole / 2 };
      const b = { start: mid + hole / 2, end: m.end };
      if (a.end - a.start >= 0.15 * dit && b.end - b.start >= 0.15 * dit) {
        out.push(a, b);
        continue;
      }
    }
    out.push({ ...m });
  }
  out = out.map((m) => {
    const start = m.start + gaussian(rng) * e.jitter * dit;
    const end = m.end + gaussian(rng) * e.jitter * dit;
    return { start, end: Math.max(end, start + 0.005) };
  });
  if (e.falsePerSec > 0 && marks.length) {
    const from = marks[0].start - 2;
    const to = marks[marks.length - 1].end + 2;
    for (let t = from - Math.log(1 - rng()) / e.falsePerSec; t < to; t -= Math.log(1 - rng()) / e.falsePerSec) {
      out.push({ start: t, end: t + dit * (0.15 + 0.55 * rng()) });
    }
  }
  return joinMarks(out);
}

/**
 * The channels for a band: one per station, or with `merge` one for both
 * stations of each QSO within `pairHz` (default 40). With `errors`, each
 * station's marks carry them, drawn from `seed`.
 */
export function channelsOf(truth: StationTruth[], opts: { merge?: boolean; pairHz?: number; errors?: DetectorErrors; seed?: number } = {}): TestChannel[] {
  const rng = mulberry32(opts.seed ?? 1);
  const marksOf = (t: StationTruth) => (opts.errors ? perturb(t.marks, 1.2 / t.wpm, opts.errors, rng) : t.marks.map((m) => ({ ...m })));
  const pairs = opts.merge ? qsoPairs(truth, opts.pairHz ?? 40) : [];
  const out: TestChannel[] = [];
  const done = new Set<number>();
  truth.forEach((t, i) => {
    if (done.has(i)) return;
    const pair = pairs.find(([a, b]) => a === i || b === i);
    if (pair) {
      const [a, b] = pair;
      done.add(a);
      done.add(b);
      // The detector locks to the louder of the two.
      const loud = truth[a].levelDb >= truth[b].levelDb ? truth[a] : truth[b];
      out.push({ pitch: loud.pitch, stations: [truth[a].name, truth[b].name], marks: joinMarks([...marksOf(truth[a]), ...marksOf(truth[b])]) });
      return;
    }
    done.add(i);
    out.push({ pitch: t.pitch, stations: [t.name], marks: marksOf(t) });
  });
  return out;
}

/** A channel of noise alone: short false marks at `perSec` for `seconds`, as a detector might open on static. */
export function noiseChannel(seconds: number, perSec: number, seed: number): Mark[] {
  const rng = mulberry32(seed);
  const out: Mark[] = [];
  for (let t = -Math.log(1 - rng()) / perSec; t < seconds; t -= Math.log(1 - rng()) / perSec) {
    out.push({ start: t, end: t + 0.01 + 0.06 * rng() });
  }
  return joinMarks(out);
}

/**
 * Today's way of reading a channel, the decoder for your own keying: one
 * Decoder, glitches and held keys dropped, each over ended after 3 seconds
 * without a mark and read again as a whole (as radio.test.ts runs it).
 */
export function today(marks: Mark[]): string {
  const decoder = new Decoder({ initialWpm: 15 });
  const settled: string[] = [];
  let over: Mark[] = [];
  const settle = () => {
    if (over.length) settled.push(outputsToText(Decoder.redecode(decoder.model(), over)));
    over = [];
  };
  for (const m of marks) {
    if (over.length && m.start - over[over.length - 1].end >= 3) settle();
    decoder.keyDown(m.start);
    const d = m.end - m.start;
    if (!isGlitch(d, decoder.ditEstimate) && !isHeld(d, decoder.dahEstimate)) over.push(m);
    decoder.keyUp(m.end);
  }
  settle();
  return settled.filter(Boolean).join(' ');
}

/** What a channel decoder needs from its input. */
export interface KeyListener {
  keyDown(t: number): void;
  keyUp(t: number): void;
  tick(t: number): void;
  readonly text: string;
  readonly pending: string;
}

export interface FeedOptions {
  /** Seconds between ticks (default 0.05). */
  step?: number;
  /** Seconds of silence fed after the last mark (default 10). */
  tail?: number;
  /** Called after each key-up with the number of marks fed so far. */
  onMark?: (n: number) => void;
  /** Called after each tick. */
  onTick?: (t: number) => void;
}

/**
 * Feeds marks to a channel decoder as the detector would: key events in time
 * order, a tick every 50 ms, and 10 seconds of silence at the end. Returns
 * what it shows: text and pending.
 */
export function feed(dec: KeyListener, marks: Mark[], opts: FeedOptions = {}): string {
  if (!marks.length) return dec.text + dec.pending;
  const step = opts.step ?? 0.05;
  const events = marks.flatMap((m) => [
    { t: m.start, down: true },
    { t: m.end, down: false },
  ]);
  let k = 0;
  let n = 0;
  const end = marks[marks.length - 1].end + (opts.tail ?? 10);
  for (let t = Math.max(0, marks[0].start - 1); t < end; t += step) {
    while (k < events.length && events[k].t <= t) {
      const e = events[k++];
      if (e.down) dec.keyDown(e.t);
      else {
        dec.keyUp(e.t);
        opts.onMark?.(++n);
      }
    }
    dec.tick(t);
    opts.onTick?.(t);
  }
  return dec.text + dec.pending;
}
