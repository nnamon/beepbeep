// Running a detector over a scene the way the browser does (128-sample
// blocks, the decoder's speed fed back), and scoring what comes out.

import { Decoder, isGlitch } from '../../src/lib/decoder/decoder';
import { applyEvents, outputsToText } from '../../src/lib/decoder/pipeline';
import { cer } from '../../src/lib/util/text';
import type { DetectorEvent, DetectorOptions } from '../../src/lib/dsp/detector';
import type { Mark } from './scene';

/** Any detector version: key events and status ticks are all the runner reads. */
export interface DetectorLike {
  process(input: Float32Array): ({ type: 'key'; down: boolean; t: number } | { type: 'status' | 'lock'; t: number })[];
  setDit(dit: number): void;
  readonly time: number;
}

export type MakeDetector = (fs: number, opts: DetectorOptions) => DetectorLike;

export interface Reading {
  marks: Mark[];
  text: string;
}

export function read(make: MakeDetector, samples: Float32Array, fs: number, pinnedHz: number | null, wpm: number): Reading {
  const det = make(fs, { pinnedHz, dit: 1.2 / wpm });
  const dec = new Decoder({ initialWpm: wpm });
  const marks: Mark[] = [];
  let down: number | null = null;
  for (let i = 0; i < samples.length; i += 128) {
    const events = det.process(samples.subarray(i, Math.min(samples.length, i + 128)));
    for (const e of events) {
      if (e.type !== 'key') continue;
      if (e.down) down = e.t;
      else if (down !== null) {
        if (!isGlitch(e.t - down, dec.ditEstimate)) marks.push({ start: down, end: e.t });
        down = null;
      }
    }
    applyEvents(dec, events as DetectorEvent[]);
    dec.tick(det.time);
    det.setDit(dec.ditEstimate);
  }
  return { marks, text: decodeMarks(marks, dec) };
}

/** The whole-over reading of a set of marks, as the app shows it at the end of an over. */
export function decodeMarks(marks: Mark[], dec?: Decoder): string {
  if (!marks.length) return '';
  let d = dec;
  if (!d) {
    d = new Decoder({ initialWpm: 15 });
    for (const m of marks) {
      d.keyDown(m.start);
      d.keyUp(m.end);
    }
  }
  return outputsToText(Decoder.redecode(d.model(), marks));
}

export interface MarkScore {
  precision: number;
  recall: number;
  /** Median absolute error of matched starts and ends, ms. */
  startMs: number;
  endMs: number;
}

/** Detected marks against true ones: matched one to one by overlap (at least half the shorter). */
export function scoreMarks(found: Mark[], truth: Mark[]): MarkScore {
  const used = new Set<number>();
  const ds: number[] = [];
  const de: number[] = [];
  let matched = 0;
  let j = 0;
  for (const f of found) {
    while (j < truth.length && truth[j].end < f.start) j++;
    for (let k = j; k < truth.length && truth[k].start <= f.end; k++) {
      if (used.has(k)) continue;
      const t = truth[k];
      const overlap = Math.min(f.end, t.end) - Math.max(f.start, t.start);
      if (overlap >= 0.5 * Math.min(f.end - f.start, t.end - t.start)) {
        used.add(k);
        matched++;
        ds.push(Math.abs(f.start - t.start) * 1000);
        de.push(Math.abs(f.end - t.end) * 1000);
        break;
      }
    }
  }
  const med = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[v.length >> 1] : NaN);
  return {
    precision: found.length ? matched / found.length : 1,
    recall: truth.length ? matched / truth.length : 1,
    startMs: med(ds),
    endMs: med(de),
  };
}

/** Letter error, spaces ignored: a beginner's word spacing is not what is scored. */
export const letterError = (truth: string, got: string) => cer(truth.replace(/ /g, ''), got.replace(/ /g, ''));

export const letters = (s: string) => s.replace(/ /g, '').length;
