// Microphone audio in, key-down/key-up times out.
//
// 1. A peak-hold FFT finds the strongest keyed tone in 300-1200 Hz and locks to it.
// 2. An I/Q (lock-in) detector at that pitch, with a low-pass sized to the
//    sending speed, gives a smooth tone envelope at ~1 kHz. Two more, a few
//    hundred hertz either side, watch the room.
// 3. A threshold halfway (in decibels) between the channel's noise floor and
//    the level of its marks, with hysteresis and a debounce, turns it into key
//    events. A key-down also needs contrast: the tone must stand further above
//    its floor than both neighbours stand above theirs. Room sounds (voices,
//    thumps, typing, a fan) are broadband and lift all three together; a tone
//    lifts only its own channel.
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
      /** The tone channel's noise floor, dBFS. */
      floor: number;
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
  /** How far the tone must rise above its floor beyond the neighbours' rise, dB. */
  contrastDb?: number;
  /** Squelch: the least a key-down must rise above the floor, dB (set by calibration). */
  squelchDb?: number | null;
  /** Tests: the envelope stage's state at every step (1 kHz). */
  trace?: (s: TraceStep) => void;
  /** Internal: a second ear at the tone's third harmonic (pinned, no search, no ear of its own). */
  overtone?: boolean;
}

export interface TraceStep {
  t: number;
  env: number;
  refs: [number, number];
  floor: number;
  refFloors: [number, number];
  peak: number;
  onThr: number;
  offThr: number;
  toneLike: boolean;
  clear: boolean;
  coherence: number;
  offset: number;
  markLevel: number;
  keyDown: boolean;
  pending: boolean | null;
}

/** One lock-in channel: low-passed I and Q of the input mixed down from `hz`. */
class Channel {
  private cos = 1;
  private sin = 0;
  private stepCos = 1;
  private stepSin = 0;
  private renorm = 0;
  private i = 0;
  private q = 0;
  private readonly lpI: LowPass[];
  private readonly lpQ: LowPass[];

  constructor(
    private readonly fs: number,
    cutoff: number,
  ) {
    // Butterworth of order 2 or 4: two sections with their own Q for 4.
    const qs = filterTuning.order === 4 ? [0.5412, 1.3066] : [Math.SQRT1_2];
    this.lpI = qs.map((q) => new LowPass(fs, cutoff, q));
    this.lpQ = qs.map((q) => new LowPass(fs, cutoff, q));
  }

  /** Retunes without a phase jump (following drift). */
  tune(hz: number) {
    const w = (2 * Math.PI * hz) / this.fs;
    this.stepCos = Math.cos(w);
    this.stepSin = Math.sin(w);
  }

  setCutoff(fc: number) {
    for (const f of [...this.lpI, ...this.lpQ]) f.setCutoff(fc);
  }

  reset() {
    this.cos = 1;
    this.sin = 0;
    for (const f of [...this.lpI, ...this.lpQ]) f.reset();
  }

  step(x: number) {
    // Rotate the reference phasor; renormalise now and then to stop drift.
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
    let i = x * c;
    let q = x * s;
    for (const f of this.lpI) i = f.step(i);
    for (const f of this.lpQ) q = f.step(q);
    this.i = i;
    this.q = q;
  }

  get re(): number {
    return this.i;
  }

  get im(): number {
    return this.q;
  }

  /** Envelope (tone amplitude), dBFS. */
  get db(): number {
    return 20 * Math.log10(2 * Math.hypot(this.i, this.q) + 1e-9);
  }
}

