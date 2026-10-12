// Band audio in, key events for every CW signal in it out: the Radio tab's
// detector. A receiver's speaker or line-out holds many stations at once;
// each one found gets a channel of its own, so both sides of a QSO show.
//
// 1. The input is low-passed and decimated to about 8 kHz.
// 2. A spectrum search (64 ms frames, 16 ms apart) scores every narrow peak
//    that holds its pitch from frame to frame and keeps standing out and
//    starting again there, as a keyed tone does (a voice's harmonics glide).
//    A pitch that scores enough, away from every channel, gets a channel,
//    which first hears the buffered audio again so the first characters are
//    not lost. Stations closer than `findTuning.mergeHz` share one.
// 3. A channel is an I/Q lock-in at its pitch, decimated to about 1 kHz, then
//    a filter matched to its speed: two running means, of 0.6 and 0.3 dits,
//    started wide and narrowed as the speed becomes known.
// 4. A mark starts halfway in decibels between the channel's own noise and
//    the level of its own marks; both follow the station (fading, the other
//    side of a QSO). The rise of the whole spectrum away from the channels
//    (static crashes, a voice) lifts the noise while it lasts.
// 5. Each mark is checked as a whole when it ends: it must stand clear of
//    the noise, hold its pitch (a voice glides), sit at a pitch the channel
//    knows, at about the level of its marks there, and not be a stronger
//    station nearby heard through the filter's skirt (key clicks). Where
//    another sound held the level up between two marks, it is cut in two.
// 6. A new channel stays silent until its marks show a keyed tone at one
//    pitch; then its marks so far are passed on. A channel silent for long
//    enough is dropped.
//
// Runs unchanged in the AudioWorklet and in Node tests: plain TypeScript,
// no DOM.

import { FFT, hann } from '../dsp/fft';
import { LowPass } from '../dsp/biquad';

export type RadioEvent =
  /** A new signal, or its pitch or strength updated (at most a few times a second). */
  | { type: 'signal'; ch: number; hz: number; snr: number; t: number }
  /**
   * Key-down or key-up on channel `ch`, `t` in seconds of input time. A mark
   * found not to be the station's after its key-down (its pitch, or another
   * station's key clicks) is withdrawn: its key-up comes at its own start, a
   * mark of no length.
   */
  | { type: 'key'; ch: number; down: boolean; t: number }
  /** The channel was dropped: silent for long enough. */
  | { type: 'gone'; ch: number; t: number };

export interface RadioOptions {
  minHz?: number;
  maxHz?: number;
  maxChannels?: number;
  /** Tests: each mark as it ends, with what decided it. */
  onMark?: (m: MarkCheck) => void;
  /** Tests: channels opened, passed on and dropped. */
  onChannel?: (c: { ch: number; hz: number; t: number; what: 'open' | 'live' | 'unheard' | 'gone' }) => void;
}

export interface MarkCheck {
  ch: number;
  /** The channel's pitch, Hz. */
  hz: number;
  start: number;
  end: number;
  /** The mark's level, the channel's floor and mark level before it, and the broadband rise during it, dB. */
  level: number;
  floor: number;
  markLevel: number;
  broadband: number;
  /** Its pitch from the channel's, over its steady middle and its second half, Hz, and its steadiness. */
  offset: number;
  settled: number;
  coherence: number;
  steps: number;
  accepted: boolean;
}

/** The front end: input decimated to about `rate` Hz, channels deciding at about `envRate` Hz. */
export const frontTuning = { rate: 8000, envRate: 1000 };

/**
 * The search. Frames of `window` seconds, `hops` to a frame. A bin that is a
 * local peak stands out by the lesser of two: its level over the median level
 * of the bins `near` to `far` away, and over the median of their floors (near
 * the edge of a receiver's filter the noise slopes, and a bin can stand over
 * the quieter bins on one side without standing over its own noise; its own
 * floor would do, but a station's marks lift it). Beyond `base` dB, that
 * scores, if the frame before had a peak within `steadyHz` of its pitch (a
 * keyed tone holds its pitch; a voice's harmonics glide 5 to 15 Hz from one
 * frame to the next). Bins whose floor is `skirt` dB under the band's median
 * floor are outside the receiver's filter and are left out. The scores add
 * up, fading over `tau` seconds, and a pitch (three bins summed) needs `least`, and `onsets`
 * starts (a bin that stands out now and did not a frame ago, fading the
 * same), held for `runSec`, to get a channel. Peaks within `mergeHz` of a
 * channel belong to it.
 */
export const findTuning = { window: 0.064, hops: 4, base: 10, skirt: 10, near: 3, far: 8, steadyHz: 4, tau: 4, least: 40, onsets: 3, runSec: 0.5, mergeHz: 25 };

/**
 * Each bin's own floor, in the search and in the broadband measure: a level
 * it is above `quantile` of the time (rising `up` dB a second, falling as
 * fast as that takes), plus `median` dB, the gap from that quantile of a
 * noise bin's power to its median. The broadband measure: frames of
 * `window` seconds, `hops` to a frame; its rise is the median over the bins
 * away from every channel passed on (`clearHz`), when at least `bins` are left. A
 * channel takes the power of that rise averaged over its own filter's
 * length (a crash shorter than that lifts its noise less), less `deadband`
 * dB (in plain noise it wanders a little).
 */
export const floorTuning = { quantile: 0.8, up: 2.5, median: 5, window: 0.016, hops: 4, clearHz: 120, bins: 4, deadband: 1 };

/**
 * A channel's matched filter: running means of `first` and `second` dits.
 * Until its speed is known it assumes a dit of `startDit` seconds; the dit
 * is kept within `minDit` to `maxDit`.
 */
export const filterTuning = { first: 0.6, second: 0.3, startDit: 0.035, minDit: 0.025, maxDit: 0.2 };

/**
 * Levels, in dB. The floor follows the level between marks, rising
 * `floorUp` dB a second and falling `floorDown`: it sits low in the noise
 * (about its 20th percentile, `floorTuning.median` under its median), and a
 * mark too weak to be heard barely lifts it. From the noise's median, a
 * key-down needs `least` dB and halfway to the mark level; key-up comes at
 * 0.4 of the way, or `endDrop` below the mark's own level; the next
 * key-down needs the level to have fallen to key-up's, or to rise `rise` dB
 * from its lowest since (not the last mark's tail). The span used is
 * at most `spanCap`. A mark must peak over the noise's median by `valid`
 * dB, or by more for a stronger channel: up to `validMax` dB, and `validBelow`
 * dB under its mark level (in plain noise a narrow filter's level wanders by
 * that much now and then). Each accepted mark moves the mark level
 * `markWeight` of the way to its own. After `relaxAfter` seconds without a
 * mark it relaxes, with time constant `relax`, toward `relaxTo` dB over the
 * noise's median (no lower): the next marks may be weaker (fading, the
 * other side of a QSO), but a level at the noise would let noise through.
 */
export const levelTuning = { floorUp: 2.5, floorDown: 10, least: 8, valid: 10, validMax: 13, validBelow: 4, spanCap: 30, markWeight: 0.5, relaxAfter: 1, relax: 2, relaxTo: 20, endDrop: 12, rise: 6 };

/**
 * A mark's pitch, from its phase against itself `lag` seconds earlier over
 * its steady middle. A keyed tone holds its pitch; a voice's harmonics glide.
 * A mark of at least `steps` steps must be steady (`coherence`, 0..1) and
 * its second half's pitch within `glide` Hz of its first half's (a chirp
 * settles within about 4 Hz; speech glides 6 Hz and more). Its settled pitch
 * (the second half) must sit within `capture` Hz of the channel's, and, once
 * the channel knows a pitch from `learn` marks, within `tol` Hz (plus
 * `short` over its steps) of one of at most `pitches` it knows: the station,
 * and the other side of a QSO on nearly the same pitch, learned from `stray`
 * steady marks off the known pitches that agree within `strayHz` in
 * `straySec` seconds. Its level must be within `level` dB of the marks at
 * that pitch, or up to `levelQuiet` dB after a pause of `quiet` seconds
 * (fading, the other side of a QSO). A known pitch is learned from marks
 * at least `fill` times the filter's rise. The channel follows its main
 * pitch, `follow` of the way with each of its marks (drift).
 */
