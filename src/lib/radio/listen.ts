// The Radio's detector run offline over band audio (band.ts), for the tests
// and scorecards, in the two ways it has been read:
//
//  - `listenPlain`: each channel's key events into a plain Decoder of its
//    own, as the app's single-signal pipeline reads an over (glitches and
//    held keys dropped, an over ending after 3 seconds without a mark and
//    read again as a whole). The detector's own scorecard (detector.test.ts).
//  - `listenApp`: the app's own pipeline. The detector batched as the radio
//    worklet runs it (batch.ts), and its batches into the join the Radio
//    screen's source uses (join.ts), one ChannelDecoder per channel, with the
//    search run in place instead of in the worker.

import type { Band } from './band';
import { RadioDetector, type RadioEvent } from './detector';
import { RadioRunner } from './batch';
import { SignalJoin } from './join';
import type { RadioSignal } from './source';
import { Decoder, isGlitch, isHeld, type DecoderOutput } from '../decoder/decoder';
import { outputsToText } from '../decoder/pipeline';

/** Samples per call: an AudioWorklet's render quantum. */
export const BLOCK = 128;
/** Seconds without a mark that end an over in the plain pipeline (the app's default, settings.overTimeout). */
const OVER_END = 3;
/** The speed the plain pipeline's decoders start from: the app's default sending speed (settings.sendWpm). */
const START_WPM = 15;

/** The band with other random sounds (noise, static, voice, fading; machine keying keeps its timing): clips the detector was not tuned on. Seed 0 is the band as it is. */
export function reseeded(band: Band, seed: number): Band {
  if (!seed) return band;
  return {
    ...band,
    seed: (band.seed ?? 1) + 1000 * seed,
    stations: band.stations.map((s, i) => ((s.keying ?? 'machine') === 'machine' ? { ...s, seed: (s.seed ?? i + 1) + 1000 * seed } : s)),
  };
}

export interface Heard {
  ch: number;
  /** Pitch: the median of the channel's pitch as its marks ended. */
  hz: number;
  marks: { start: number; end: number }[];
  settled: string;
  live: string;
}

export interface Listening {
  channels: Heard[];
  events: RadioEvent[];
  /** Seconds spent in the detector alone. */
  detectorSec: number;
  /** For each key event, how far behind the input it came out, seconds. */
  lags: number[];
  /** When each channel was passed on (its first signal event), by channel. */
  liveAt: Map<number, number>;
}

