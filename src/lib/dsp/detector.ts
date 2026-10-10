// Microphone audio in, key-down/key-up times out.
//
// 1. A peak-hold FFT finds the strongest keyed tone in 300-1200 Hz and locks to it.
// 2. An I/Q (lock-in) detector at that pitch, with a low-pass sized to the
//    sending speed, gives a smooth tone envelope at ~1 kHz.
// 3. An adaptive threshold halfway between the tracked noise floor and the
//    tracked peak, with hysteresis and a debounce, turns it into key events.
//
// Runs unchanged in the AudioWorklet and in Node tests.

import { FFT, hann } from './fft';
import { LowPass } from './biquad';

export type DetectorEvent =
  | { type: 'key'; down: boolean; t: number }
  | { type: 'lock'; hz: number; t: number }
  | {
      type: 'status';
      t: number;
      /** Input level, dBFS RMS. */
      level: number;
      /** Locked pitch, or null while searching. */
      pitch: number | null;
      /** Peak over noise of the locked tone, dB. */
      snr: number;
      keyDown: boolean;
    };

export interface DetectorOptions {
  minHz?: number;
  maxHz?: number;
  /** Fixed pitch chosen by the user; skips the search. */
  pinnedHz?: number | null;
  /** Expected dit length in seconds (sets bandwidth and debounce). */
  dit?: number;
  /** Minimum peak-over-noise to treat anything as a signal, dB. */
  minSnrDb?: number;
}

const STATUS_INTERVAL = 0.05;

export class Detector {
  readonly fs: number;
  private minHz: number;
  private maxHz: number;
  private pinned: number | null;
  private minSnrDb: number;
  private dit: number;

  // Spectrum search
  private readonly fftSize: number;
  private readonly hop: number;
  private readonly fft: FFT;
  private readonly window: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly maxHold: Float64Array;
  private readonly minHold: Float64Array;
  private readonly fftBuf: Float32Array;
  private fftFill = 0;
  private sinceHop = 0;
  private candidateHz = 0;
  private candidateRuns = 0;
  private relockRuns = 0;

  // History so the first characters survive the time it takes to lock.
  private readonly history: Float32Array;
  private historyPos = 0;
  private historyCount = 0;

  // I/Q envelope
  private lockedHz: number | null = null;
  private cosP = 1;
  private sinP = 0;
  private stepCos = 1;
  private stepSin = 0;
  private renorm = 0;
  private lpI: LowPass;
  private lpQ: LowPass;
  private readonly decim: number;
  private decimCount = 0;
  private envPrev = 0;
  private tPrev = 0;

  // Key detection
  private noise = 0;
  private peak = 0;
  private envInit = false;
  private warmup = 0;
  private warmAcc = 0;
  private keyDown = false;
  private pendingState: boolean | null = null;
  private pendingT = 0;
  private pendingSince = 0;

  // Bookkeeping
  private sample = 0;
  private muted = false;
  private levelAcc = 0;
  private levelCount = 0;
  private nextStatus = STATUS_INTERVAL;

  constructor(sampleRate: number, opts: DetectorOptions = {}) {
    this.fs = sampleRate;
    this.minHz = opts.minHz ?? 300;
    this.maxHz = opts.maxHz ?? 1200;
    this.pinned = opts.pinnedHz ?? null;
    this.minSnrDb = opts.minSnrDb ?? 9;
    this.dit = opts.dit ?? 0.08;
    this.fftSize = sampleRate > 30000 ? 4096 : 2048;
    this.hop = this.fftSize / 2;
    this.fft = new FFT(this.fftSize);
    this.window = hann(this.fftSize);
    this.re = new Float64Array(this.fftSize);
    this.im = new Float64Array(this.fftSize);
    this.maxHold = new Float64Array(this.fftSize / 2);
    this.minHold = new Float64Array(this.fftSize / 2).fill(Infinity);
    this.fftBuf = new Float32Array(this.fftSize);
    this.history = new Float32Array(Math.round(sampleRate * 2.5));
    this.decim = Math.max(1, Math.round(sampleRate / 1000));
    this.lpI = new LowPass(sampleRate, this.cutoff());
    this.lpQ = new LowPass(sampleRate, this.cutoff());
    if (this.pinned) this.lock(this.pinned, false, []);
  }

  get time(): number {
    return this.sample / this.fs;
  }

  get pitch(): number | null {
    return this.lockedHz;
  }

  /** Feedback from the decoder: current dit estimate in seconds. */
  setDit(dit: number) {
    if (!(dit > 0)) return;
    const prev = this.cutoff();
    this.dit = Math.min(0.4, Math.max(0.02, dit));
    const next = this.cutoff();
    if (Math.abs(next - prev) / prev > 0.15) {
      this.lpI.setCutoff(next);
      this.lpQ.setCutoff(next);
    }
  }

  setPinned(hz: number | null, out: DetectorEvent[] = []) {
    this.pinned = hz;
    if (hz) this.lock(hz, false, out);
    return out;
  }

  /** While the app itself is sending, ignore input so it cannot decode itself. */
  setMuted(muted: boolean) {
    this.muted = muted;
  }