export const pitchTuning = { lag: 0.008, steps: 15, coherence: 0.97, glide: 5, capture: 25, learn: 3, tol: 4, short: 150, fill: 1.5, pitches: 2, stray: 3, strayHz: 3, straySec: 15, level: 10, levelQuiet: 20, quiet: 2, follow: 0.3 };

/**
 * Another sound can hold the level up between two marks. Inside a mark, a
 * run of at least `run` seconds whose pitch (over windows of `window`
 * seconds) is more than `hz` Hz outside the pitches the channel knows, or a
 * dip `dip` dB under the mark's peak (in a mark `clear` dB over the noise's
 * median, where noise alone cannot dip so far), is a gap: the mark is cut
 * there, at half its amplitude on either side. Each part must be at least
 * `least` dits long (a chirp's first moments pass through the filter's
 * first null and dip too), and a part after a cut must be a measurable mark
 * at one of the channel's pitches.
 */
export const splitTuning = { window: 0.008, hz: 6, run: 0.015, dip: 9, clear: 15, least: 0.4 };

/**
 * Leakage between channels: a mark that overlaps (give or take the filter's
 * rise) a mark in a channel passed on within `hz` Hz, and is no louder than that mark
 * heard through this channel's filter (the envelope of its response, `db`
 * dB more for key clicks), is that station heard through the filter's skirt
 * and is dropped. Marks are remembered for `keep` seconds (longer than the
 * history a new channel hears again).
 */
export const leakTuning = { hz: 300, db: 6, keep: 8 };

/**
 * Lifetime. A new channel is passed on once `agree` of its last `confirm`
 * measured marks have settled pitches within `spread` Hz of their median,
 * with a mark level `strong` dB over the noise's median, or dropped unheard
 * after `tentative` seconds. A channel without a mark for `gone` seconds is
 * dropped. `history` seconds of audio are kept to hear again, `replay`
 * decimated samples of it in each call to `process` (all new channels
 * together): in an AudioWorklet each call must be quick, and a new channel
 * catches up over a few hundred milliseconds instead. At most
 * `maxTentative` new channels at a time; a pitch whose new channel was
 * dropped unheard waits `cooldown` seconds.
 */
export const lifeTuning = { confirm: 6, agree: 5, spread: 3, strong: 12, tentative: 8, gone: 45, history: 6, replay: 1024, maxTentative: 6, cooldown: 4 };

/** An amplitude in dB. */
const dbOf = (amp: number) => (20 / Math.LN10) * Math.log(amp + 1e-9);

/** Running mean of a complex signal over its last `len` samples (1 to `cap`). */
class Mean {
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private pos = 0;
  private count = 0;
  private sumRe = 0;
  private sumIm = 0;
  private since = 0;
  outRe = 0;
  outIm = 0;

  constructor(
    private readonly cap: number,
    private len: number,
  ) {
    this.re = new Float64Array(cap);
    this.im = new Float64Array(cap);
    this.len = Math.max(1, Math.min(cap, Math.round(len)));
  }

  reset() {
    this.pos = this.count = this.since = 0;
    this.sumRe = this.sumIm = this.outRe = this.outIm = 0;
  }

  get length(): number {
    return this.len;
  }

  setLength(len: number) {
    len = Math.max(1, Math.min(this.cap, Math.round(len)));
    if (len === this.len) return;
    this.len = len;
    this.resum();
  }

  private resum() {
    this.sumRe = this.sumIm = 0;
    const n = Math.min(this.count, this.len);
    for (let j = 1; j <= n; j++) {
      const i = (this.pos - j + this.cap) % this.cap;
      this.sumRe += this.re[i];
      this.sumIm += this.im[i];
    }
    this.since = 0;
  }

  step(re: number, im: number) {
    if (this.count >= this.len) {
      const i = (this.pos - this.len + this.cap) % this.cap;
      this.sumRe -= this.re[i];
      this.sumIm -= this.im[i];
    }
    this.re[this.pos] = re;
    this.im[this.pos] = im;
    this.pos = (this.pos + 1) % this.cap;
    if (this.count < this.cap) this.count++;
    this.sumRe += re;
    this.sumIm += im;
    // Running sums gather rounding error: add them up afresh now and then.
    if (++this.since >= 4096) this.resum();
    const n = Math.min(this.count, this.len);
    this.outRe = this.sumRe / n;
    this.outIm = this.sumIm / n;
  }
}

/** A pitch a channel's marks sit at: `n` marks, their level (dB), and when the last ended. */
interface Pitch {
  hz: number;
  n: number;
  level: number;
  t: number;
}

interface Mark {
  start: number;
  end: number;
  /** Mean level over its steady middle, and its highest, dB. */
  level: number;
  peak: number;
  /** Pitch from the channel's, Hz: over the steady middle, and over its second half. */
  offset: number;
  settled: number;
  coherence: number;
  /** Steps in its steady middle. */
  steps: number;
}

/** What the detector shares with its channels. */
interface Shared {
  fsd: number;
  /** fsd samples per channel step. */
  R: number;
  fe: number;
  /** Decimation taps (fsd to fe) and their delay, fsd samples. */
  taps: Float64Array;
  tapDelay: number;
  /** The most the whole spectrum rose over its floor between `from` and `to` (seconds), dB. */
  broadband: (from: number, to: number) => number;
  onMark: ((m: MarkCheck) => void) | null;
  /** Is a mark of this level at this time a stronger channel nearby heard through the filter's skirt? */
  leak: (c: Channel, start: number, end: number, level: number) => boolean;
}

const ENV_HISTORY = 2048;

/** One signal: a lock-in at its pitch, a matched filter, and the key decisions. */
class Channel {
  readonly id: number;
  hz: number;
  live = false;
  readonly born: number;
  /** Events held back until the channel is passed on. */
  held: RadioEvent[] = [];
  lastMarkEnd: number;
  lastSignal = { t: -Infinity, hz: 0, snr: 0 };
  /** A mark was accepted since the last signal event. */
  fresh = false;

  // Lock-in
  private cos = 1;
  private sin = 0;
  private stepCos = 1;
  private stepSin = 0;
  private renorm = 0;
  private readonly mixRe: Float64Array;
  private readonly mixIm: Float64Array;
  private mixPos = 0;
  private readonly first: Mean;
  private readonly second: Mean;

  // Speed
  private dit: number;
  private fromDecoder: number | null = null;
  /** A new dit for the filter, waiting for a quiet moment. */
  private wantDit: number | null = null;
  private durations: number[] = [];

  // Envelope history, for timing edges and measuring marks
  private readonly envT = new Float64Array(ENV_HISTORY);
  private readonly envDb = new Float64Array(ENV_HISTORY);
  private readonly envRe = new Float64Array(ENV_HISTORY);
  private readonly envIm = new Float64Array(ENV_HISTORY);
  private envPos = 0;
  private envCount = 0;

