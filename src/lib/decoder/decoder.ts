// Key-down/key-up times in, characters and word breaks out.
//
// Dit and dah lengths come from 2-means clustering of recent marks in log
// space, so speed changes and heavy or light weighting are tracked rather than
// assumed. Gaps are split the same way: element gaps inside a character, then
// character gaps versus word gaps. Farnsworth spacing therefore decodes too.

import { tokenOf } from '../morse/code';
import { kmeans2 } from './kmeans';

export interface DecodedMark {
  start: number;
  end: number;
  kind: 'dit' | 'dah';
}

export interface DecodedChar {
  /** Token, or null when the pattern is not a known character. */
  token: string | null;
  /** '.'/'-' string, internal only (never shown to people). */
  pattern: string;
  marks: DecodedMark[];
  start: number;
  end: number;
  /** 0..1: how cleanly the element timings fit their classes. */
  confidence: number;
  /** Character speed estimate when it was decoded. */
  wpm: number;
}

export type DecoderOutput =
  | { kind: 'char'; char: DecodedChar }
  | { kind: 'space'; t: number; gap: number };

export interface DecoderOptions {
  /** Expected character speed, to start the estimates. */
  initialWpm?: number;
  /** Expected effective (Farnsworth) speed, if slower than character speed. */
  initialEffectiveWpm?: number;
}

const MARK_WINDOW = 20;
const GAP_WINDOW = 30;

export class Decoder {
  private dit: number;
  private dah: number;
  private elemGap: number;
  private charGap: number;
  private wordBoundaryEst: number;

  private marks: number[] = [];
  private interGaps: number[] = [];

  private down = false;
  private downAt = 0;
  private lastUp = -1;
  private pending: DecodedMark[] = [];
  private charsSinceSpace = 0;
  private spaceEmitted = true;

  /** Every decoded character, for fist analysis and replay. */
  readonly history: DecodedChar[] = [];

  constructor(opts: DecoderOptions = {}) {
    const wpm = opts.initialWpm ?? 15;
    this.dit = 1.2 / wpm;
    this.dah = 3 * this.dit;
    this.elemGap = this.dit;
    const eff = opts.initialEffectiveWpm ?? wpm;
    if (eff < wpm) {
      const ta = (60 * wpm - 37.2 * eff) / (wpm * eff);
      this.charGap = (3 * ta) / 19;
      this.wordBoundaryEst = Math.sqrt(this.charGap * ((7 * ta) / 19));
    } else {
      this.charGap = 3 * this.dit;
      this.wordBoundaryEst = 5 * this.dit;
    }
  }

  get ditEstimate(): number {
    return this.dit;
  }

  get wpm(): number {
    return 1.2 / this.dit;
  }

  get isKeyDown(): boolean {
    return this.down;
  }

  /** Boundary between a gap inside a character and a gap between characters. */
  get charBoundary(): number {
    const g = Math.sqrt(this.elemGap * this.charGap);
    return Math.min(2.6 * this.elemGap, Math.max(1.6 * this.elemGap, g));
  }

  /** Boundary between a character gap and a word gap. */
  get wordBoundary(): number {
    return Math.max(this.charBoundary * 1.5, this.wordBoundaryEst);
  }

  keyDown(t: number): DecoderOutput[] {
    const out = this.tick(t);
    if (this.down) return out;
    if (this.lastUp >= 0) {
      const gap = t - this.lastUp;
      if (this.pending.length) {
        if (gap < this.charBoundary) this.learnElemGap(gap);
        else {
          out.push(...this.finishChar());
          this.learnInterGap(gap);
          if (gap >= this.wordBoundary) out.push(...this.emitSpace(t, gap));
        }
      } else {
        this.learnInterGap(gap);
      }
    }
    this.down = true;
    this.downAt = t;
    return out;
  }

  keyUp(t: number): DecoderOutput[] {
    if (!this.down) return [];
    this.down = false;
    const d = t - this.downAt;
    this.lastUp = t;
    // Ignore clicks and glitches far shorter than a dit.
    if (d < Math.max(0.008, 0.25 * this.dit)) return [];
    // A very long mark is a tuning carrier or a stuck key, not a character.
    if (d > Math.max(1.2, 5 * this.dah)) {
      this.pending = [];
      return [];
    }
    this.learnMark(d);
    // Classified when the character ends, with the freshest speed estimate.
    this.pending.push({ start: this.downAt, end: t, kind: 'dit' });
    return [];
  }

  /** Call often while idle: emits characters and word breaks as silence grows. */
  tick(now: number): DecoderOutput[] {
    const out: DecoderOutput[] = [];
    if (this.down || this.lastUp < 0) return out;
    const silence = now - this.lastUp;
    if (this.pending.length && silence >= this.charBoundary) out.push(...this.finishChar());
    if (!this.pending.length && !this.spaceEmitted && this.charsSinceSpace > 0 && silence >= this.wordBoundary) {
      out.push(...this.emitSpace(now, silence));
    }
    return out;
  }

  /** Emits whatever is pending (end of a drill or over). */
  flush(now: number): DecoderOutput[] {
    if (this.down) this.keyUp(now);
    const out: DecoderOutput[] = [];
    if (this.pending.length) out.push(...this.finishChar());
    return out;
  }

