// Microphone audio in, key-down/key-up times out: the soft-evidence detector.
// See docs/research/hearing-the-key.md (E2, E3).
//
// 1. A peak-hold FFT finds the strongest keyed tone in 300-1200 Hz and locks
//    to it, or the pitch is pinned (as the rule-based detector does).
// 2. Lock-in channels at the tone's first five harmonics give, each
//    millisecond, each harmonic's rise over its floor and how steadily its
//    phase turns at the sender's pitch (evidence.ts).
// 3. A small trained network turns that into the log-odds that the tone is on:
//    the fundamental alone for a pure tone, all five harmonics once the
//    sender's tone is known to carry them (evidence-weights.json, trained by
//    bench/train.bench.ts).
// 4. An on/off hidden Markov model with minimum durations tied to the dit
//    decides, 200 ms behind, which stretches are marks (segmenter.ts).
// 5. Each mark's edges are timed where the fundamental's envelope crosses half
//    the mark's level, so marks keep their length.
//
// Decisions run `lag` behind the live audio: `horizon` is the time up to
// which they are final, and status events carry it, so a decoder ticking on
// them never mistakes undecided audio for silence.

import { FFT, hann } from './fft';
import { Evidence, PER_HARMONIC, RICH, featureRow, mlpLogit, type Mlp } from './evidence';
import { Segmenter } from './segmenter';
import trained from './evidence-weights.json';
import type { DetectorEvent, DetectorOptions } from './detector';

const STATUS_INTERVAL = 0.05;
/** Segmenter frame and look-ahead. */
const FRAME = 0.005;
const LAG = 40;
/** Evidence scale per frame (frames are correlated, so each counts for less); chosen on the benchmark's training beds. Tests sweep it. */
export const listenerTuning = { alpha: 0.4, combine: 'max' as 'pure' | 'replace' | 'max' };
/** The evidence models in use; benchmarks swap in others to compare. */
export const listenerModels: { pure: Mlp; rich: Mlp } = { pure: trained.pure as unknown as Mlp, rich: trained.rich as unknown as Mlp };
/** A rich tone's 3rd harmonic, in its marks: risen this far over its floor (dB)... */
const RICH_RISE = 10;
/** ...and within this far of the fundamental (dB). Leakage of a pure tone through the filter is ~55 dB down. */
const RICH_GAP = -25;

interface FrameInfo {
  /** Absolute time at the frame's start. */
  t: number;
  /** Mean rise per harmonic, mean pitch offset and coherence of the fundamental. */
  rise: number[];
  /** The 3rd harmonic's level against the fundamental's, dB. */
  gap3: number;
  pitch: number;
  coherence: number;
}

export class Listener {
  readonly fs: number;
  private minHz = 300;
  private maxHz = 1200;
  private pinned: number | null;
  private dit: number;
  private muted = false;
  private squelchDb: number | null;

  // Pitch search.
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
  private candidateHz = 0;
  private candidateRuns = 0;
  private relockRuns = 0;
  private readonly history: Float32Array;
  private historyPos = 0;
  private historyCount = 0;

  // Listening.
  private lockedHz: number | null = null;
  private evidence: Evidence | null = null;
  private segmenter: Segmenter;
  private frameSum = 0;
  private frameN = 0;
  private frameRise = [0, 0, 0, 0, 0];
  private frameGap3 = 0;
  private framePitch = 0;
  private frameCoh = 0;
  private frameStart = 0;
  private readonly frames: FrameInfo[] = [];

  // The sender's tone, learned from committed marks.
  private toneOffset = 0;
  private pitchMarks = 0;
  private rich = false;
  private markFrames: FrameInfo[] = [];
  private harmonicRise = [0, 0, 0, 0, 0];
  private harmonicGap3 = -60;
  private harmonicMarks = 0;

  // Marks.
  private keyDown = false;
  private downAt = 0;
  private committedT = 0;
  /** The fundamental's level at 1 kHz with times, 800 ms, for timing edges. */
  private readonly levels = new Float64Array(800);
  private readonly levelT = new Float64Array(800);
  private levelPos = 0;
  private markLevelSum = 0;
  private markLevelN = 0;

  // Bookkeeping.
  private sample = 0;
  private levelAcc = 0;
  private levelCount = 0;
  private nextStatus = STATUS_INTERVAL;
  private lastRise = 0;

  constructor(sampleRate: number, opts: DetectorOptions = {}) {
    this.fs = sampleRate;
    this.minHz = opts.minHz ?? 300;
    this.maxHz = opts.maxHz ?? 1200;
    this.pinned = opts.pinnedHz ?? null;
    this.dit = opts.dit ?? 0.08;
    this.squelchDb = opts.squelchDb ?? null;
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
    this.segmenter = new Segmenter({ frame: FRAME, lag: LAG, alpha: listenerTuning.alpha }, this.dit);
    if (this.pinned) this.lock(this.pinned, false, []);
  }