  // Decisions
  floor = 0;
  markLevel = 0;
  private ready = false;
  private keyDown = false;
  private pend: { down: boolean; since: number } | null = null;
  /** The current mark: its start, when it was decided, its highest level, and whether its key-down is out. */
  private markStart = 0;
  private markDecided = 0;
  private markMax = -200;
  /** The most the current mark stood over the noise's median at the time (crashes included), dB. */
  private markExcess = -200;
  /** The lowest level since the last mark ended: a new mark must rise from it, not be that mark's tail. */
  private tailMin = -200;
  private downSent = false;
  private floorFrom = 0;
  private accepted = 0;
  /** Settled pitches (Hz) of the last measured marks, for passing a new channel on. */
  private settled: number[] = [];
  /** Pitches this channel's marks sit at: `n` marks each. */
  private pitches: Pitch[] = [];
  /** Steady marks at no known pitch: a second station on nearly the same pitch, if they agree. */
  private strays: { hz: number; t: number }[] = [];
  /** Accepted marks of the last `leakTuning.keep` seconds, for telling leakage in other channels. */
  readonly recent: { start: number; end: number; level: number }[] = [];

  /** `from` to `t0`: the buffered audio (decimated sample numbers) it hears first. */
  constructor(
    id: number,
    hz: number,
    t: number,
    from: number,
    t0: number,
    private readonly sh: Shared,
  ) {
    this.id = id;
    this.hz = hz;
    this.born = t;
    this.lastMarkEnd = -1;
    this.next = from;
    this.seeding = from < t0 ? { from, to: t0, levels: [] } : null;
    this.mixRe = new Float64Array(sh.taps.length);
    this.mixIm = new Float64Array(sh.taps.length);
    this.dit = filterTuning.startDit;
    const cap = Math.ceil(filterTuning.maxDit * sh.fe) + 2;
    this.first = new Mean(cap, filterTuning.first * this.dit * sh.fe);
    this.second = new Mean(cap, filterTuning.second * this.dit * sh.fe);
    this.tune(hz);
  }

  /** Retunes without a phase jump. */
  tune(hz: number) {
    this.hz = hz;
    const w = (2 * Math.PI * hz) / this.sh.fsd;
    this.stepCos = Math.cos(w);
    this.stepSin = Math.sin(w);
  }

  /** The matched filter's delay, seconds. */
  private delay(): number {
    return this.sh.tapDelay / this.sh.fsd + (this.first.length - 1 + this.second.length - 1) / 2 / this.sh.fe;
  }

  /** How long a mark takes to rise through the filter, seconds. */
  private ramp(): number {
    return (this.first.length + this.second.length) / this.sh.fe;
  }

  /** The mark level over the noise's median, dB. */
  get snr(): number {
    return this.markLevel - this.floor - floorTuning.median;
  }

  setDit(dit: number) {
    if (dit > 0) this.fromDecoder = dit;
  }

  /**
   * The speed the filter is sized for: the decoder's or the channel's own
   * estimate, whichever is shorter. A new size waits for a quiet moment, a
   * filter's length after the last mark: it moves the filter's delay, and so
   * the times of what it hears.
   */
  resize() {
    let dit = this.ownDit() ?? filterTuning.startDit;
    if (this.fromDecoder !== null) dit = Math.min(dit, this.fromDecoder);
    dit = Math.min(filterTuning.maxDit, Math.max(filterTuning.minDit, dit));
    this.wantDit = Math.abs(dit - this.dit) / this.dit < 0.15 ? null : dit;
  }

  private applySize(t: number) {
    const dit = this.wantDit!;
    this.wantDit = null;
    this.dit = dit;
    const before = this.delay();
    this.first.setLength(filterTuning.first * dit * this.sh.fe);
    this.second.setLength(filterTuning.second * dit * this.sh.fe);
    // The floor waits for the filter to fill again.
    this.floorFrom = t + before - this.delay() + this.ramp();
  }

  /** The dit from the channel's own marks: the shorter of two classes, once there are both. */
  private ownDit(): number | null {
    const d = this.durations;
    if (d.length < 4) return null;
    const logs = d.map((x) => Math.log(x)).sort((a, b) => a - b);
    const lo = logs[Math.floor(logs.length / 8)];
    const hi = logs[logs.length - 1 - Math.floor(logs.length / 8)];
    if (hi - lo < Math.log(1.8)) return null;
    let a = lo;
    let b = hi;
    for (let it = 0; it < 10; it++) {
      let sa = 0;
      let na = 0;
      let sb = 0;
      let nb = 0;
      const mid = (a + b) / 2;
      for (const v of logs) {
        if (v < mid) {
          sa += v;
          na++;
        } else {
          sb += v;
          nb++;
        }
      }
      if (!na || !nb) break;
      a = sa / na;
      b = sb / nb;
    }
    return b - a >= Math.log(1.8) ? Math.exp(a) : null;
  }

  /**
   * The next decimated sample this channel hears. A new channel hears the
   * buffered audio twice, behind the live input: once to set its starting
   * floor and mark level (`seeding`), then to decide on its marks.
   */
  next: number;
  private seeding: { from: number; to: number; levels: number[] } | null;

  /** The buffered sample `m`, while catching up. */
  feed(x: number, m: number, out: RadioEvent[]) {
    this.next = m + 1;
    const sd = this.seeding;
    if (!sd) {
      this.push(x, m, out);
      return;
    }
    if (this.lockIn(x, m)) sd.levels.push(dbOf(2 * Math.hypot(this.second.outRe, this.second.outIm)));
    if (this.next < sd.to) return;
    // Seeded: the 20th percentile of the levels lies in the gaps between marks, the 97th in the marks.
    this.seeding = null;
    this.resetLockIn();
    this.next = sd.from;
    const levels = sd.levels.sort((a, b) => a - b);
    if (levels.length < 50) return;
    this.floor = levels[Math.floor(0.2 * (levels.length - 1))];
    this.markLevel = Math.max(this.floor + floorTuning.median + levelTuning.least, levels[Math.floor(0.97 * (levels.length - 1))]);
    this.ready = true;
  }

  /** Behind the live input (or still seeding): it hears the buffered audio first. */
  get behind(): boolean {
    return this.seeding !== null;
  }

  private resetLockIn() {
    this.cos = 1;
    this.sin = 0;
    this.mixRe.fill(0);
    this.mixIm.fill(0);
    this.first.reset();
    this.second.reset();
  }

  /** One decimated sample through the lock-in; true when a channel step is due. */
  private lockIn(x: number, m: number): boolean {
    const c = this.cos * this.stepCos + this.sin * this.stepSin;
    const s = this.sin * this.stepCos - this.cos * this.stepSin;
    this.cos = c;
    this.sin = s;
    if (++this.renorm >= 1024) {
      this.renorm = 0;
      const g = 1 / Math.hypot(c, s);
      this.cos *= g;
      this.sin *= g;
    }
    // Mixed down by e^{-jwt}: a tone above the channel turns forward.
    this.mixRe[this.mixPos] = x * this.cos;
    this.mixIm[this.mixPos] = x * this.sin;
    this.mixPos = (this.mixPos + 1) % this.mixRe.length;
    if ((m + 1) % this.sh.R !== 0) return false;
    const taps = this.sh.taps;
    const n = taps.length;
    let re = 0;
    let im = 0;
    for (let k = 0; k < n; k++) {
      const i = (this.mixPos - 1 - k + n) % n;
      re += taps[k] * this.mixRe[i];
      im += taps[k] * this.mixIm[i];
    }
    this.first.step(re, im);
    this.second.step(this.first.outRe, this.first.outIm);
    return true;
  }

  /** One decimated sample (index `m`); events go to `out` (or are held while the channel is new). */
  push(x: number, m: number, out: RadioEvent[]) {
    if (!this.lockIn(x, m)) return;
    const t = (m + 1) / this.sh.fsd - this.delay();
    this.decide(t, out);
  }

  private emit(e: RadioEvent, out: RadioEvent[]) {
    if (this.live) out.push(e);
    else this.held.push(e);
  }

