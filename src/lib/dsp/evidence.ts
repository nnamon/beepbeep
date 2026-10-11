// Per-millisecond evidence that the sender's tone is on, from lock-in channels
// at its harmonics. Shared by the detector and the research benchmark (bench/),
// so the model is trained on exactly what runs in the app.
//
// Per harmonic h of the pitch f:
//   rise    its level over a floor (dB), the floor tracking the 20th
//           percentile of the level so a busy stretch of keying cannot lift it
//   steady  how steadily its phase turns at h times the sender's pitch offset
//           (phase against itself 4 ms earlier, smoothed over 4 ms): 1 for a
//           steady tone at the sender's pitch, falling toward 0 for a gliding
//           voice harmonic or noise
//   fall    its level below its own maximum over the last 40 ms (dB, 0 to
//           -60): the fading tail after a mark is steady but falls away from
//           the mark within those 40 ms; a held tone stays at 0. Nothing older
//           than 40 ms affects it, so a loud event cannot colour what follows.
//
// See docs/research/hearing-the-key.md (E2: pitch steadiness is the strongest
// single cue; harmonics help only when the tone has them).

import { LowPass } from './biquad';

/** Harmonics a rich tone is listened to on. */
export const RICH = [1, 2, 3, 4, 5];

/** Features per harmonic, in the order the model weights expect. */
export const PER_HARMONIC = 3;

class Ear {
  private cos = 1;
  private sin = 0;
  private stepCos = 1;
  private stepSin = 0;
  private renorm = 0;
  private readonly lpI: LowPass;
  private readonly lpQ: LowPass;
  private i = 0;
  private q = 0;
  // Phase steadiness state.
  private readonly zRe = new Float64Array(8);
  private readonly zIm = new Float64Array(8);
  private zPos = 0;
  private zCount = 0;
  private wRe = 0;
  private wIm = 0;
  private wMag = 0;
  // Floor, and the last 40 ms of level.
  private floor = 0;
  private warm: number[] = [];
  private readonly past = new Float64Array(40).fill(-180);
  private pastPos = 0;

  constructor(
    private readonly fs: number,
    readonly harmonic: number,
    cutoff: number,
  ) {
    this.lpI = new LowPass(fs, cutoff);
    this.lpQ = new LowPass(fs, cutoff);
  }

  tune(hz: number) {
    const w = (2 * Math.PI * hz * this.harmonic) / this.fs;
    this.stepCos = Math.cos(w);
    this.stepSin = Math.sin(w);
  }

  setCutoff(fc: number) {
    this.lpI.setCutoff(fc);
    this.lpQ.setCutoff(fc);
  }

  step(x: number) {
    const c = this.cos * this.stepCos - this.sin * this.stepSin;
    const s = this.sin * this.stepCos + this.cos * this.stepSin;
    this.cos = c;
    this.sin = s;
    if (++this.renorm >= 1024) {
      this.renorm = 0;
      const m = Math.hypot(this.cos, this.sin);
      this.cos /= m;
      this.sin /= m;
    }
    this.i = this.lpI.step(x * c);
    this.q = this.lpQ.step(x * s);
  }

