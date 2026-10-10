// Renders a keying schedule to audio samples, with optional band conditions.
// The same renderer feeds the speakers and the decoder's accuracy tests.

import { buildSchedule, type Schedule } from './schedule';
import { mulberry32, gaussian } from '../util/random';

export interface Conditions {
  /** White noise; SNR is measured in `bandwidthHz` around the tone (default 500 Hz). */
  noise?: { snrDb: number; bandwidthHz?: number };
  /** Fading: amplitude dips by up to `depth` (0..1) at about `rateHz`. */
  qsb?: { depth: number; rateHz: number };
  /** A second station: random text at an offset pitch and relative level. */
  qrm?: { text: string; offsetHz: number; relativeDb: number; wpm: number };
  /** Static crashes: bursts per second and their level relative to the signal. */
  qrn?: { ratePerSec: number; level: number };
  /** Frequency jump at each key-down that settles with time constant `tau` seconds. */
  chirp?: { hz: number; tau: number };
  /** Slow pitch drift. */
  drift?: { hzPerSec: number };
  /** Room echo: decay time in seconds and wet mix (0..1). */
  reverb?: { decay: number; mix: number };
}

export interface RenderOptions extends Conditions {
  sampleRate: number;
  pitch: number;
  /** Peak amplitude of the tone, 0..1. */
  amplitude?: number;
  /** Edge time in seconds; 50% points land exactly on the schedule's times. */
  rise?: number;
  seed?: number;
}

export function renderSchedule(schedule: Schedule, opts: RenderOptions): Float32Array {
  const fs = opts.sampleRate;
  const n = Math.ceil(schedule.duration * fs);
  const out = new Float32Array(n);
  const amp = opts.amplitude ?? 0.5;
  const rng = mulberry32(opts.seed ?? 7);

  addTone(out, schedule, opts.pitch, amp, opts, fs, rng);

  if (opts.qrm) {
    const q = opts.qrm;
    const other = buildSchedule(q.text, {
      charWpm: q.wpm,
      fist: { jitter: 0.08, seed: (opts.seed ?? 7) + 101 },
      leadIn: 0.1 + rng() * 0.6,
    });
    const qAmp = amp * Math.pow(10, q.relativeDb / 20);
    const qOut = new Float32Array(n);
    addTone(qOut, { ...other, duration: Math.min(other.duration, schedule.duration) }, opts.pitch + q.offsetHz, qAmp, { ...opts, chirp: undefined, qsb: undefined }, fs, rng);
    for (let i = 0; i < n; i++) out[i] += qOut[i];
  }

  if (opts.qrn) {
    const { ratePerSec, level } = opts.qrn;
    const crashes = Math.round(ratePerSec * schedule.duration);
    for (let c = 0; c < crashes; c++) {
      const at = Math.floor(rng() * n);
      const len = Math.floor((0.01 + rng() * 0.05) * fs);
      const peak = amp * level * (0.5 + rng());
      for (let i = 0; i < len && at + i < n; i++) {
        out[at + i] += gaussian(rng) * peak * Math.exp((-5 * i) / len);
      }
    }
  }

  if (opts.reverb && opts.reverb.mix > 0) applyReverb(out, fs, opts.reverb.decay, opts.reverb.mix);

  if (opts.noise) {
    const bw = opts.noise.bandwidthHz ?? 500;
    const ps = (amp * amp) / 2;
    const pn = ps / Math.pow(10, opts.noise.snrDb / 10);
    const sigma = Math.sqrt((pn * fs) / (2 * bw));
    for (let i = 0; i < n; i++) out[i] += gaussian(rng) * sigma;
  }

  for (let i = 0; i < n; i++) {
    if (out[i] > 1) out[i] = 1;
    else if (out[i] < -1) out[i] = -1;
  }
  return out;
}

function addTone(
  out: Float32Array,
  schedule: Schedule,
  pitch: number,
  amp: number,
  opts: RenderOptions,
  fs: number,
  rng: () => number,
) {
  const rise = opts.rise ?? 0.005;
  const half = rise / 2;
  const n = out.length;
  const env = new Float32Array(n);
  for (const m of schedule.marks) {
    const a = Math.max(0, Math.floor((m.start - half) * fs));
    const b = Math.min(n, Math.ceil((m.end + half) * fs));
    for (let i = a; i < b; i++) {
      const t = i / fs;
      let e = 1;
      if (t < m.start + half) e = 0.5 - 0.5 * Math.cos((Math.PI * (t - (m.start - half))) / rise);
      else if (t > m.end - half) e = 0.5 + 0.5 * Math.cos((Math.PI * (t - (m.end - half))) / rise);
      if (e > env[i]) env[i] = Math.min(1, Math.max(0, e));
    }
  }

  const qsbPhase1 = rng() * Math.PI * 2;
  const qsbPhase2 = rng() * Math.PI * 2;
  const chirp = opts.chirp;
  const drift = opts.drift?.hzPerSec ?? 0;
  let phase = 0;
  let markIdx = 0;
  let lastDown = -1;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    while (markIdx < schedule.marks.length && schedule.marks[markIdx].start <= t) {
      lastDown = schedule.marks[markIdx].start;
      markIdx++;
    }
    let f = pitch + drift * t;
    if (chirp && lastDown >= 0) f += chirp.hz * Math.exp(-(t - lastDown) / chirp.tau);
    phase += (2 * Math.PI * f) / fs;
    if (phase > 1e6) phase %= 2 * Math.PI;
    if (env[i] === 0) continue;
    let g = amp * env[i];
    if (opts.qsb) {
      const { depth, rateHz } = opts.qsb;
      const m =
        0.5 + 0.25 * Math.sin(2 * Math.PI * rateHz * t + qsbPhase1) +
        0.25 * Math.sin(2 * Math.PI * rateHz * 0.37 * t + qsbPhase2);
      g *= 1 - depth * m;
    }
    out[i] += g * Math.sin(phase);
  }
}

/** Schroeder-style room echo: four parallel combs, wet/dry mix. */
function applyReverb(x: Float32Array, fs: number, decay: number, mix: number) {
  const delays = [0.0297, 0.0371, 0.0411, 0.0437];
  const wet = new Float32Array(x.length);
  for (const d of delays) {
    const D = Math.max(1, Math.round(d * fs));
    const g = Math.pow(10, (-3 * d) / Math.max(0.05, decay));
    const buf = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
      buf[i] = x[i] + (i >= D ? g * buf[i - D] : 0);
      wet[i] += buf[i] / delays.length;
    }
  }
  for (let i = 0; i < x.length; i++) x[i] = (1 - mix) * x[i] + mix * wet[i];
}

/** Convenience: text straight to samples. */
export function renderText(
  text: string,
  opts: RenderOptions & { charWpm: number; effectiveWpm?: number; fist?: import('./schedule').FistOptions },
): { samples: Float32Array; schedule: Schedule } {
  const schedule = buildSchedule(text, {
    charWpm: opts.charWpm,
    effectiveWpm: opts.effectiveWpm,
    fist: opts.fist,
  });
  return { samples: renderSchedule(schedule, opts), schedule };
}