/** The detector over a whole clip in 128-sample blocks, each channel into a plain decoder of its own. */
export function listenPlain(samples: Float32Array, fs: number, det = new RadioDetector(fs)): Listening {
  interface Track {
    decoder: Decoder;
    live: DecoderOutput[];
    settled: string[];
    over: { start: number; end: number }[];
    marks: { start: number; end: number }[];
    pitches: number[];
    hz: number;
    down: boolean;
    downAt: number;
    lastDit: number;
    open: boolean;
  }
  const tracks = new Map<number, Track>();
  const events: RadioEvent[] = [];
  const lags: number[] = [];
  const liveAt = new Map<number, number>();
  let detectorSec = 0;
  const settle = (k: Track) => {
    if (k.over.length) k.settled.push(outputsToText(Decoder.redecode(k.decoder.model(), k.over)));
    k.over = [];
  };
  for (let i = 0; i < samples.length; i += BLOCK) {
    const t0 = performance.now();
    const got = det.process(samples.subarray(i, Math.min(samples.length, i + BLOCK)));
    detectorSec += (performance.now() - t0) / 1000;
    for (const e of got) {
      events.push(e);
      let k = tracks.get(e.ch);
      // A new channel's marks so far come out with its first signal event: not counted.
      if (e.type === 'key' && liveAt.get(e.ch) !== det.time) lags.push(det.time - e.t);
      if (e.type === 'signal') {
        if (!liveAt.has(e.ch)) liveAt.set(e.ch, det.time);
        if (!k) {
          const decoder = new Decoder({ initialWpm: START_WPM });
          k = { decoder, live: [], settled: [], over: [], marks: [], pitches: [], hz: e.hz, down: false, downAt: 0, lastDit: decoder.ditEstimate, open: true };
          tracks.set(e.ch, k);
        }
        k.hz = e.hz;
        continue;
      }
      if (!k) throw new Error(`event for channel ${e.ch} before its signal`);
      if (e.type === 'gone') {
        if (k.down) throw new Error('channel gone with the key down');
        k.live.push(...k.decoder.flush(e.t + 10));
        settle(k);
        k.open = false;
        continue;
      }
      if (e.down) {
        if (k.down) throw new Error(`channel ${e.ch}: two key-downs`);
        k.down = true;
        k.downAt = e.t;
        k.live.push(...k.decoder.keyDown(e.t));
      } else {
        if (!k.down) throw new Error(`channel ${e.ch}: key-up without key-down`);
        if (e.t < k.downAt) throw new Error(`channel ${e.ch}: mark ends before it starts`);
        const d = e.t - k.downAt;
        if (d > 0) k.marks.push({ start: k.downAt, end: e.t });
        if (!isGlitch(d, k.decoder.ditEstimate) && !isHeld(d, k.decoder.dahEstimate)) {
          k.over.push({ start: k.downAt, end: e.t });
          k.pitches.push(k.hz);
        }
        k.down = false;
        k.live.push(...k.decoder.keyUp(e.t));
      }
    }
    const now = det.time - det.lag;
    for (const [ch, k] of tracks) {
      if (!k.open) continue;
      k.live.push(...k.decoder.tick(now));
      const dit = k.decoder.ditEstimate;
      if (Math.abs(dit - k.lastDit) / dit > 0.08) {
        k.lastDit = dit;
        det.setDit(ch, dit);
      }
      if (!k.down && k.over.length && now - k.over[k.over.length - 1].end >= OVER_END) settle(k);
    }
  }
  const channels: Heard[] = [];
  for (const [ch, k] of tracks) {
    if (k.open) {
      k.live.push(...k.decoder.flush(det.time + 10));
      settle(k);
    }
    const sorted = [...k.pitches].sort((a, b) => a - b);
    channels.push({ ch, hz: sorted.length ? sorted[sorted.length >> 1] : k.hz, marks: k.marks, settled: k.settled.join(' '), live: outputsToText(k.live) });
  }
  return { channels, events, detectorSec, lags, liveAt };
}

export interface AppListening {
  /** The screen's signals once the clip has ended and listening stopped (each over in progress read and written). */
  signals: RadioSignal[];
  /** Seconds spent in the worklet's work (the detector and its batching), and on the main thread's (the join and its decoders). */
  detectorSec: number;
  joinSec: number;
  /** The join's counts: marks decoded, marks the detector withdrew, key-downs that came out after their decoder's time had passed them. */
  counts: SignalJoin['counts'];
  /** Batches, and dits sent back to the detector. */
  batches: number;
  dits: number;
  /** The most signals the join held at once, live and ended. */
  most: { live: number; ended: number };
}

export interface AppOptions {
  /** Called after each batch, with the join and the batch's time (tests watch what the screen would show). */
  onBatch?: (join: SignalJoin, time: number) => void;
  /** Keep listening (stop not called) at the end of the clip. */
  keepListening?: boolean;
}

/** The app's pipeline over a whole clip: the worklet's batches into the screen source's join. */
export function listenApp(samples: Float32Array, fs: number, opts: AppOptions = {}): AppListening {
  const runner = new RadioRunner(fs);
  let at = 0;
  let dits = 0;
  const join = new SignalJoin({
    onDit: (ch, dit) => {
      dits++;
      runner.command({ type: 'dit', ch, dit });
    },
    clock: () => at,
    channel: { inPlace: true },
  });
  let detectorSec = 0;
  let joinSec = 0;
  let batches = 0;
  const most = { live: 0, ended: 0 };
  for (let i = 0; i < samples.length; i += BLOCK) {
    const t0 = performance.now();
    const b = runner.process(samples.subarray(i, Math.min(samples.length, i + BLOCK)));
    const t1 = performance.now();
    detectorSec += (t1 - t0) / 1000;
    if (!b) continue;
    batches++;
    at = b.time * 1000;
    join.feed(b.events, b.time, b.lag, at);
    joinSec += (performance.now() - t1) / 1000;
    const size = join.size;
    most.live = Math.max(most.live, size.live);
    most.ended = Math.max(most.ended, size.ended);
    opts.onBatch?.(join, b.time);
  }
  if (!opts.keepListening) {
    const t1 = performance.now();
    join.stop();
    joinSec += (performance.now() - t1) / 1000;
  }
  return { signals: join.list(), detectorSec, joinSec, counts: join.counts, batches, dits, most };
}