  private decide(t: number, out: RadioEvent[]) {
    const re = this.second.outRe;
    const im = this.second.outIm;
    const env = dbOf(2 * Math.hypot(re, im));
    const p = this.envPos;
    this.envT[p] = t;
    this.envDb[p] = env;
    this.envRe[p] = re;
    this.envIm[p] = im;
    this.envPos = (p + 1) % ENV_HISTORY;
    if (this.envCount < ENV_HISTORY) this.envCount++;
    const dt = 1 / this.sh.fe;

    if (!this.ready) {
      // No buffered audio to seed from: take the first 50 ms as the floor.
      if (this.envCount >= 50) {
        let s = 0;
        for (let j = 0; j < 50; j++) s += this.envDb[(this.envPos - 1 - j + ENV_HISTORY) % ENV_HISTORY];
        this.floor = s / 50 - floorTuning.median;
        this.markLevel = this.floor + floorTuning.median + levelTuning.least;
        this.ready = true;
      }
      return;
    }

    const L = levelTuning;
    if (this.wantDit !== null && !this.keyDown && !this.pend && t - this.lastMarkEnd > 2 * this.ramp()) {
      this.applySize(t);
      return;
    }
    // The floor: low in the level between marks, once the last mark has left the filter.
    if (!this.keyDown && !this.pend && t >= this.floorFrom) this.floor += env > this.floor ? L.floorUp * dt : -L.floorDown * dt;
    // A long silence: the next marks may be weaker (fading, the other side of a QSO).
    const relaxTo = this.floor + floorTuning.median + L.relaxTo;
    if (!this.keyDown && t - this.lastMarkEnd > L.relaxAfter && this.markLevel > relaxTo) {
      this.markLevel = relaxTo + (this.markLevel - relaxTo) * Math.exp(-dt / L.relax);
    }
    const reach = 0.5 * this.ramp() + 0.004;
    const fl = this.floor + floorTuning.median + this.sh.broadband(t - reach, t + reach);
    const span = Math.min(L.spanCap, Math.max(0, this.markLevel - fl));
    const onThr = fl + Math.max(L.least, 0.5 * span);
    const offThr = fl + Math.max(L.least - 3, 0.4 * span);

    if (!this.keyDown && env < this.tailMin) this.tailMin = env;
    let raw = this.keyDown;
    if (!this.keyDown && env > onThr && (this.tailMin < offThr || env - this.tailMin >= levelTuning.rise)) raw = true;
    else if (this.keyDown && (env < offThr || env < this.markMax - L.endDrop)) raw = false;

    const hold = Math.max(0.003, (raw ? 0.1 : 0.15) * this.dit);
    if (raw !== this.keyDown) {
      if (!this.pend || this.pend.down !== raw) this.pend = { down: raw, since: t };
      else if (t - this.pend.since >= hold) {
        this.pend = null;
        if (raw) {
          this.keyDown = true;
          this.markDecided = t;
          this.markMax = env;
          this.markExcess = env - fl;
          this.downSent = false;
        } else {
          this.keyDown = false;
          this.tailMin = env;
          this.endMark(t, out);
        }
      }
    } else this.pend = null;

    if (this.keyDown) {
      if (env > this.markMax) this.markMax = env;
      if (env - fl > this.markExcess) this.markExcess = env - fl;
      // The start is timed once the mark has risen through the filter (or begun to fall).
      // A mark too weak to be one is never passed on, so a decoder never sees it start.
      if (!this.downSent && this.markExcess >= this.valid() && (t - this.markDecided >= this.ramp() || env < this.markMax - 1)) this.sendDown(out);
    }
  }

  /** How far a mark must peak over the noise's median, dB. */
  private valid(): number {
    const V = levelTuning;
    return Math.max(V.valid, Math.min(V.validMax, this.snr - V.validBelow));
  }

  /** Times the mark's start where it rose through half its amplitude, and passes the key-down on. */
  private sendDown(out: RadioEvent[]) {
    this.timeStart();
    this.downSent = true;
    this.emit({ type: 'key', ch: this.id, down: true, t: this.markStart }, out);
  }

  private timeStart() {
    const half = this.markMax - 6;
    let start = this.markDecided;
    // Back through the history to the last rise through `half`, not before the last mark ended.
    for (let j = 1; j < this.envCount; j++) {
      const i = (this.envPos - j + ENV_HISTORY) % ENV_HISTORY;
      const k = (i - 1 + ENV_HISTORY) % ENV_HISTORY;
      if (this.envT[k] <= this.lastMarkEnd) break;
      if (this.envDb[k] < half && this.envDb[i] >= half) {
        start = this.interpolate(k, i, half);
        break;
      }
    }
    this.markStart = Math.max(start, this.lastMarkEnd + 1e-4);
  }

  private interpolate(k: number, i: number, level: number): number {
    const e0 = this.envDb[k];
    const e1 = this.envDb[i];
    if (e1 === e0) return this.envT[i];
    const f = Math.max(0, Math.min(1, (level - e0) / (e1 - e0)));
    return this.envT[k] + f * (this.envT[i] - this.envT[k]);
  }

  private endMark(t: number, out: RadioEvent[]) {
    const valid = this.valid();
    if (!this.downSent) {
      if (this.markExcess >= valid) this.sendDown(out);
      else this.timeStart();
    }
    // The end: where the level fell through half the amplitude it had near the end.
    const ramp = this.ramp();
    let endLevel = -200;
    let end = t;
    for (let j = 1; j < this.envCount; j++) {
      const i = (this.envPos - j + ENV_HISTORY) % ENV_HISTORY;
      if (this.envT[i] < t - 2 * ramp - 0.03 || this.envT[i] < this.markStart) break;
      if (this.envDb[i] > endLevel) endLevel = this.envDb[i];
    }
    const half = endLevel - 6;
    for (let j = 1; j < this.envCount; j++) {
      const i = (this.envPos - j + ENV_HISTORY) % ENV_HISTORY;
      const k = (i - 1 + ENV_HISTORY) % ENV_HISTORY;
      if (this.envT[k] < this.markStart) break;
      if (this.envDb[k] >= half && this.envDb[i] < half) {
        end = this.interpolate(k, i, half);
        break;
      }
    }
    end = Math.max(end, this.markStart + 1e-4);
    this.floorFrom = t + ramp;
    // Another sound can hold the level up between two marks: where the pitch
    // leaves the station's inside a mark, it is two marks.
    const parts = this.downSent ? this.split(this.markStart, end) : [[this.markStart, end]];
    parts.forEach(([a, b], i) => {
      const mark = this.measure(a, b);
      const bb = this.sh.broadband(a, b);
      const excess = i ? mark.peak - this.floor - floorTuning.median - bb : this.markExcess;
      const whole = parts.length === 1 || (b - a >= splitTuning.least * this.dit && (i === 0 || mark.steps >= pitchTuning.steps));
      const ok = whole && excess >= valid && this.verify(mark) && !this.sh.leak(this, a - ramp, b + ramp, mark.peak);
      this.sh.onMark?.({ ch: this.id, hz: this.hz, start: a, end: b, level: mark.level, floor: this.floor, markLevel: this.markLevel, broadband: bb, offset: mark.offset, settled: mark.settled, coherence: mark.coherence, steps: mark.steps, accepted: ok });
      if (ok) {
        this.fresh = true;
        this.accept(mark);
        this.recent.push({ start: a, end: b, level: mark.level });
        while (this.recent.length && this.recent[0].end < b - leakTuning.keep) this.recent.shift();
        this.lastMarkEnd = b;
        if (i) this.emit({ type: 'key', ch: this.id, down: true, t: a }, out);
        this.emit({ type: 'key', ch: this.id, down: false, t: b }, out);
      } else if (i === 0 && this.downSent) {
        // Not this station's tone: withdrawn (a mark of no length is dropped downstream).
        this.emit({ type: 'key', ch: this.id, down: false, t: a }, out);
      }
    });
  }