  /** Smoothed spectrum (dB) between lo and hi Hz, for the setup screen. */
  spectrum(lo = 200, hi = 1500): { hz: number[]; db: number[] } {
    const binHz = this.fs / this.fftSize;
    const hz: number[] = [];
    const db: number[] = [];
    for (let k = Math.floor(lo / binHz); k <= Math.ceil(hi / binHz) && k < this.maxHold.length; k++) {
      hz.push(k * binHz);
      db.push(10 * Math.log10(this.maxHold[k] + 1e-12));
    }
    return { hz, db };
  }

  process(input: Float32Array): DetectorEvent[] {
    const out: DetectorEvent[] = [];
    for (let i = 0; i < input.length; i++) {
      let x = input[i];
      if (this.muted) x = 0;
      this.levelAcc += input[i] * input[i];
      this.levelCount++;

      this.history[this.historyPos] = x;
      this.historyPos = (this.historyPos + 1) % this.history.length;
      if (this.historyCount < this.history.length) this.historyCount++;

      this.fftBuf[this.fftFill++] = x;
      if (this.fftFill === this.fftSize) {
        this.analyse(out);
        this.fftBuf.copyWithin(0, this.hop);
        this.fftFill = this.fftSize - this.hop;
      }

      if (this.lockedHz !== null) this.iqStep(x, this.sample, out);
      this.sample++;

      if (this.time >= this.nextStatus) {
        this.nextStatus += STATUS_INTERVAL;
        const rms = Math.sqrt(this.levelAcc / Math.max(1, this.levelCount));
        this.levelAcc = 0;
        this.levelCount = 0;
        out.push({
          type: 'status',
          t: this.time,
          level: 20 * Math.log10(rms + 1e-9),
          pitch: this.lockedHz,
          snr: this.snrDb(),
          keyDown: this.keyDown,
        });
      }
    }
    return out;
  }

  private cutoff(): number {
    return Math.min(250, Math.max(30, 4 / this.dit));
  }

  private snrDb(): number {
    if (!this.envInit || this.noise <= 0) return 0;
    return 20 * Math.log10(this.peak / this.noise);
  }

  private analyse(out: DetectorEvent[]) {
    const n = this.fftSize;
    for (let i = 0; i < n; i++) {
      this.re[i] = this.fftBuf[i] * this.window[i];
      this.im[i] = 0;
    }
    this.fft.transform(this.re, this.im);
    const hopSec = this.hop / this.fs;
    const decay = Math.exp(-hopSec / 1.5);
    const rise = Math.exp(hopSec / 1.5);
    const binHz = this.fs / n;
    const lo = Math.max(1, Math.floor(this.minHz / binHz));
    const hi = Math.min(n / 2 - 2, Math.ceil(this.maxHz / binHz));
    let best = -1;
    let bestP = 0;
    for (let k = 1; k < n / 2; k++) {
      const p = this.re[k] * this.re[k] + this.im[k] * this.im[k];
      this.maxHold[k] = Math.max(p, this.maxHold[k] * decay);
      this.minHold[k] = Math.min(p, this.minHold[k] === Infinity ? p : this.minHold[k] * rise);
      if (k >= lo && k <= hi && this.maxHold[k] > bestP) {
        bestP = this.maxHold[k];
        best = k;
      }
    }
    if (this.pinned || best < 0) return;

    // Prominence against the band's median, and keyedness (max-hold vs min-hold).
    const band: number[] = [];
    for (let k = lo; k <= hi; k++) band.push(this.maxHold[k]);
    band.sort((a, b) => a - b);
    const median = band[Math.floor(band.length / 2)] + 1e-20;
    const prominent = bestP / median > 10;
    const keyed = bestP / (this.minHold[best] + 1e-20) > 4;
    if (!prominent || !keyed) {
      this.candidateRuns = 0;
      return;
    }
    // Parabolic interpolation on log power for sub-bin pitch.
    const a = Math.log(this.maxHold[best - 1] + 1e-20);
    const b = Math.log(this.maxHold[best] + 1e-20);
    const c = Math.log(this.maxHold[best + 1] + 1e-20);
    const denom = a - 2 * b + c;
    const delta = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    const hz = (best + Math.max(-0.5, Math.min(0.5, delta))) * binHz;

    if (this.lockedHz === null) {
      if (Math.abs(hz - this.candidateHz) < 2 * binHz) this.candidateRuns++;
      else this.candidateRuns = 1;
      this.candidateHz = hz;
      if (this.candidateRuns >= 2) this.lock(hz, true, out);
      return;
    }

    if (Math.abs(hz - this.lockedHz) <= 40) {
      // Follow slow drift.
      this.relockRuns = 0;
      const next = this.lockedHz + 0.2 * (hz - this.lockedHz);
      if (Math.abs(next - this.lockedHz) > 0.5) this.setOscillator(next);
      return;
    }
    const lockedBin = Math.round(this.lockedHz / binHz);
    if (bestP > 4 * this.maxHold[lockedBin]) {
      this.relockRuns++;
      if (this.relockRuns * hopSec > 1.0) {
        this.relockRuns = 0;
        this.lock(hz, false, out);
      }
    } else {
      this.relockRuns = 0;
    }
  }