  private finishChar(): DecoderOutput[] {
    const marks = this.pending;
    this.pending = [];
    if (!marks.length) return [];
    const boundary = Math.sqrt(this.dit * this.dah);
    for (const m of marks) m.kind = m.end - m.start < boundary ? 'dit' : 'dah';
    const pattern = marks.map((m) => (m.kind === 'dit' ? '.' : '-')).join('');
    const token = tokenOf(pattern) ?? null;
    const char: DecodedChar = {
      token,
      pattern,
      marks,
      start: marks[0].start,
      end: marks[marks.length - 1].end,
      confidence: token ? this.confidenceOf(marks) : 0,
      wpm: this.wpm,
    };
    this.history.push(char);
    this.charsSinceSpace++;
    this.spaceEmitted = false;
    return [{ kind: 'char', char }];
  }

  private emitSpace(t: number, gap: number): DecoderOutput[] {
    if (this.spaceEmitted || this.charsSinceSpace === 0) return [];
    this.spaceEmitted = true;
    this.charsSinceSpace = 0;
    return [{ kind: 'space', t, gap }];
  }

  private confidenceOf(marks: DecodedMark[]): number {
    const lb = Math.log(Math.sqrt(this.dit * this.dah));
    const span = Math.max(1e-6, Math.log(this.dah) - lb);
    let worst = 1;
    for (const m of marks) {
      const l = Math.log(m.end - m.start);
      const centre = m.kind === 'dit' ? Math.log(this.dit) : Math.log(this.dah);
      const margin = Math.abs(l - lb) / span;
      const off = Math.abs(l - centre) / span;
      worst = Math.min(worst, Math.max(0, Math.min(1, margin)) * (1 - Math.min(0.5, off * 0.5)));
    }
    return worst;
  }

  private learnMark(d: number) {
    const before = this.dit;
    const l = Math.log(d);
    this.marks.push(l);
    if (this.marks.length > MARK_WINDOW) this.marks.shift();

    let done = false;
    if (this.marks.length >= 3) {
      // Seed from the extremes so a big speed change separates at once.
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of this.marks) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo >= Math.log(1.8)) {
        const { low, high, nLow, nHigh } = kmeans2(this.marks, lo, hi);
        if (nLow >= 1 && nHigh >= 1 && high - low >= Math.log(1.8)) {
          const w = this.marks.length >= 6 ? 0.5 : 0.8;
          this.dit = Math.exp(Math.log(this.dit) * (1 - w) + low * w);
          this.dah = Math.exp(Math.log(this.dah) * (1 - w) + high * w);
          done = true;
        }
      }
    }
    if (!done) {
      // One class only: nudge whichever class it is nearer, keep the ratio.
      const ratio = this.dah / this.dit;
      // Trust the first marks more: the starting guess may be far off.
      const rate = this.marks.length <= 2 ? 0.8 : 0.3;
      const nearDit = Math.abs(l - Math.log(this.dit)) <= Math.abs(l - Math.log(this.dah));
      if (nearDit) {
        this.dit = Math.exp(Math.log(this.dit) + (l - Math.log(this.dit)) * rate);
        this.dah = this.dit * ratio;
      } else {
        this.dah = Math.exp(Math.log(this.dah) + (l - Math.log(this.dah)) * rate);
        this.dit = this.dah / ratio;
      }
    }
    this.dit = Math.min(0.5, Math.max(0.015, this.dit));
    this.dah = Math.min(5 * this.dit, Math.max(2 * this.dit, this.dah));

    // Gaps follow the speed: rescale their estimates by the same factor.
    const scale = this.dit / before;
    if (Math.abs(Math.log(scale)) > 0.02) {
      this.elemGap *= scale;
      this.charGap *= scale;
      this.wordBoundaryEst *= scale;
      const ls = Math.log(scale);
      for (let i = 0; i < this.interGaps.length; i++) this.interGaps[i] += ls;
    }
  }

  private learnElemGap(g: number) {
    if (g < 0.2 * this.dit) return;
    this.elemGap += (g - this.elemGap) * 0.2;
    this.elemGap = Math.min(2 * this.dit, Math.max(0.4 * this.dit, this.elemGap));
  }

  private learnInterGap(g: number) {
    if (g > 30 * this.dit + 3) return; // a pause, not spacing
    this.interGaps.push(Math.log(g));
    if (this.interGaps.length > GAP_WINDOW) this.interGaps.shift();
    if (this.interGaps.length < 2) {
      if (g < this.wordBoundary) this.charGap += (g - this.charGap) * 0.3;
      return;
    }
    const sorted = [...this.interGaps].sort((a, b) => a - b);
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    if (hi - lo >= Math.log(1.5)) {
      const { low, high, nLow, nHigh } = kmeans2(this.interGaps, lo, hi);
      if (nLow >= 1 && nHigh >= 1 && high - low >= Math.log(1.5)) {
        this.charGap = Math.exp(low);
        this.wordBoundaryEst = Math.exp((low + high) / 2);
        return;
      }
    }
    // One cluster. Most words have several letters, so it is character gaps
    // (Farnsworth makes them long); word gaps are well beyond it.
    const centre = Math.exp(sorted[Math.floor(sorted.length / 2)]);
    this.charGap = centre;
    this.wordBoundaryEst = Math.max(1.7 * centre, 4 * this.elemGap);
  }
}