  /**
   * The parts of a mark where its pitch stays at one of the channel's: a run
   * of `splitTuning.run` seconds or more inside it (not at its edges, where a
   * chirp sits) at least `splitTuning.hz` off is another sound, and is cut out.
   */
  private split(start: number, end: number): [number, number][] {
    const S = splitTuning;
    const fe = this.sh.fe;
    const lag = Math.max(1, Math.round(pitchTuning.lag * fe));
    const win = Math.max(2, Math.round(S.window * fe));
    const known = this.pitches.filter((p) => p.n >= pitchTuning.learn).map((p) => p.hz - this.hz);
    if (end - start < 2 * S.run + 2 * S.window) return [[start, end]];
    const idx: number[] = [];
    for (let j = 1; j < this.envCount; j++) {
      const i = (this.envPos - j + ENV_HISTORY) % ENV_HISTORY;
      if (this.envT[i] < start) break;
      if (this.envT[i] <= end) idx.push(i);
    }
    idx.reverse();
    const cuts: [number, number][] = [];
    // Dips: from where the level fell through half the peak's amplitude to where it rose through it again.
    let peak = -200;
    for (const i of idx) if (this.envDb[i] > peak) peak = this.envDb[i];
    if (peak - this.floor - floorTuning.median >= S.clear) {
      const half = peak - 6;
      for (let n = 1; n < idx.length - 1; n++) {
        if (!(this.envDb[idx[n]] < peak - S.dip && this.envDb[idx[n - 1]] >= peak - S.dip)) continue;
        let a = n;
        while (a > 0 && this.envDb[idx[a]] < half) a--;
        let b = n;
        while (b < idx.length - 1 && this.envDb[idx[b]] < half) b++;
        if (a === 0 || b === idx.length - 1) continue;
        cuts.push([this.interpolate(idx[a], idx[a + 1], half), this.interpolate(idx[b - 1], idx[b], half)]);
        n = b;
      }
    }
    if (!known.length) return this.cut(start, end, cuts);
    const perHz = 2 * Math.PI * (lag / fe);
    // Each window's pitch: off one known to this channel, or on it.
    const off: boolean[] = [];
    for (let w = 0; w + win <= idx.length; w += win) {
      let re = 0;
      let im = 0;
      for (let n = w; n < w + win; n++) {
        const i = idx[n];
        const k = (i - lag + ENV_HISTORY) % ENV_HISTORY;
        re += this.envRe[i] * this.envRe[k] + this.envIm[i] * this.envIm[k];
        im += this.envIm[i] * this.envRe[k] - this.envRe[i] * this.envIm[k];
      }
      // On a pitch the channel knows, or between two (a station off the tuning measures short of its pitch until the filter fills).
      const hz = Math.atan2(im, re) / perHz;
      off.push(hz < Math.min(...known) - S.hz || hz > Math.max(...known) + S.hz);
    }
    const runWins = Math.ceil(S.run / S.window);
    for (let w = 1; w < off.length - 1; w++) {
      if (!off[w] || off[w - 1]) continue;
      let e = w;
      while (e < off.length - 1 && off[e]) e++;
      // A run that reaches the mark's last window is its end, not a gap.
      if (e - w >= runWins && e < off.length - 1) cuts.push([this.envT[idx[w * win]], this.envT[idx[Math.min(idx.length - 1, e * win)]]]);
      w = e;
    }
    return this.cut(start, end, cuts);
  }

  /** A mark less the gaps cut from it; a cut that would leave a part under `splitTuning.least` dits is not made. */
  private cut(start: number, end: number, cuts: [number, number][]): [number, number][] {
    const least = splitTuning.least * this.dit;
    cuts.sort((x, y) => x[0] - y[0]);
    const parts: [number, number][] = [];
    let from = start;
    for (const [a, b] of cuts) {
      if (b <= from || a - from < least || end - b < least) continue;
      parts.push([from, a]);
      from = b;
    }
    parts.push([from, end]);
    return parts;
  }

  /** A mark's level and pitch over its steady middle. */
  private measure(start: number, end: number): Mark {
    const lagSteps = Math.max(1, Math.round(pitchTuning.lag * this.sh.fe));
    // Steps of the mark, oldest first.
    const idx: number[] = [];
    for (let j = 1; j < this.envCount; j++) {
      const i = (this.envPos - j + ENV_HISTORY) % ENV_HISTORY;
      if (this.envT[i] < start) break;
      if (this.envT[i] <= end) idx.push(i);
    }
    idx.reverse();
    let max = -200;
    for (const i of idx) if (this.envDb[i] > max) max = this.envDb[i];
    const mid = idx.filter((i) => this.envDb[i] >= max - 6);
    let level = 0;
    for (const i of mid) level += this.envDb[i];
    level = mid.length ? level / mid.length : max;
    const half = mid.length >> 1;
    let r1 = 0;
    let i1 = 0;
    let r2 = 0;
    let i2 = 0;
    let mag = 0;
    let steps = 0;
    mid.forEach((i, n) => {
      const k = (i - lagSteps + ENV_HISTORY) % ENV_HISTORY;
      if (this.envT[k] < start - 0.001) return;
      const pr = this.envRe[k];
      const pi = this.envIm[k];
      const re = this.envRe[i] * pr + this.envIm[i] * pi;
      const im = this.envIm[i] * pr - this.envRe[i] * pi;
      if (n < half) {
        r1 += re;
        i1 += im;
      } else {
        r2 += re;
        i2 += im;
      }
      mag += Math.hypot(this.envRe[i], this.envIm[i]) * Math.hypot(pr, pi);
      steps++;
    });
    const perHz = 2 * Math.PI * (lagSteps / this.sh.fe);
    const offset = Math.atan2(i1 + i2, r1 + r2) / perHz;
    const settled = Math.atan2(i2, r2) / perHz;
    const coherence = mag > 0 ? Math.hypot(r1 + r2, i1 + i2) / mag : 0;
    return { start, end, level, peak: max, offset, settled: r2 || i2 ? settled : offset, coherence, steps };
  }

  /** Is a mark of this level as loud as the marks at this pitch (allowing more after a pause: fading, a QSO's other side)? */
  private loudEnough(p: Pitch, m: Mark): boolean {
    const P = pitchTuning;
    const allow = P.level + (P.levelQuiet - P.level) * Math.min(1, (m.start - p.t) / P.quiet);
    return m.level >= p.level - allow;
  }

  private verify(m: Mark): boolean {
    const P = pitchTuning;
    const known = this.pitches.filter((p) => p.n >= P.learn);
    // Too short to measure the pitch: only the level.
    if (m.steps < 8) return !known.length || known.some((p) => this.loudEnough(p, m));
    if (m.steps >= P.steps && (m.coherence < P.coherence || Math.abs(2 * (m.settled - m.offset)) > P.glide)) return false;
    if (Math.abs(m.settled) > P.capture) return false;
    const hz = this.hz + m.settled;
    if (!known.length) return true;
    const tol = P.tol + P.short / m.steps;
    const near = known.filter((p) => Math.abs(hz - p.hz) <= tol);
    if (near.length) return near.some((p) => this.loudEnough(p, m));
    // Off every known pitch: a second station here, if steady marks keep agreeing on its pitch.
    if (m.steps < P.steps) return false;
    this.strays = this.strays.filter((x) => x.t > m.end - P.straySec);
    this.strays.push({ hz, t: m.end });
    const agree = this.strays.filter((x) => Math.abs(x.hz - hz) <= P.strayHz);
    if (agree.length < P.stray || this.pitches.length >= P.pitches) return false;
    this.strays = this.strays.filter((x) => !agree.includes(x));
    this.pitches.push({ hz, n: P.learn - 1, level: m.level, t: m.end });
    return true;
  }