const STATUS_INTERVAL = 0.05;
/** The lock-in low-pass: Butterworth `order`, cutoff `perDit` / dit (at least `min` Hz). Tests sweep it. */
export const filterTuning = { order: 2, perDit: 4, min: 30 };
/** How fast the noise floors follow the room, dB per second (they track the median level). */
const FLOOR_RATE = 10;
/** Room gate settings; tests sweep them. */
export const gateTuning = { weight: 0.25, quiet: 6, contrast: 8 };
/**
 * Pitch steadiness: the tone channel's phase is compared with itself `lag`
 * ms earlier, smoothed over `smooth` ms. A keyed tone turns at one fixed rate
 * (its offset from the lock, the same every mark); a voice's harmonic glides
 * through, noise wanders. `coherence` is the least steadiness (0..1), `tol`
 * how far (Hz) a mark's pitch may sit from the pitch learned from earlier
 * marks, and `wide` the allowance before any are learned.
 */
export const steadyTuning = { lag: 4, smooth: 4, coherence: 0.4, tol: 10, wide: 20, downHold: 0.1 };
/**
 * Each mark is checked as a whole when it ends: its pitch, measured over the
 * mark's steady middle (phase against itself `lag` ms earlier), must sit
 * within `tol` Hz (plus `short` / its length in ms) of the pitch learned from earlier marks, and be steady
 * (`coherence`). Until `learn` marks are in, the allowance is `pinned` Hz
 * around a pinned pitch, `wide` around a found one. A mark that fails is
 * withdrawn. While a mark lasts, it ends if the pitch has left the sender's
 * for `leave` dits (40 ms at least: a click passes in less).
 */
/**
 * Timbre: a buzzer or square-wave oscillator has a strong third harmonic at
 * exactly three times its pitch; voices and radios near the tone rarely do.
 * Learned from accepted marks: once `learn` marks show the harmonic within
 * `strong` dB of the tone and rising `minRise` dB over its own floor with it
 * (noise alone does not rise), a key-down needs it risen `rise` dB over its floor
 * and within `slack` dB of the learned level, and a mark is withdrawn if it
 * lacks it. A pure sine never qualifies, and the test stays off.
 */
export const timbreTuning = { learn: 3, strong: -15, minRise: 12, rise: 6, slack: 10, markSlack: 8 };
/**
 * Two ears: once the sender's tone is known to carry a strong third harmonic,
 * a second detector listens at three times its pitch. Speech and radio voices
 * crowd the fundamental far more than the harmonic, so when something covers
 * the fundamental the harmonic often still hears the key. Its marks count
 * only where the fundamental hears something that is not the tone: not
 * silence (level within `silence` dB of its floor, the room quiet), and not
 * a tone it is itself deciding on.
 */