  private setOscillator(hz: number) {
    this.lockedHz = hz;
    const w = (2 * Math.PI * hz) / this.fs;
    this.stepCos = Math.cos(w);
    this.stepSin = Math.sin(w);
  }

  private lock(hz: number, replayHistory: boolean, out: DetectorEvent[]) {
    this.setOscillator(hz);
    this.cosP = 1;
    this.sinP = 0;
    this.lpI.reset();
    this.lpQ.reset();
    this.envInit = false;
    this.warmup = 0;
    this.warmAcc = 0;
    this.keyDown = false;
    this.pendingState = null;
    this.decimCount = 0;
    out.push({ type: 'lock', hz, t: this.time });
    if (replayHistory && this.historyCount > 1) {
      // Re-run the envelope over buffered audio so nothing before the lock is
      // lost. The newest buffered sample is the one being processed right now;
      // the live path handles it, so stop one short.
      const L = this.history.length;
      const first = this.historyPos - this.historyCount;
      const startSample = this.sample - (this.historyCount - 1);
      for (let j = 0; j < this.historyCount - 1; j++) {
        const idx = (first + j + L) % L;
        this.iqStep(this.history[idx], startSample + j, out);
      }
    }
  }

  private iqStep(x: number, sampleIndex: number, out: DetectorEvent[]) {
    // Rotate the reference phasor; renormalise now and then to stop drift.
    const c = this.cosP * this.stepCos - this.sinP * this.stepSin;
    const s = this.sinP * this.stepCos + this.cosP * this.stepSin;
    this.cosP = c;
    this.sinP = s;
    if (++this.renorm >= 1024) {
      this.renorm = 0;
      const m = Math.hypot(this.cosP, this.sinP);
      this.cosP /= m;
      this.sinP /= m;
    }
    const i = this.lpI.step(x * c);
    const q = this.lpQ.step(x * s);
    if (++this.decimCount < this.decim) return;
    this.decimCount = 0;
    const env = 2 * Math.hypot(i, q);
    this.envelopeStep(env, sampleIndex / this.fs, out);
  }

  private envelopeStep(env: number, t: number, out: DetectorEvent[]) {
    const dt = this.decim / this.fs;
    // Warm-up: let the filter settle and measure the floor before deciding anything.
    if (!this.envInit) {
      this.warmup++;
      if (this.warmup > 15) this.warmAcc += env;
      if (this.warmup >= 45) {
        this.noise = Math.max(this.warmAcc / 30, 1e-7);
        this.peak = this.noise;
        this.envInit = true;
      }
      this.envPrev = env;
      this.tPrev = t;
      return;
    }
    const k = (tau: number) => 1 - Math.exp(-dt / tau);

    // Noise floor: falls fast, rises slowly, frozen while the key is down.
    if (!this.keyDown) {
      if (env < this.noise) this.noise += (env - this.noise) * k(0.03);
      else this.noise += (env - this.noise) * k(1.5);
    }
    this.noise = Math.max(this.noise, 1e-7);
    // Peak follows the level of marks (so fading lowers the threshold with it)
    // and relaxes slowly toward the floor between them.
    if (env > this.peak) this.peak += (env - this.peak) * k(0.004);
    else if (this.keyDown) this.peak += (env - this.peak) * k(0.08);
    else this.peak = this.noise + (this.peak - this.noise) * Math.exp(-dt / 1.5);

    const snr = 20 * Math.log10(this.peak / this.noise);
    const span = this.peak - this.noise;
    const onThr = this.noise + 0.55 * span;
    const offThr = this.noise + 0.45 * span;

    let raw = this.keyDown;
    let crossT = t;
    if (snr < this.minSnrDb) {
      raw = false;
    } else if (!this.keyDown && env > onThr) {
      raw = true;
      crossT = this.interpolate(this.envPrev, env, this.tPrev, t, this.noise + 0.5 * span);
    } else if (this.keyDown && env < offThr) {
      raw = false;
      crossT = this.interpolate(this.envPrev, env, this.tPrev, t, this.noise + 0.5 * span);
    }

    // Debounce: a change must hold before it counts; its time is the crossing.
    const hold = Math.min(0.015, Math.max(0.004, 0.2 * this.dit));
    if (raw !== this.keyDown) {
      if (this.pendingState !== raw) {
        this.pendingState = raw;
        this.pendingT = crossT;
        this.pendingSince = t;
      } else if (t - this.pendingSince >= hold) {
        this.keyDown = raw;
        this.pendingState = null;
        out.push({ type: 'key', down: raw, t: this.pendingT });
      }
    } else {
      this.pendingState = null;
    }

    this.envPrev = env;
    this.tPrev = t;
  }

  private interpolate(e0: number, e1: number, t0: number, t1: number, level: number): number {
    if (e1 === e0) return t1;
    const f = (level - e0) / (e1 - e0);
    return t0 + Math.max(0, Math.min(1, f)) * (t1 - t0);
  }
}