  private accept(m: Mark) {
    this.markLevel += (m.level - this.markLevel) * (this.accepted ? levelTuning.markWeight : 1);
    if (m.steps >= 8) {
      this.accepted++;
      const P = pitchTuning;
      const hz = this.hz + m.settled;
      if (m.steps >= P.steps) {
        this.settled.push(hz);
        if (this.settled.length > lifeTuning.confirm) this.settled.shift();
        // Its pitch: the nearest known one moves to it a little, or it starts one. Only
        // from a mark long enough to fill the filter: a station off the tuning measures
        // short of its pitch until it has (half way at the start).
        let near: Pitch | null = null;
        for (const p of this.pitches) if (Math.abs(p.hz - hz) <= P.tol + P.short / m.steps && (!near || Math.abs(p.hz - hz) < Math.abs(near.hz - hz))) near = p;
        if (m.end - m.start < P.fill * this.ramp()) {
          if (near) {
            near.n = Math.min(near.n + 1, 50);
            near.t = m.end;
          }
        } else if (near) {
          near.hz += (hz - near.hz) / Math.min(near.n + 1, 5);
          near.level += (m.level - near.level) * (near.n ? 0.3 : 1);
          near.n = Math.min(near.n + 1, 50);
          near.t = m.end;
        } else {
          this.pitches.push({ hz, n: 1, level: m.level, t: m.end });
          this.pitches.sort((a, b) => b.n - a.n);
          if (this.pitches.length > P.pitches) this.pitches.pop();
        }
        // Follow the main pitch (drift).
        const main = this.pitches.length ? this.pitches.reduce((a, b) => (b.n > a.n ? b : a)) : null;
        if (main && near === main) this.tune(this.hz + P.follow * (main.hz - this.hz));
      }
    }
    this.durations.push(m.end - m.start);
    if (this.durations.length > 30) this.durations.shift();
    this.resize();
  }

  /** Marks so far agree on one pitch: a keyed tone. */
  get confirmed(): boolean {
    const L = lifeTuning;
    if (this.settled.length < L.confirm || this.snr < L.strong) return false;
    const v = [...this.settled].sort((a, b) => a - b);
    const med = v[v.length >> 1];
    return v.filter((x) => Math.abs(x - med) <= L.spread).length >= L.agree;
  }

  /** How much of a tone `df` Hz away this channel's filter lets through at most, dB (with `leakTuning.db` for key clicks). */
  skirt(df: number): number {
    const fe = this.sh.fe;
    const g = (len: number) => Math.min(1, fe / (Math.PI * df * len));
    return 20 * Math.log10(g(this.first.length) * g(this.second.length)) + leakTuning.db;
  }

  /** A mark of this channel at least `level` dB overlaps the time from `from` to `to` (one still open counts from its start). */
  louder(from: number, to: number, level: number): boolean {
    if (this.keyDown && this.markMax >= level && this.markDecided - this.ramp() <= to) return true;
    for (let i = this.recent.length - 1; i >= 0; i--) {
      const m = this.recent[i];
      if (m.end < from) break;
      if (m.start <= to && m.level >= level) return true;
    }
    return false;
  }

  /** The channel is dropped: an open mark ends now. */
  close(t: number, out: RadioEvent[]) {
    if (this.keyDown && this.live && this.downSent) out.push({ type: 'key', ch: this.id, down: false, t: Math.max(t, this.markStart + 1e-4) });
    this.keyDown = false;
  }
}

/** Decimation taps from the front end's rate to the channels': three running means of R (a CIC filter of order 3). */
function cicTaps(R: number): Float64Array {
  let h = [1];
  for (let s = 0; s < 3; s++) {
    const next = new Array<number>(h.length + R - 1).fill(0);
    for (let i = 0; i < h.length; i++) for (let j = 0; j < R; j++) next[i + j] += h[i];
    h = next;
  }
  const sum = h.reduce((a, b) => a + b, 0);
  return Float64Array.from(h, (v) => v / sum);
}

export class RadioDetector {
  readonly sampleRate: number;
  private readonly minHz: number;
  private readonly maxHz: number;
  private readonly maxChannels: number;
  private readonly D: number;
  private readonly fsd: number;
  private readonly aa: LowPass[];
  private dcount = 0;
  /** Input samples and decimated samples so far. */
  private n = 0;
  private m = 0;
  private readonly sh: Shared;

  // Buffered decimated audio, for new channels to hear again.
  private readonly hist: Float32Array;
  private histPos = 0;
  private histCount = 0;

  // Search
  private readonly size: number;
  private readonly hop: number;
  private readonly fft: FFT;
  private readonly win: Float64Array;
  private readonly frame: Float32Array;
  private fill = 0;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly db: Float64Array;
  private readonly held: Float64Array;
  private readonly score: Float64Array;
  private readonly onsets: Float64Array;
  private readonly was: Uint8Array;
  private readonly here: Uint8Array;
  private readonly binHz: number;
  private readonly lo: number;
  private readonly hi: number;
  /** Each search bin's floor, dB (NaN until the first frame). */
  private readonly floorDb: Float64Array;
  /** The pitch of each bin's peak in the last frame and this one, Hz (NaN: no peak there). */
  private peakHz: Float64Array;
  private nextPeakHz: Float64Array;
  private frames = 0;

  // The broadband measure: short frames, each bin against its own floor.
  private readonly bSize: number;
  private readonly bHop: number;
  private readonly bFft: FFT;
  private readonly bWin: Float64Array;
  private readonly bFrame: Float32Array;
  private bFill = 0;
  private readonly bRe: Float64Array;
  private readonly bIm: Float64Array;
  private readonly bFloor: Float64Array;
  private bFrames = 0;
  private readonly bRise: number[] = [];
  /** Rise and time (frame centre) of recent broadband frames. */
  private readonly bT: Float64Array;
  /** The rise as a power ratio (1: no rise). */
  private readonly bPow: Float64Array;
  private bPos = 0;
  private bCount = 0;
  private cands: { hz: number; runs: number }[] = [];
  private cooldown: { hz: number; until: number }[] = [];

  private channels: Channel[] = [];
  private nextId = 0;
  private readonly onChannel: RadioOptions['onChannel'] | null;