  /** Once per millisecond: level, rise over the floor, and steadiness at `offset` Hz from the lock. `hold` freezes the floor. */
  frame(ms: number, offset: number, hold = false): { level: number; rise: number; steady: number; fall: number; coherence: number; pitch: number } {
    const level = 20 * Math.log10(2 * Math.hypot(this.i, this.q) + 1e-9);
    // Floor: the 20th percentile of the level, from the median of the first
    // 300 ms, settling fast for a second, then 2.5 dB/s up and 10 dB/s down.
    if (hold) {
      // Frozen: the app is sending, and its own sound must not set the floor.
    } else if (ms < 300) {
      this.warm.push(level);
      const sorted = [...this.warm].sort((a, b) => a - b);
      this.floor = sorted[Math.floor(sorted.length * 0.2)];
    } else {
      const k = ms < 1000 ? 5 : 1;
      this.floor += level > this.floor ? 0.0025 * k : -0.01 * k;
    }
    // Steadiness: the phasor against itself 4 ms earlier.
    const n = this.zRe.length;
    if (this.zCount >= 4) {
      const j = (this.zPos - 4 + n) % n;
      const pr = this.zRe[j];
      const pi = this.zIm[j];
      const a = 1 - Math.exp(-1 / 4);
      this.wRe += (this.i * pr + this.q * pi - this.wRe) * a;
      this.wIm += (this.q * pr - this.i * pi - this.wIm) * a;
      this.wMag += (Math.hypot(this.i, this.q) * Math.hypot(pr, pi) - this.wMag) * a;
    }
    this.zRe[this.zPos] = this.i;
    this.zIm[this.zPos] = this.q;
    this.zPos = (this.zPos + 1) % n;
    this.zCount++;
    const coherence = Math.hypot(this.wRe, this.wIm) / (this.wMag + 1e-30);
    const pitch = Math.atan2(this.wIm, this.wRe) / (2 * Math.PI * 0.004) / this.harmonic;
    const steady = Math.max(0, Math.min(1, (coherence - 0.3) / 0.6)) * Math.max(0, 1 - Math.abs(pitch - offset) / 20);
    this.past[this.pastPos] = level;
    this.pastPos = (this.pastPos + 1) % this.past.length;
    let recent = -180;
    for (let k = 0; k < this.past.length; k++) if (this.past[k] > recent) recent = this.past[k];
    const fall = Math.max(-60, level - recent);
    return { level, rise: level - this.floor, steady, fall, coherence, pitch };
  }
}

export interface EvidenceFrame {
  /** Per harmonic: rise (dB over its floor), steadiness (0..1), fall below its last 40 ms (dB). */
  rise: number[];
  steady: number[];
  fall: number[];
  /** Each harmonic's level, dBFS. */
  levels: number[];
  /** The fundamental's level (dBFS), coherence, and measured pitch offset from the lock (Hz). */
  level: number;
  coherence: number;
  pitch: number;
}

/** Lock-in channels at a pitch's harmonics, read once a millisecond. */
export class Evidence {
  private readonly ears: Ear[];
  private readonly decim: number;
  private count = 0;
  private ms = 0;

  constructor(
    private readonly fs: number,
    harmonics: number[],
    cutoff: number,
  ) {
    this.ears = harmonics.map((h) => new Ear(fs, h, cutoff));
    this.decim = Math.max(1, Math.round(fs / 1000));
  }

  tune(hz: number) {
    for (const e of this.ears) e.tune(hz);
  }

  setCutoff(fc: number) {
    for (const e of this.ears) e.setCutoff(fc);
  }

  /** One input sample; a frame each millisecond, else null. `offset`: the sender's pitch from the lock, Hz. `hold`: floors frozen. */
  step(x: number, offset: number, hold = false): EvidenceFrame | null {
    for (const e of this.ears) e.step(x);
    if (++this.count < this.decim) return null;
    this.count = 0;
    const frames = this.ears.map((e) => e.frame(this.ms, offset, hold));
    this.ms++;
    return {
      rise: frames.map((f) => f.rise),
      steady: frames.map((f) => f.steady),
      fall: frames.map((f) => f.fall),
      levels: frames.map((f) => f.level),
      level: frames[0].level,
      coherence: frames[0].coherence,
      pitch: frames[0].pitch,
    };
  }
}

/** The model's input row for a frame: per harmonic, rise, steadiness and fall. */
export function featureRow(f: EvidenceFrame): number[] {
  const row: number[] = [];
  for (let h = 0; h < f.rise.length; h++) row.push(f.rise[h], f.steady[h], f.fall[h]);
  return row;
}

/** A small network: standardised inputs, one tanh hidden layer, a logit out. */
export interface Mlp {
  mu: number[];
  sd: number[];
  w1: number[][];
  b1: number[];
  w2: number[];
  b2: number;
}

/** Logit that the tone is on. */
export function mlpLogit(row: number[], m: Mlp): number {
  let z = m.b2;
  for (let u = 0; u < m.w2.length; u++) {
    let a = m.b1[u];
    const w = m.w1[u];
    for (let j = 0; j < row.length; j++) a += w[j] * ((row[j] - m.mu[j]) / m.sd[j]);
    z += m.w2[u] * Math.tanh(a);
  }
  return z;
}
