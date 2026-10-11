// Scenes for the detector benchmark: a keyed sidetone with exactly known
// marks, mixed into a real or synthetic noise bed at a chosen SNR.
//
// SNR is measured where hearing measures it: the tone's fundamental against
// the noise power within one auditory filter of it (ERB, about 90 Hz at
// 600 Hz; Glasberg & Moore 1990), while the key is down. Broadband SNR says
// little about a narrow tone in broadband noise.

import { readFileSync } from 'node:fs';
import { FFT, hann } from '../../src/lib/dsp/fft';
import { readWav } from '../../src/lib/util/wav';
import { keyText, type Fist } from '../../src/lib/decoder/fists';
import { mulberry32 } from '../../src/lib/util/random';

export const FS = 48000;

export type Timbre = 'sine' | 'square' | 'buzzer';

/** Harmonic amplitudes relative to the fundamental. */
const HARMONICS: Record<Timbre, number[]> = {
  sine: [1],
  // A square wave filtered by a small speaker: odd harmonics, 1/k, rolled off.
  square: [1, 0, 1 / 3, 0, 1 / 5 * 0.8, 0, 1 / 7 * 0.6, 0, 1 / 9 * 0.4],
  // A piezo buzzer: strong 2nd and 3rd.
  buzzer: [1, 0.6, 0.7, 0.3, 0.25, 0.1],
};

export interface Tone {
  pitch: number;
  timbre: Timbre;
  /** Amplitude of the fundamental. */
  amplitude: number;
  /** Edge time, s (10–90%). */
  rise?: number;
}

export interface Keying {
  text: string;
  fist: Fist;
  seed: number;
}

export interface Mark {
  start: number;
  end: number;
}

/** Equivalent rectangular bandwidth of the auditory filter at f Hz. */
export const erb = (f: number) => 24.7 * (4.37 * (f / 1000) + 1);

/** The keyed sidetone, alone, `lead` seconds of silence before and after. */
export function renderTone(keying: Keying, tone: Tone, lead = 1): { samples: Float32Array; marks: Mark[] } {
  const raw = keyText(keying.text, keying.fist, keying.seed);
  const shift = lead - raw[0].start;
  const marks = raw.map((m) => ({ start: m.start + shift, end: m.end + shift }));
  const n = Math.ceil((marks[marks.length - 1].end + lead) * FS);
  const out = new Float32Array(n);
  const rise = tone.rise ?? 0.005;
  const h = HARMONICS[tone.timbre];
  const rng = mulberry32(keying.seed + 17);
  const phase0 = h.map(() => rng() * 2 * Math.PI);
  for (const m of marks) {
    const a = Math.max(0, Math.floor((m.start - rise) * FS));
    const b = Math.min(n, Math.ceil((m.end + rise) * FS));
    for (let i = a; i < b; i++) {
      const t = i / FS;
      // Raised-cosine edges centred on the mark's times.
      const up = Math.min(1, Math.max(0, (t - (m.start - rise / 2)) / rise));
      const down = Math.min(1, Math.max(0, (m.end + rise / 2 - t) / rise));
      const env = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(up, down));
      let x = 0;
      for (let k = 0; k < h.length; k++) if (h[k]) x += h[k] * Math.sin(2 * Math.PI * tone.pitch * (k + 1) * t + phase0[k]);
      out[i] += tone.amplitude * env * x;
    }
  }
  return { samples: out, marks };
}

/** Noise power in [lo, hi] Hz, per sample (Welch average of Hann-windowed FFTs). */
export function bandPower(x: Float32Array, lo: number, hi: number): number {
  const N = 8192;
  const fft = new FFT(N);
  const w = hann(N);
  const wsum = w.reduce((a, b) => a + b * b, 0);
  const binHz = FS / N;
  let acc = 0;
  let frames = 0;
  for (let s = 0; s + N <= x.length; s += N / 2) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * w[i];
    fft.transform(re, im);
    let p = 0;
    for (let k = Math.ceil(lo / binHz); k <= Math.floor(hi / binHz); k++) p += re[k] ** 2 + im[k] ** 2;
    acc += (2 * p) / (wsum * N);
    frames++;
  }
  return acc / Math.max(1, frames);
}

/** A noise bed at FS: a WAV (resampled if needed) or a synthetic source. */
export function loadBed(path: string): Float32Array {
  const { samples, sampleRate } = readWav(readFileSync(path));
  if (sampleRate === FS) return samples;
  // Linear interpolation: images land far above the 300–3600 Hz the detector uses.
  const r = FS / sampleRate;
  const out = new Float32Array(Math.floor(samples.length * r));
  for (let i = 0; i < out.length; i++) {
    const x = i / r;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = samples[j] * (1 - f) + (samples[Math.min(samples.length - 1, j + 1)] ?? 0) * f;
  }
  return out;
}

/** A segment of the bed, from `offset` seconds, `length` samples long (wrapping). */
export function segment(bed: Float32Array, offset: number, length: number): Float32Array {
  const out = new Float32Array(length);
  const o = Math.floor(offset * FS) % bed.length;
  for (let i = 0; i < length; i++) out[i] = bed[(o + i) % bed.length];
  return out;
}

/**
 * Tone plus noise, the noise scaled so the tone's fundamental is `snr` dB
 * above the noise within one ERB of it.
 */
export function mix(tone: Float32Array, noise: Float32Array, pitch: number, fundamental: number, snr: number): Float32Array {
  const half = erb(pitch) / 2;
  const pn = bandPower(noise, pitch - half, pitch + half);
  const ps = (fundamental * fundamental) / 2;
  const g = pn > 0 ? Math.sqrt(ps / pn / Math.pow(10, snr / 10)) : 0;
  const out = new Float32Array(tone.length);
  for (let i = 0; i < out.length; i++) out[i] = tone[i] + g * noise[i];
  return out;
}