export const earTuning = { overtone: true, silence: 6 };
export const markTuning = { lag: 10, tol: 3, wide: 8, pinned: 4, learn: 3, coherence: 0.5, leave: 0.6, short: 120 };

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

  // I/Q envelopes: the tone and its two neighbours
  private lockedHz: number | null = null;
  private readonly tone: Channel;
  private readonly refs: [Channel, Channel];
  /** At three times the pitch: the tone's own third harmonic, if it has one. */
  private readonly overtone: Channel;
  private overtoneNoise = 0;
  /** Third harmonic against the tone, and its rise over its own floor, dB, learned from accepted marks. */
  private harmonicGap = 0;
  private harmonicRise = 0;
  private harmonicMarks = 0;
  /** The current mark's third harmonic, summed over its steady middle. */
  private mGap = 0;
  private mRise = 0;
  private mGapN = 0;
  private readonly decim: number;
  private decimCount = 0;
  private envPrev = -180;
  private tPrev = 0;

  // Key detection, all levels in dB
  private contrastDb: number;
  private squelchDb: number | null;
  private trace: ((s: TraceStep) => void) | null;
  private noise = 0;
  private refNoise = [0, 0];
  private peak = 0;
  private envInit = false;
  private warmup = 0;
  private warmAcc = [0, 0, 0, 0];
  private keyDown = false;
  private pendingState: boolean | null = null;
  private pendingT = 0;
  private pendingSince = 0;
  /** The current mark's level, and the last time the envelope fell 6 dB below it. */
  private markLevel = 0;
  /** When the last mark ended. */
  private lastOff = -1;
  /** The second ear, at the third harmonic, and how the two are joined. */
  private readonly isOvertone: boolean;
  private inner: Detector | null = null;
  private innerT0 = 0;
  private ears = { a: Detector.ear(), b: Detector.ear() };
  private lastFusedUp = -1;
  private fusedDown = false;
  private fusedStart = 0;
  private fusedEnd = -1;
  /** The fundamental's last rise over its floor and the room's, for trusting the second ear. */
  private lastRise = 0;
  private lastRoom = 0;
  private lastEnv = -180;
  private lastToneLike = false;
  private lastOffThr = 0;
  /** Recent tone-channel phasors at 1 kHz, and the smoothed lagged product. */
  private readonly zRe = new Float64Array(32);
  private readonly zIm = new Float64Array(32);
  private zPos = 0;
  private zCount = 0;
  private wRe = 0;
  private wIm = 0;
  private wMag = 0;
  /** Where the sender's tone sits from the lock, Hz, learned from their marks. */
  private toneOffset = 0;
  private offsetMarks = 0;
  /** The current mark's phase against itself `markTuning.lag` ms earlier, summed. */
  private mRe = 0;
  private mIm = 0;
  private mMag = 0;
  private mN = 0;
  /** This step's phase product at `markTuning.lag`. */
  private lagRe = 0;
  private lagIm = 0;
  private lagMag = 0;
  private markStartT = 0;
  private peakBefore = 0;
  /** When the pitch last sat at the sender's during this mark. */
  private onPitchT = 0;
  /** Steady marks withdrawn for their pitch: if they agree, the pin is off and that is the tone. */
  private strays: number[] = [];
  private downT = 0;
  /**
   * The last 200 ms of envelope, to time a mark's start once its level is
   * known. A key's own thump can hold the room gate shut for 40 ms or more
   * after the tone has started.
   */
  private readonly histEnv = new Float64Array(200);
  private readonly histT = new Float64Array(200);
  private histPos = 0;

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
    this.contrastDb = opts.contrastDb ?? gateTuning.contrast;
    this.squelchDb = opts.squelchDb ?? null;
    this.isOvertone = opts.overtone ?? false;
    this.trace = opts.trace ?? null;
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
    this.tone = new Channel(sampleRate, this.cutoff());
    this.refs = [new Channel(sampleRate, this.cutoff()), new Channel(sampleRate, this.cutoff())];
    this.overtone = new Channel(sampleRate, this.cutoff());
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
    this.inner?.setDit(dit);
    const prev = this.cutoff();
    this.dit = Math.min(0.4, Math.max(0.02, dit));
    const next = this.cutoff();
    if (Math.abs(next - prev) / prev > 0.15) {
      this.tone.setCutoff(next);
      for (const r of this.refs) r.setCutoff(next);
      this.overtone.setCutoff(next);
      if (this.lockedHz !== null) this.tuneRefs(this.lockedHz);
    }
  }

  setPinned(hz: number | null, out: DetectorEvent[] = []) {
    this.pinned = hz;
    if (hz) this.lock(hz, false, out);
    return out;
  }

  /** The least a key-down must rise above the floor, dB; null for the default. */
  setSquelch(db: number | null) {
    this.squelchDb = db;
  }

  /** While the app itself is sending, ignore input so it cannot decode itself. */
  setMuted(muted: boolean) {
    this.muted = muted;
    this.inner?.setMuted(muted);
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
    const out = this.processOwn(input);
    if (this.isOvertone || !earTuning.overtone) return out;
    // The second ear starts once the tone is known to carry its third harmonic.
    if (!this.inner && this.lockedHz !== null && this.hasHarmonic() && 3 * (this.lockedHz + this.toneOffset) < this.fs / 2 - 500) {
      this.inner = new Detector(this.fs, { pinnedHz: 3 * (this.lockedHz + this.toneOffset), dit: this.dit, minSnrDb: this.minSnrDb, overtone: true });
      this.inner.setMuted(this.muted);
      // Its clock starts now; its times are shifted onto ours.
      this.innerT0 = this.time;
    }
    const joined: DetectorEvent[] = [];
    for (const e of out) {
      if (e.type === 'key') this.join('a', e.down, e.t, joined);
      else if (e.type === 'status') joined.push({ ...e, keyDown: this.fusedDown });
      else joined.push(e);
    }
    for (const e of this.inner?.process(input) ?? []) if (e.type === 'key') this.join('b', e.down, e.t + this.innerT0, joined);
    this.releaseUps(joined);
    return joined;
  }

  private static ear() {
    return { down: false, start: 0, ignored: false, upAt: null as number | null };
  }

  /** Still deciding: down, about to go down, or above its key-up level. */
  get hearing(): boolean {
    return this.keyDown || this.pendingState === true || this.lastEnv > this.lastOffThr;
  }

  /**
   * One ear's key event into the joined marks: a mark lasts while either ear
   * hears it. The second ear (b) only counts while the fundamental cannot
   * clearly hear silence. A mark both ears withdrew is withdrawn. An ear's
   * key-up waits while the other is still deciding (its decision can come
   * late and be timed earlier), so joined marks stay in order.
   */
  private join(ear: 'a' | 'b', down: boolean, t: number, out: DetectorEvent[]) {
    const me = this.ears[ear];
    if (down) {
      // The second ear steps in only where the fundamental hears something but
      // not the tone: covered by a voice or a radio. Hearing silence, or the
      // tone itself, the fundamental decides.
      const silent = !this.keyDown && this.lastRise < earTuning.silence && this.lastRoom < gateTuning.quiet;
      const deciding = this.keyDown || this.pendingState === true || this.lastToneLike;
      if (ear === 'b' && (silent || deciding)) {
        me.ignored = true;
        return;
      }
      // A key-down from before a joined mark already closed continues from there.
      const at = Math.max(t, this.lastFusedUp + 1e-3);
      if (me.upAt !== null) me.upAt = null;
      me.down = true;
      me.start = at;
      // The last mark was only waiting to close, and this one starts after a gap: close it first.
      if (this.fusedDown && !this.ears.a.down !== !this.ears.b.down && this.fusedEnd >= 0 && at > this.fusedEnd + 0.005) {
        const other = this.ears[ear === 'a' ? 'b' : 'a'];
        if (!other.down) {
          this.fusedDown = false;
          this.ears.a.upAt = this.ears.b.upAt = null;
          this.lastFusedUp = this.fusedEnd;
          out.push({ type: 'key', down: false, t: this.fusedEnd });
        }
      }
      if (!this.fusedDown) {
        this.fusedDown = true;
        this.fusedStart = at;
        this.fusedEnd = -1;
        out.push({ type: 'key', down: true, t: at });
      }
      return;
    }
    if (me.ignored) {
      me.ignored = false;
      return;
    }
    if (!me.down) return;
    // An up at the mark's own start withdraws it.
    if (t > me.start + 1e-9) this.fusedEnd = Math.max(this.fusedEnd, t);
    me.down = false;
    me.upAt = this.time;
    this.releaseUps(out);
  }

  /** Closes the joined mark once neither ear is down and neither is still deciding (150 ms at most). */
  private releaseUps(out: DetectorEvent[]) {
    if (!this.fusedDown || this.ears.a.down || this.ears.b.down) return;
    const waited = Math.max(...[this.ears.a.upAt, this.ears.b.upAt].map((u) => (u === null ? 0 : this.time - u)));
    const deciding = this.hearing || (this.inner?.hearing ?? false);
    if (deciding && waited < 0.15) return;
    this.fusedDown = false;
    this.ears.a.upAt = this.ears.b.upAt = null;
    const t = this.fusedEnd >= 0 ? this.fusedEnd : this.fusedStart;
    this.lastFusedUp = t;
    out.push({ type: 'key', down: false, t });
  }

  private processOwn(input: Float32Array): DetectorEvent[] {
    const out: DetectorEvent[] = [];
    for (let i = 0; i < input.length; i++) {
      let x = input[i];
      if (this.muted) x = 0;
      this.levelAcc += input[i] * input[i];
      this.levelCount++;

      this.history[this.historyPos] = x;
      this.historyPos = (this.historyPos + 1) % this.history.length;
      if (this.historyCount < this.history.length) this.historyCount++;

      if (!this.isOvertone) this.fftBuf[this.fftFill++] = x;
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
          floor: this.envInit ? this.noise : -120,
          keyDown: this.keyDown,
        });
      }
    }
    return out;
  }

  private cutoff(): number {
    return Math.min(250, Math.max(filterTuning.min, filterTuning.perDit / this.dit));
  }

  private snrDb(): number {
    return this.envInit ? this.peak - this.noise : 0;
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
    this.tone.tune(hz);
    this.tuneRefs(hz);
  }

  /** Neighbours far enough out that the tone barely reaches them through the low-pass. */
  private tuneRefs(hz: number) {
    const off = Math.max(200, 2.5 * this.cutoff());
    const below = hz - off >= 120 ? hz - off : hz + 2 * off;
    this.refs[0].tune(below);
    this.refs[1].tune(Math.min(hz + off, this.fs / 2 - 200));
    this.overtone.tune(Math.min(3 * hz, this.fs / 2 - 200));
  }

  private lock(hz: number, replayHistory: boolean, out: DetectorEvent[]) {
    this.setOscillator(hz);
    this.tone.reset();
    for (const r of this.refs) r.reset();
    this.overtone.reset();
    this.inner = null;
    if (this.fusedDown) out.push({ type: 'key', down: false, t: this.time });
    this.fusedDown = false;
    this.ears = { a: Detector.ear(), b: Detector.ear() };
    this.harmonicGap = 0;
    this.harmonicRise = 0;
    this.harmonicMarks = 0;
    this.envInit = false;
    this.warmup = 0;
    this.warmAcc = [0, 0, 0, 0];
    this.zCount = 0;
    this.wRe = this.wIm = this.wMag = 0;
    this.toneOffset = 0;
    this.offsetMarks = 0;
    this.strays = [];
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
    this.tone.step(x);
    this.refs[0].step(x);
    this.refs[1].step(x);
    this.overtone.step(x);
    if (++this.decimCount < this.decim) return;
    this.decimCount = 0;
    this.steadinessStep();
    this.envelopeStep(this.tone.db, this.refs[0].db, this.refs[1].db, this.overtone.db, sampleIndex / this.fs, out);
  }

  /** Updates the smoothed product of the tone phasor with itself `lag` ms ago. */
  private steadinessStep() {
    const re = this.tone.re;
    const im = this.tone.im;
    const n = this.zRe.length;
    const lag = steadyTuning.lag;
    if (this.zCount >= lag) {
      const j = (this.zPos - lag + n) % n;
      const pr = this.zRe[j];
      const pi = this.zIm[j];
      const a = 1 - Math.exp(-1 / steadyTuning.smooth);
      this.wRe += (re * pr + im * pi - this.wRe) * a;
      this.wIm += (im * pr - re * pi - this.wIm) * a;
      this.wMag += (Math.hypot(re, im) * Math.hypot(pr, pi) - this.wMag) * a;
    }
    if (this.zCount >= markTuning.lag) {
      const j = (this.zPos - markTuning.lag + n) % n;
      const pr = this.zRe[j];
      const pi = this.zIm[j];
      this.lagRe = re * pr + im * pi;
      this.lagIm = im * pr - re * pi;
      this.lagMag = Math.hypot(re, im) * Math.hypot(pr, pi);
    }
    this.zRe[this.zPos] = re;
    this.zIm[this.zPos] = im;
    this.zPos = (this.zPos + 1) % n;
    this.zCount++;
  }

  /** The sender's tone has a third harmonic that rises with it, close to its level. */
  private hasHarmonic(): boolean {
    return !this.isOvertone && this.harmonicMarks >= timbreTuning.learn && this.harmonicGap > timbreTuning.strong && this.harmonicRise >= timbreTuning.minRise;
  }

  /**
   * Is the mark that just ended the sender's tone? Its pitch over the whole
   * mark against the pitch of their earlier marks, and its steadiness.
   */
  private verifyMark(): boolean {
    // Too short to measure: left to the glitch rule.
    if (this.mN < 12 || this.mMag <= 0) return true;
    const coherence = Math.hypot(this.mRe, this.mIm) / this.mMag;
    const offset = Math.atan2(this.mIm, this.mRe) / ((2 * Math.PI * markTuning.lag * this.decim) / this.fs);
    // A short mark's pitch is known less exactly: more allowance (8.7 Hz with 21 ms of steady tone, 3.5 Hz for a dah).
    const base = this.offsetMarks >= markTuning.learn ? markTuning.tol : this.pinned ? markTuning.pinned : markTuning.wide;
    const tol = base + markTuning.short / this.mN;
    const gap = this.mGapN ? this.mGap / this.mGapN : -60;
    const rise = this.mGapN ? this.mRise / this.mGapN : 0;
    const timbre = this.hasHarmonic();
    if (coherence >= markTuning.coherence && Math.abs(offset - this.toneOffset) <= tol && (!timbre || gap >= this.harmonicGap - timbreTuning.markSlack)) {
      this.toneOffset = this.offsetMarks ? this.toneOffset + 0.3 * (offset - this.toneOffset) : offset;
      this.offsetMarks++;
      this.harmonicGap = this.harmonicMarks ? this.harmonicGap + 0.3 * (gap - this.harmonicGap) : gap;
      this.harmonicRise = this.harmonicMarks ? this.harmonicRise + 0.3 * (rise - this.harmonicRise) : rise;
      this.harmonicMarks++;
      this.strays = [];
      return true;
    }
    // Steady marks at one other pitch, again and again: the pin is off, and that is the tone.
    if (coherence >= 0.85) {
      this.strays = [...this.strays.slice(-3), offset];
      const sorted = [...this.strays].sort((a, b) => a - b);
      if (this.strays.length === 4 && sorted[3] - sorted[0] <= 2 * markTuning.tol) {
        this.toneOffset = sorted[1];
        this.offsetMarks = 1;
        this.strays = [];
      }
    }
    return false;
  }

  /** Steadiness of the tone channel (0..1) and its pitch offset from the lock, Hz. */
  private steadiness(): { coherence: number; offset: number } {
    const coherence = Math.hypot(this.wRe, this.wIm) / (this.wMag + 1e-30);
    const offset = Math.atan2(this.wIm, this.wRe) / ((2 * Math.PI * steadyTuning.lag * this.decim) / this.fs);
    return { coherence, offset };
  }

  private envelopeStep(env: number, ref0: number, ref1: number, ovt: number, t: number, out: DetectorEvent[]) {
    const dt = this.decim / this.fs;
    // Warm-up: let the filters settle and measure the floors before deciding anything.
    if (!this.envInit) {
      this.warmup++;
      if (this.warmup > 15) {
        this.warmAcc[0] += env;
        this.warmAcc[1] += ref0;
        this.warmAcc[2] += ref1;
        this.warmAcc[3] += ovt;
      }
      if (this.warmup >= 45) {
        this.noise = this.warmAcc[0] / 30;
        this.refNoise = [this.warmAcc[1] / 30, this.warmAcc[2] / 30];
        this.overtoneNoise = this.warmAcc[3] / 30;
        this.peak = this.noise;
        this.envInit = true;
      }
      this.envPrev = env;
      this.tPrev = t;
      return;
    }

    // Floors: each channel's median level while the key is up, followed in
    // small steps so bursts and marks barely move them.
    if (!this.keyDown && this.pendingState === null) {
      const step = FLOOR_RATE * dt;
      this.noise += env > this.noise ? step : -step;
      this.refNoise[0] += ref0 > this.refNoise[0] ? step : -step;
      this.refNoise[1] += ref1 > this.refNoise[1] ? step : -step;
      this.overtoneNoise += ovt > this.overtoneNoise ? step : -step;
    }

    // Contrast: how far the tone stands above its floor beyond what the room
    // adds to both neighbours.
    const r0 = ref0 - this.refNoise[0];
    const r1 = ref1 - this.refNoise[1];
    const lo = Math.min(r0, r1);
    const hi = Math.max(r0, r1);
    const room = Math.max(0, lo + gateTuning.weight * (hi - lo));
    this.lastRise = env - this.noise;
    this.lastRoom = room;
    // In a quiet room there is nothing to tell apart: any rise counts.
    const clear = room < gateTuning.quiet || env - this.noise - room >= this.contrastDb;
    // And it must be the sender's tone: steady, at the pitch of their marks so far.
    const { coherence, offset } = this.steadiness();
    const tol = this.offsetMarks >= 3 ? steadyTuning.tol : steadyTuning.wide;
    const steady = coherence >= steadyTuning.coherence && Math.abs(offset - this.toneOffset) <= tol;
    // And, if the sender's tone has one, its third harmonic must be there too.
    const timbre = this.hasHarmonic();
    const voiced = !timbre || (ovt - this.overtoneNoise >= timbreTuning.rise && ovt - env >= this.harmonicGap - timbreTuning.slack);
    const toneLike = clear && steady && voiced;
    this.lastToneLike = toneLike;
    // While a mark lasts: when did its pitch last sit at the sender's?
    if (this.keyDown && coherence >= steadyTuning.coherence && Math.abs(offset - this.toneOffset) <= tol) this.onPitchT = t;

    // Peak: the level of marks. Rises fast with a tone (not with room sounds),
    // follows a mark down slowly, and relaxes toward the floor between marks.
    const k = (tau: number) => 1 - Math.exp(-dt / tau);
    if (env > this.peak && (toneLike || this.keyDown)) this.peak += (env - this.peak) * k(0.004);
    else if (this.keyDown && env < this.peak) this.peak += (env - this.peak) * k(0.08);
    else if (!this.keyDown) this.peak = this.noise + (this.peak - this.noise) * Math.exp(-dt / 1.5);
    this.peak = Math.max(this.peak, this.noise);

    // Thresholds halfway between floor and marks, in dB, so a mark well below
    // the loudest still counts. In a silent room the floor is far down: the
    // span is capped so a mark's fading tail does not count as the mark.
    const span = this.peak - this.noise;
    const used = Math.min(span, 30);
    this.lastEnv = env;
    const least = Math.max(this.minSnrDb, this.squelchDb ?? 0);
    const onThr = this.peak - used + Math.max(least, 0.5 * used);
    const offThr = this.peak - used + Math.max(least - 3, 0.4 * used);
    this.lastOffThr = offThr;

    this.histEnv[this.histPos] = env;
    this.histT[this.histPos] = t;
    this.histPos = (this.histPos + 1) % this.histEnv.length;
    if (this.keyDown || this.pendingState === false) {
      // Mark edges are timed at half the mark's own amplitude (6 dB down), where
      // a filtered edge rises and falls symmetrically, so marks keep their length.
      // The tone's own level: it rises slowly, so a key's thump or a clack
      // during the mark barely moves it.
      if (toneLike && env > this.markLevel) this.markLevel += (env - this.markLevel) * k(0.015);
      // The mark's pitch, from its steady middle only: at its edges the filter
      // is still settling and a key's thump sits.
      if (this.keyDown && env >= this.markLevel - 6) {
        this.mRe += this.lagRe;
        this.mIm += this.lagIm;
        this.mMag += this.lagMag;
        this.mN++;
        this.mGap += ovt - env;
        this.mRise += ovt - this.overtoneNoise;
        this.mGapN++;
      }
      const half = this.markLevel - 6;
      if (this.envPrev >= half && env < half) this.downT = this.interpolate(this.envPrev, env, this.tPrev, t, half);
    }

    let raw = this.keyDown;
    let crossT = t;
    if (span < this.minSnrDb) {
      raw = false;
    } else if (!this.keyDown && env > onThr && toneLike) {
      raw = true;
    } else if (this.keyDown && (env < offThr || env < this.markLevel - 10)) {
      // Off below the threshold, or well below this mark's own level (an echo's tail).
      raw = false;
      crossT = t - this.downT < 0.06 ? this.downT : t;
    } else if (this.keyDown && t - this.onPitchT >= Math.max(0.04, markTuning.leave * this.dit)) {
      // The pitch has left the sender's: another sound has taken over the channel.
      raw = false;
      crossT = this.onPitchT;
    }

    // Debounce: a change must hold before it counts; its time is the crossing.
    // A steady tone is its own proof, so a key-down needs less.
    const hold = Math.min(0.015, Math.max(0.004, (raw && !this.keyDown ? steadyTuning.downHold : 0.2) * this.dit));
    if (raw !== this.keyDown) {
      if (this.pendingState !== raw) {
        this.pendingState = raw;
        this.pendingT = crossT;
        this.pendingSince = t;
      } else if (t - this.pendingSince >= hold) {
        this.keyDown = raw;
        this.pendingState = null;
        if (raw) {
          this.markLevel = this.recentMedian(t - this.pendingSince);
          this.downT = t;
          this.onPitchT = t;
          this.mRe = this.mIm = this.mMag = this.mN = 0;
          this.mGap = this.mRise = this.mGapN = 0;
          this.peakBefore = this.peak;
          // A key-down is timed where the envelope rose through half the mark's amplitude.
          this.markStartT = this.riseTime(this.markLevel - 6, this.pendingT);
          out.push({ type: 'key', down: true, t: this.markStartT });
        } else if (this.verifyMark()) {
          this.lastOff = this.pendingT;
          out.push({ type: 'key', down: false, t: this.pendingT });
        } else {
          // Not the sender's tone: withdrawn. A mark of no length is dropped downstream.
          this.peak = Math.min(this.peak, this.peakBefore);
          out.push({ type: 'key', down: false, t: this.markStartT });
        }
      }
    } else {
      this.pendingState = null;
    }

    this.trace?.({ t, env, refs: [ref0, ref1], floor: this.noise, refFloors: [this.refNoise[0], this.refNoise[1]], peak: this.peak, onThr, offThr, toneLike, clear, coherence, offset, markLevel: this.markLevel, keyDown: this.keyDown, pending: this.pendingState });
    this.envPrev = env;
    this.tPrev = t;
  }

  /** Median envelope over the last `seconds`: a mark's level, unmoved by a click on its edge. */
  private recentMedian(seconds: number): number {
    const n = this.histEnv.length;
    const now = this.histT[(this.histPos - 1 + n) % n];
    const v: number[] = [];
    for (let j = 1; j <= n; j++) {
      const i = (this.histPos - j + n) % n;
      if (this.histT[i] < now - seconds - 1e-9) break;
      v.push(this.histEnv[i]);
    }
    v.sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  }

  /** When the envelope last rose through `level` since the last mark ended; `fallback` if not found. */
  private riseTime(level: number, fallback: number): number {
    const n = this.histEnv.length;
    for (let j = 1; j < n; j++) {
      const i = (this.histPos - j + n) % n;
      const p = (i - 1 + n) % n;
      if (this.histT[p] <= this.lastOff) break;
      if (this.histEnv[p] < level && this.histEnv[i] >= level) {
        return this.interpolate(this.histEnv[p], this.histEnv[i], this.histT[p], this.histT[i], level);
      }
    }
    return fallback;
  }

  private interpolate(e0: number, e1: number, t0: number, t1: number, level: number): number {
    if (e1 === e0) return t1;
    const f = (level - e0) / (e1 - e0);
    return t0 + Math.max(0, Math.min(1, f)) * (t1 - t0);
  }
}