  constructor(sampleRate: number, opts: RadioOptions = {}) {
    this.sampleRate = sampleRate;
    this.minHz = opts.minHz ?? 200;
    this.maxHz = opts.maxHz ?? 3000;
    this.maxChannels = opts.maxChannels ?? 8;
    this.D = Math.max(1, Math.round(sampleRate / frontTuning.rate));
    this.fsd = sampleRate / this.D;
    const fc = Math.min(0.42 * this.fsd, this.maxHz + 600);
    this.aa = this.D > 1 ? [new LowPass(sampleRate, fc, 0.5412), new LowPass(sampleRate, fc, 1.3066)] : [];
    const R = Math.max(1, Math.round(this.fsd / frontTuning.envRate));
    const taps = cicTaps(R);
    this.sh = {
      fsd: this.fsd,
      R,
      fe: this.fsd / R,
      taps,
      tapDelay: (taps.length - 1) / 2,
      broadband: (from, to) => this.broadband(from, to),
      leak: (c, from, to, level) => this.channels.some((o) => o !== c && o.live && Math.abs(o.hz - c.hz) <= leakTuning.hz && o.louder(from, to, level - c.skirt(Math.abs(o.hz - c.hz)))),
      onMark: opts.onMark ?? null,
    };
    this.onChannel = opts.onChannel ?? null;
    this.hist = new Float32Array(Math.round(lifeTuning.history * this.fsd));

    this.size = 1 << Math.round(Math.log2(findTuning.window * this.fsd));
    this.hop = this.size / findTuning.hops;
    this.fft = new FFT(this.size);
    this.win = hann(this.size);
    this.frame = new Float32Array(this.size);
    this.re = new Float64Array(this.size);
    this.im = new Float64Array(this.size);
    const bins = this.size / 2;
    this.db = new Float64Array(bins);
    this.held = new Float64Array(bins).fill(-200);
    this.score = new Float64Array(bins);
    this.onsets = new Float64Array(bins);
    this.was = new Uint8Array(bins);
    this.here = new Uint8Array(bins);
    this.binHz = this.fsd / this.size;
    this.lo = Math.max(findTuning.far + 1, Math.floor(this.minHz / this.binHz));
    this.hi = Math.min(bins - findTuning.far - 2, Math.ceil(this.maxHz / this.binHz));
    this.floorDb = new Float64Array(bins).fill(NaN);
    this.peakHz = new Float64Array(bins).fill(NaN);
    this.nextPeakHz = new Float64Array(bins).fill(NaN);

    this.bSize = 1 << Math.round(Math.log2(floorTuning.window * this.fsd));
    this.bHop = this.bSize / floorTuning.hops;
    this.bFft = new FFT(this.bSize);
    this.bWin = hann(this.bSize);
    this.bFrame = new Float32Array(this.bSize);
    this.bRe = new Float64Array(this.bSize);
    this.bIm = new Float64Array(this.bSize);
    this.bFloor = new Float64Array(this.bSize / 2).fill(NaN);
    const keep = Math.ceil(0.5 / (this.bHop / this.fsd));
    this.bT = new Float64Array(keep).fill(-Infinity);
    this.bPow = new Float64Array(keep).fill(1);
  }

  /** A bin's floor follows its level: up slowly, down faster, so it sits at `floorTuning.quantile` of the time below. */
  private static follow(floor: Float64Array, k: number, d: number, sec: number, warm: boolean) {
    const f = floor[k];
    if (Number.isNaN(f)) {
      floor[k] = d - floorTuning.median;
      return;
    }
    const up = floorTuning.up * sec * (warm ? 1 : 4);
    const down = (up * floorTuning.quantile) / (1 - floorTuning.quantile);
    floor[k] = d > f ? Math.min(d, f + up) : Math.max(d, f - down);
  }

  /** How far the spectrum away from the channels rose over its floor between two times, its power averaged, dB (0 or more). */
  private broadband(from: number, to: number): number {
    let sum = 0;
    let count = 0;
    const n = this.bT.length;
    for (let j = 1; j <= this.bCount; j++) {
      const i = (this.bPos - j + n) % n;
      const t = this.bT[i];
      if (t < from) break;
      if (t <= to) {
        sum += this.bPow[i];
        count++;
      }
    }
    return count ? Math.max(0, 10 * Math.log10(sum / count) - floorTuning.deadband) : 0;
  }

  /** One short frame: how far the spectrum away from the channels stands over its floor. */
  private analyseBroadband() {
    const n = this.bSize;
    for (let i = 0; i < n; i++) {
      this.bRe[i] = this.bFrame[i] * this.bWin[i];
      this.bIm[i] = 0;
    }
    this.bFft.transform(this.bRe, this.bIm);
    const binHz = this.fsd / n;
    const sec = this.bHop / this.fsd;
    const warm = ++this.bFrames * sec > 2;
    const lo = Math.max(1, Math.floor(this.minHz / binHz));
    const hi = Math.min(n / 2 - 1, Math.ceil(this.maxHz / binHz));
    const rise = this.bRise;
    rise.length = 0;
    for (let k = lo; k <= hi; k++) {
      const d = 10 * Math.log10(this.bRe[k] * this.bRe[k] + this.bIm[k] * this.bIm[k] + 1e-20);
      const hz = k * binHz;
      const clear = !this.channels.some((c) => c.live && Math.abs(c.hz - hz) < floorTuning.clearHz + binHz);
      const before = this.bFloor[k];
      RadioDetector.follow(this.bFloor, k, d, sec, warm);
      if (clear && !Number.isNaN(before)) rise.push(d - before - floorTuning.median);
    }
    let b = 0;
    if (rise.length >= floorTuning.bins) {
      rise.sort((x, y) => x - y);
      b = rise[rise.length >> 1];
    }
    const p = this.bPos;
    this.bT[p] = (this.m - n / 2) / this.fsd;
    this.bPow[p] = Math.pow(10, b / 10);
    this.bPos = (p + 1) % this.bT.length;
    if (this.bCount < this.bT.length) this.bCount++;
  }

  /** Seconds of input processed. */
  get time(): number {
    return this.n / this.sampleRate;
  }

  /**
   * How far a key event can come out behind the input it times, seconds: a
   * decoder fed these events should take the time as `time - lag`, so it does
   * not count silence the detector has not decided on yet. The filter's
   * delay, its rise and the debounce, at the slowest speed; a mark cut in two
   * gives its second key-down when the whole mark has ended, later still. A
   * new channel's marks so far all come out at once when it is passed on.
   */
  get lag(): number {
    return 1.6 * filterTuning.maxDit + 0.03;
  }

  /** Feedback from a channel's decoder: its dit length in seconds (to size that channel's filter). */
  setDit(ch: number, dit: number) {
    const c = this.channels.find((x) => x.id === ch);
    if (c) {
      c.setDit(dit);
      c.resize();
    }
  }

  /** Smoothed spectrum (dB) over the search band, for a tuning display. */
  spectrum(): { hz: number[]; db: number[] } {
    const hz: number[] = [];
    const db: number[] = [];
    for (let k = this.lo; k <= this.hi; k++) {
      hz.push(k * this.binHz);
      db.push(this.held[k]);
    }
    return { hz, db };
  }

  /** Channels now passed on: id, pitch and strength (tests and the display). */
  get signals(): { ch: number; hz: number; snr: number }[] {
    return this.channels.filter((c) => c.live).map((c) => ({ ch: c.id, hz: c.hz, snr: c.snr }));
  }

  process(input: Float32Array): RadioEvent[] {
    const out: RadioEvent[] = [];
    const D = this.D;
    for (let i = 0; i < input.length; i++) {
      this.n++;
      let x = input[i];
      if (D > 1) {
        x = this.aa[1].step(this.aa[0].step(x));
        if (++this.dcount < D) continue;
        this.dcount = 0;
      }
      this.decimated(x, out);
    }
    this.catchUp(out);
    return out;
  }

  private decimated(x: number, out: RadioEvent[]) {
    const m = this.m++;
    this.hist[this.histPos] = x;
    this.histPos = (this.histPos + 1) % this.hist.length;
    if (this.histCount < this.hist.length) this.histCount++;
    this.bFrame[this.bFill++] = x;
    if (this.bFill === this.bSize) {
      this.analyseBroadband();
      this.bFrame.copyWithin(0, this.bHop);
      this.bFill = this.bSize - this.bHop;
    }
    for (const c of this.channels) {
      if (c.next !== m || c.behind) continue;
      c.next = m + 1;
      c.push(x, m, out);
    }
    this.frame[this.fill++] = x;
    if (this.fill === this.size) {
      this.analyse(out);
      this.frame.copyWithin(0, this.hop);
      this.fill = this.size - this.hop;
    }
  }