  get time(): number {
    return this.sample / this.fs;
  }

  /** Decisions are final up to here. */
  get horizon(): number {
    return this.lockedHz === null ? this.time : Math.max(this.committedT, this.time - LAG * FRAME - 0.03);
  }

  get pitch(): number | null {
    return this.lockedHz;
  }

  setDit(dit: number) {
    if (!(dit > 0)) return;
    const next = Math.min(0.4, Math.max(0.02, dit));
    if (Math.abs(next - this.dit) / this.dit < 0.2) return;
    this.dit = next;
    this.evidence?.setCutoff(this.cutoff());
    this.segmenter.configure(this.dit);
  }

  setPinned(hz: number | null, out: DetectorEvent[] = []) {
    this.pinned = hz;
    if (hz) this.lock(hz, false, out);
    return out;
  }

  setSquelch(db: number | null) {
    this.squelchDb = db;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
  }

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
      const x = input[i];
      this.levelAcc += x * x;
      this.levelCount++;
      if (!this.muted) {
        this.history[this.historyPos] = x;
        this.historyPos = (this.historyPos + 1) % this.history.length;
        if (this.historyCount < this.history.length) this.historyCount++;
        this.fftBuf[this.fftFill++] = x;
        if (this.fftFill === this.fftSize) {
          this.analyse(out);
          this.fftBuf.copyWithin(0, this.hop);
          this.fftFill = this.fftSize - this.hop;
        }
      }
      if (this.evidence) this.listen(x, this.sample / this.fs, out);
      this.sample++;
      if (this.time >= this.nextStatus) {
        this.nextStatus += STATUS_INTERVAL;
        const rms = Math.sqrt(this.levelAcc / Math.max(1, this.levelCount));
        this.levelAcc = 0;
        this.levelCount = 0;
        out.push({
          type: 'status',
          t: this.horizon,
          level: 20 * Math.log10(rms + 1e-9),
          pitch: this.lockedHz,
          snr: this.markLevelN ? Math.max(0, this.markLevelSum / this.markLevelN) : this.lastRise,
          floor: -120,
          keyDown: this.keyDown,
        });
      }
    }
    return out;
  }

  private cutoff(): number {
    return Math.min(250, Math.max(30, 4 / this.dit));
  }

  /** One sample into the evidence; per millisecond, the model; per frame, the segmenter. */
  private listen(x: number, t: number, out: DetectorEvent[]) {
    const f = this.evidence!.step(x, this.toneOffset, this.muted);
    if (!f) return;
    const row = featureRow(f);
    // The fundamental always counts; a tone's harmonics, once known, can only add evidence.
    const zPure = mlpLogit(row.slice(0, PER_HARMONIC), listenerModels.pure);
    const mode = listenerTuning.combine;
    let z = !this.rich || mode === 'pure' ? zPure : mode === 'replace' ? mlpLogit(row, listenerModels.rich) : Math.max(zPure, mlpLogit(row, listenerModels.rich));
    // The app's own sound is never a mark; below the squelch, neither is anything.
    if (this.muted) z = -8;
    else if (this.squelchDb !== null && Math.max(...f.rise) < this.squelchDb) z = Math.min(z, -4);
    this.lastRise = f.rise[0];
    this.levels[this.levelPos] = f.level;
    this.levelT[this.levelPos] = t;
    this.levelPos = (this.levelPos + 1) % this.levels.length;
    if (this.frameN === 0) this.frameStart = t;
    this.frameSum += z;
    for (let h = 0; h < 5; h++) this.frameRise[h] += f.rise[h] ?? 0;
    this.frameGap3 += (f.levels[2] ?? -180) - f.level;
    this.framePitch += f.pitch;
    this.frameCoh += f.coherence;
    this.frameN++;
    if (this.frameN < FRAME * 1000) return;
    const n = this.frameN;
    this.frames.push({ t: this.frameStart, rise: this.frameRise.map((r) => r / n), gap3: this.frameGap3 / n, pitch: this.framePitch / n, coherence: this.frameCoh / n });
    const on = this.segmenter.push(this.frameSum / n);
    this.frameSum = 0;
    this.frameN = 0;
    this.frameRise = [0, 0, 0, 0, 0];
    this.frameGap3 = 0;
    this.framePitch = 0;
    this.frameCoh = 0;
    if (on === null) return;
    const info = this.frames.shift()!;
    this.committedT = info.t + FRAME;
    this.commit(on, info, out);
  }

  /** A frame's state is final: marks start and end here. */
  private commit(on: boolean, info: FrameInfo, out: DetectorEvent[]) {
    if (on) this.markFrames.push(info);
    if (on === this.keyDown) return;
    if (on) {
      this.keyDown = true;
      this.downAt = this.edge(info.t, true);
      out.push({ type: 'key', down: true, t: this.downAt });
      return;
    }
    this.keyDown = false;
    const end = Math.max(this.downAt + 0.005, this.edge(info.t, false));
    out.push({ type: 'key', down: false, t: end });
    this.learn();
    this.markFrames = [];
  }

  /**
   * The time the fundamental's envelope crossed half the mark's level, nearest
   * `t`: within 25 ms after, and for a start up to 50 ms before (a key's thump
   * can hold the decision back).
   */
  private edge(t: number, rising: boolean): number {
    const n = this.levels.length;
    // The mark's level: the median over its frames so far, or the next 100 ms for a starting mark.
    const v: number[] = [];
    for (let j = 0; j < n; j++) {
      const tj = this.levelT[j];
      if (rising ? tj >= t + 0.01 && tj <= t + 0.1 : tj >= this.downAt + 0.01 && tj <= t - 0.01) v.push(this.levels[j]);
    }
    if (v.length < 5) return t;
    v.sort((a, b) => a - b);
    const half = v[v.length >> 1] - 6;
    let best = t;
    let bestD = Infinity;
    const before = rising ? 0.05 : 0.025;
    for (let k = 1; k < n; k++) {
      const j = (this.levelPos + k) % n;
      const p = (j - 1 + n) % n;
      const tj = this.levelT[j];
      if (tj < t - before || tj > t + 0.025 || this.levelT[p] > tj) continue;
      const crossed = rising ? this.levels[p] < half && this.levels[j] >= half : this.levels[p] >= half && this.levels[j] < half;
      if (crossed && Math.abs(tj - t) < bestD) {
        bestD = Math.abs(tj - t);
        best = tj;
      }
    }
    return best;
  }

  /** From a finished mark: the sender's pitch offset and whether the tone carries harmonics. */
  private learn() {
    const fr = this.markFrames.slice(2, -2);
    if (fr.length < 4) return;
    const steady = fr.filter((f) => f.coherence >= 0.8);
    if (steady.length >= 3) {
      const p = steady.map((f) => f.pitch).sort((a, b) => a - b)[steady.length >> 1];
      this.toneOffset = this.pitchMarks ? this.toneOffset + 0.3 * (p - this.toneOffset) : p;
      this.pitchMarks++;
    }
    const mean = (h: number) => fr.reduce((a, f) => a + f.rise[h], 0) / fr.length;
    for (let h = 0; h < 5; h++) this.harmonicRise[h] = this.harmonicMarks ? this.harmonicRise[h] + 0.3 * (mean(h) - this.harmonicRise[h]) : mean(h);
    const gap3 = fr.reduce((a, f) => a + f.gap3, 0) / fr.length;
    this.harmonicGap3 = this.harmonicMarks ? this.harmonicGap3 + 0.3 * (gap3 - this.harmonicGap3) : gap3;
    this.harmonicMarks++;
    this.markLevelSum += mean(0);
    this.markLevelN++;
    // Rich once three marks show the 3rd harmonic rising with the tone, close to its level.
    this.rich = this.harmonicMarks >= 3 && this.harmonicRise[2] >= RICH_RISE && this.harmonicGap3 >= RICH_GAP;
  }

  private lock(hz: number, replayHistory: boolean, out: DetectorEvent[]) {
    if (this.keyDown) out.push({ type: 'key', down: false, t: this.time });
    this.keyDown = false;
    this.lockedHz = hz;
    this.evidence = new Evidence(this.fs, RICH, this.cutoff());
    this.evidence.tune(hz);
    this.segmenter = new Segmenter({ frame: FRAME, lag: LAG, alpha: listenerTuning.alpha }, this.dit);
    this.frames.length = 0;
    this.frameN = 0;
    this.frameSum = 0;
    this.toneOffset = 0;
    this.pitchMarks = 0;
    this.rich = false;
    this.harmonicMarks = 0;
    this.harmonicGap3 = -60;
    this.markFrames = [];
    this.markLevelSum = 0;
    this.markLevelN = 0;
    out.push({ type: 'lock', hz, t: this.time });
    if (replayHistory && this.historyCount > 1) {
      // Audio from before the lock, so the first characters are not lost.
      const L = this.history.length;
      const first = this.historyPos - this.historyCount;
      const start = this.sample - (this.historyCount - 1);
      for (let j = 0; j < this.historyCount - 1; j++) this.listen(this.history[(first + j + L) % L], (start + j) / this.fs, out);
    }
  }

  private setOscillator(hz: number) {
    this.lockedHz = hz;
    this.evidence?.tune(hz);
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
    const band: number[] = [];
    for (let k = lo; k <= hi; k++) band.push(this.maxHold[k]);
    band.sort((a, b) => a - b);
    const median = band[Math.floor(band.length / 2)] + 1e-20;
    if (bestP / median <= 10 || bestP / (this.minHold[best] + 1e-20) <= 4) {
      this.candidateRuns = 0;
      return;
    }
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
}
