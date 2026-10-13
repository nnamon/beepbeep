// The Radio's detector as its AudioWorklet runs it (radio.worklet.ts): audio in,
// the detector's events out in batches, with the input level and how many
// channels have the key down. Plain TypeScript with no browser globals, so
// Node tests run the app's batching unchanged.

import { RadioDetector, type RadioEvent, type RadioOptions } from './detector';

/** Seconds of input between batches. The decoders take the time from each batch, so this is how often they tick. */
export const BATCH_SEC = 0.05;

/** Main thread to worklet. */
export type RadioCommand =
  /** A channel's decoder's dit, seconds: that channel's filter follows it. */
  | { type: 'dit'; ch: number; dit: number }
  | { type: 'spectrum' }
  /** The debug counter: how long the worklet has spent in each call. */
  | { type: 'stats' };

/** The detector's events since the last batch. */
export interface RadioBatch {
  type: 'events';
  events: RadioEvent[];
  /** Seconds of input processed. */
  time: number;
  /** How far behind `time` a key event can come out: decoders take the time as `time - lag`. */
  lag: number;
  /** Input level over the batch, dBFS RMS. */
  level: number;
  /** Channels with the key down now. */
  keying: number;
}

/** The worklet's debug counter since it started. */
export interface RadioStats {
  type: 'stats';
  /** Calls to `process` (render quanta) and the input they held, seconds. */
  quanta: number;
  audioSec: number;
  /** Time spent in them, ms in all, and the longest. */
  ms: number;
  maxMs: number;
  /** The clock it was timed with: performance.now(), or Date.now() (whole milliseconds) where a worklet has no performance clock. */
  clock: 'performance' | 'date';
}

/** Worklet to main thread. */
export type RadioMessage = RadioBatch | { type: 'spectrum'; hz: number[]; db: number[] } | RadioStats;

export class RadioRunner {
  readonly detector: RadioDetector;
  private events: RadioEvent[] = [];
  private lastPost = 0;
  private power = 0;
  private samples = 0;
  private down = new Set<number>();

  constructor(sampleRate: number, opts: RadioOptions = {}) {
    this.detector = new RadioDetector(sampleRate, opts);
  }

  /** One block of input (a render quantum in the worklet). Returns a batch when one is due. */
  process(input: Float32Array): RadioBatch | null {
    for (let i = 0; i < input.length; i++) this.power += input[i] * input[i];
    this.samples += input.length;
    for (const e of this.detector.process(input)) {
      this.events.push(e);
      if (e.type === 'key') {
        if (e.down) this.down.add(e.ch);
        else this.down.delete(e.ch);
      } else if (e.type === 'gone') this.down.delete(e.ch);
    }
    const time = this.detector.time;
    if (time - this.lastPost < BATCH_SEC) return null;
    this.lastPost = time;
    const batch: RadioBatch = {
      type: 'events',
      events: this.events,
      time,
      lag: this.detector.lag,
      level: 10 * Math.log10(this.power / Math.max(1, this.samples) + 1e-18),
      keying: this.down.size,
    };
    this.events = [];
    this.power = 0;
    this.samples = 0;
    return batch;
  }

  command(c: RadioCommand): RadioMessage | null {
    if (c.type === 'dit') this.detector.setDit(c.ch, c.dit);
    else if (c.type === 'spectrum') return { type: 'spectrum', ...this.detector.spectrum() };
    return null;
  }
}