  private analyse(out: RadioEvent[]) {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.re[i] = this.frame[i] * this.win[i];
      this.im[i] = 0;
    }
    this.fft.transform(this.re, this.im);
    const now = (this.m * this.D) / this.sampleRate;
    const hopSec = this.hop / this.fsd;
    const F = findTuning;
    const keep = Math.exp(-hopSec / F.tau);
    const fall = (10 * hopSec) / 1.5;
    const lo = this.lo;
    const hi = this.hi;
    const warm = ++this.frames * hopSec > 2;
    for (let k = lo - F.far; k <= hi + F.far; k++) {
      const p = this.re[k] * this.re[k] + this.im[k] * this.im[k];
      const d = 10 * Math.log10(p + 1e-20);
      this.db[k] = d;
      this.held[k] = Math.max(d, this.held[k] - fall);
    }
    const floors: number[] = [];
    for (let k = lo; k <= hi; k++) floors.push(this.floorDb[k]);
    floors.sort((a, b) => a - b);
    const skirt = floors[floors.length >> 1] - F.skirt;
    // Narrow peaks: each local peak against the median of the bins a little way off.
    const ring: number[] = [];
    const ringF: number[] = [];
    this.here.fill(0);
    for (let k = lo; k <= hi; k++) {
      this.score[k] *= keep;
      const d = this.db[k];
      if (!(d >= this.db[k - 1] && d >= this.db[k + 1]) || this.floorDb[k] < skirt) continue;
      ring.length = 0;
      ringF.length = 0;
      for (let j = F.near; j <= F.far; j++) {
        ring.push(this.db[k - j], this.db[k + j]);
        ringF.push(this.floorDb[k - j], this.floorDb[k + j]);
      }
      ring.sort((a, b) => a - b);
      ringF.sort((a, b) => a - b);
      const mid = ring.length >> 1;
      const stand = Math.min(d - 0.5 * (ring[mid - 1] + ring[mid]), d - 0.5 * (ringF[mid - 1] + ringF[mid]) - floorTuning.median);
      if (stand <= F.base) continue;
      // Its pitch, between bins (a parabola through the three levels), and whether it held since the last frame.
      const a = this.db[k - 1];
      const c = this.db[k + 1];
      const den = a - 2 * d + c;
      const hz = (k + (den < 0 ? (0.5 * (a - c)) / den : 0)) * this.binHz;
      this.nextPeakHz[k] = hz;
      const was = this.peakHz;
      if (!(Math.abs(was[k] - hz) <= F.steadyHz || Math.abs(was[k - 1] - hz) <= F.steadyHz || Math.abs(was[k + 1] - hz) <= F.steadyHz)) continue;
      this.score[k] += stand - F.base;
      this.here[k - 1] = this.here[k] = this.here[k + 1] = 1;
    }
    for (let k = lo; k <= hi; k++) {
      this.onsets[k] = this.onsets[k] * keep + (this.here[k] && !this.was[k] ? 1 : 0);
      this.was[k] = this.here[k];
    }
    [this.peakHz, this.nextPeakHz] = [this.nextPeakHz, this.peakHz];
    this.nextPeakHz.fill(NaN);
    for (let k = lo - F.far; k <= hi + F.far; k++) RadioDetector.follow(this.floorDb, k, this.db[k], hopSec, warm);
    this.cooldown = this.cooldown.filter((c) => c.until > now);

    // Pitches that score enough, away from every channel.
    const found: number[] = [];
    const S = (k: number) => this.score[k - 1] + this.score[k] + this.score[k + 1];
    for (let k = lo + 1; k < hi; k++) {
      const s = S(k);
      if (s < F.least) continue;
      if (!(s >= S(k - 1) && s > S(k + 1) && s >= S(k - 2) && s > S(k + 2))) continue;
      if (this.onsets[k - 1] + this.onsets[k] + this.onsets[k + 1] < F.onsets) continue;
      const sc = this.score;
      const hz = (k + (sc[k + 1] - sc[k - 1]) / (sc[k - 1] + sc[k] + sc[k + 1])) * this.binHz;
      if (this.channels.some((c) => Math.abs(c.hz - hz) < F.mergeHz)) continue;
      if (this.cooldown.some((c) => Math.abs(c.hz - hz) < F.mergeHz)) continue;
      found.push(hz);
    }
    const runs = Math.ceil(F.runSec / hopSec);
    const next: { hz: number; runs: number }[] = [];
    for (const hz of found) {
      const c = this.cands.find((x) => Math.abs(x.hz - hz) < 1.5 * this.binHz);
      next.push({ hz, runs: (c?.runs ?? 0) + 1 });
    }
    for (const c of this.cands) if (!next.some((x) => Math.abs(x.hz - c.hz) < 1.5 * this.binHz) && c.runs > 2) next.push({ hz: c.hz, runs: c.runs - 2 });
    this.cands = next;
    for (const c of this.cands) {
      if (c.runs < runs) continue;
      const tentative = this.channels.filter((x) => !x.live).length;
      if (this.channels.length >= this.maxChannels || tentative >= lifeTuning.maxTentative) break;
      if (this.channels.some((x) => Math.abs(x.hz - c.hz) < F.mergeHz)) continue;
      this.open(c.hz, now);
      c.runs = 0;
    }
    this.lifecycle(now, out);
  }

  /** A new channel at `hz`: it hears the buffered audio first, a little in each call (`catchUp`). */
  private open(hz: number, now: number) {
    const ch = new Channel(this.nextId++, hz, now, this.m - this.histCount, this.m, this.sh);
    this.onChannel?.({ ch: ch.id, hz, t: now, what: 'open' });
    this.channels.push(ch);
  }

  /** New channels hear the buffered audio, `lifeTuning.replay` samples in all, oldest channel first. */
  private catchUp(out: RadioEvent[]) {
    let budget = lifeTuning.replay;
    const L = this.hist.length;
    for (const c of this.channels) {
      while (budget > 0 && (c.next < this.m || c.behind)) {
        // Fallen out of the buffer (many new channels at once): on from the oldest sample kept.
        const oldest = this.m - this.histCount;
        if (c.next < oldest) c.next = oldest;
        c.feed(this.hist[(this.histPos - (this.m - c.next) + L) % L], c.next, out);
        budget--;
      }
      if (budget <= 0) break;
    }
  }

  /** New channels passed on or dropped, silent ones dropped, signal updates. */
  private lifecycle(now: number, out: RadioEvent[]) {
    const keep: Channel[] = [];
    for (const c of this.channels) {
      if (!c.live) {
        // Passed on only once it has caught up with the live input, so its events stay in order.
        if (c.confirmed && c.next === this.m && !c.behind) {
          c.live = true;
          this.onChannel?.({ ch: c.id, hz: c.hz, t: now, what: 'live' });
          out.push({ type: 'signal', ch: c.id, hz: c.hz, snr: c.snr, t: now });
          c.lastSignal = { t: now, hz: c.hz, snr: c.snr };
          out.push(...c.held);
          c.held = [];
        } else if (now - c.born > lifeTuning.tentative) {
          this.onChannel?.({ ch: c.id, hz: c.hz, t: now, what: 'unheard' });
          this.cooldown.push({ hz: c.hz, until: now + lifeTuning.cooldown });
          continue;
        }
      } else if (now - Math.max(c.born, c.lastMarkEnd) > lifeTuning.gone) {
        c.close(now, out);
        out.push({ type: 'gone', ch: c.id, t: now });
        this.onChannel?.({ ch: c.id, hz: c.hz, t: now, what: 'gone' });
        // Not opened again on the same buffered audio.
        this.cooldown.push({ hz: c.hz, until: now + lifeTuning.history });
        continue;
      } else if (c.fresh && now - c.lastSignal.t >= 0.5 && (Math.abs(c.hz - c.lastSignal.hz) >= 2 || Math.abs(c.snr - c.lastSignal.snr) >= 3)) {
        c.fresh = false;
        out.push({ type: 'signal', ch: c.id, hz: c.hz, snr: c.snr, t: now });
        c.lastSignal = { t: now, hz: c.hz, snr: c.snr };
      }
      keep.push(c);
    }
    this.channels = keep;
  }
}
