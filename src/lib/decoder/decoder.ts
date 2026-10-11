// Key-down/key-up times in, characters and word breaks out.
//
// Dit and dah lengths come from 2-means clustering of recent marks in log
// space, so speed changes and heavy or light weighting are tracked rather than
// assumed. Gaps are learned on their own, from every recent gap: natural
// breaks split them into element, character and word gaps. Hand keying needs
// this, since its gaps do not follow its marks (short taps, long pauses), and
// Farnsworth spacing decodes the same way.

import { tokenOf } from '../morse/code';
import { kmeans2 } from './kmeans';
import { gapClasses } from './breaks';
import { LIVE, settleOver, type Kept } from './settle';

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

/** A click or glitch far shorter than a dit (a key's thump, a contact bounce): not a mark. */
export function isGlitch(duration: number, dit: number): boolean {
  return duration < Math.max(0.008, 0.25 * dit);
}

export interface DecoderOptions {
  /** Expected character speed, to start the estimates. */
  initialWpm?: number;
  /** Expected effective (Farnsworth) speed, if slower than character speed. */
  initialEffectiveWpm?: number;
  /** Start from what another decoder learned (for a second pass over the same keying). */
  model?: DecoderModel;
}

/** What a decoder has learned about a fist. */
export interface DecoderModel {
  dit: number;
  dah: number;
  elemGap: number;
  charGap: number;
  wordBoundaryEst: number;
  gapModel: boolean;
  charSplit: number;
  farnsworth: boolean;
  marks: number[];
  gaps: number[];
}

const MARK_WINDOW = 20;
const GAP_WINDOW = 40;
/** Minimum ratio between class means for gaps to count as separate classes. */
const ELEM_CHAR = Math.log(1.8);
const CHAR_WORD = Math.log(1.6);

export class Decoder {
  private dit: number;
  private dah: number;
  private elemGap: number;
  private charGap: number;
  private wordBoundaryEst: number;

  private marks: number[] = [];
  /** Every recent gap between marks (log seconds), whatever it was classed as. */
  private gaps: number[] = [];
  /** True once the gaps themselves have shown element and character classes. */
  private gapModel = false;
  /** Learned boundary between element and character gaps (the density valley). */
  private charSplit = 0;
  /** False in a second pass: the gap model is final and gaps are not relearned. */
  private learnGaps = true;
  private farnsworth: boolean;

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
    this.farnsworth = eff < wpm;
    if (eff < wpm) {
      const ta = (60 * wpm - 37.2 * eff) / (wpm * eff);
      this.charGap = (3 * ta) / 19;
      this.wordBoundaryEst = Math.sqrt(this.charGap * ((7 * ta) / 19));
    } else {
      this.charGap = 3 * this.dit;
      this.wordBoundaryEst = 5 * this.dit;
    }
    const m = opts.model;
    if (m) {
      Object.assign(this, {
        dit: m.dit,
        dah: m.dah,
        elemGap: m.elemGap,
        charGap: m.charGap,
        wordBoundaryEst: m.wordBoundaryEst,
        gapModel: m.gapModel,
        charSplit: m.charSplit,
        farnsworth: m.farnsworth,
      });
      this.marks = [...m.marks];
      this.gaps = [...m.gaps];
    }
  }

  /** A copy of what has been learned, to seed a second pass. */
  model(): DecoderModel {
    return {
      dit: this.dit,
      dah: this.dah,
      elemGap: this.elemGap,
      charGap: this.charGap,
      wordBoundaryEst: this.wordBoundaryEst,
      gapModel: this.gapModel,
      charSplit: this.charSplit,
      farnsworth: this.farnsworth,
      marks: [...this.marks],
      gaps: [...this.gaps],
    };
  }

  /**
   * Decodes marks again from a learned model: the second pass at the end of an
   * over, so characters keyed before the fist was learned come out right too.
   */
  static redecode(model: DecoderModel, marks: { start: number; end: number }[], until?: number, keep?: Kept[], full = false): DecoderOutput[] {
    // The whole-over search (settle.ts): per-letter tempo, the fist refitted
    // from the reading, and a light language model for what timing leaves open.
    // While an over is still open (`until`), a quicker search: it runs on every
    // letter (`full` asks for the full one anyway). `keep`: letters already
    // written down, which the reading must begin with.
    const settled = settleOver(marks, model, until, { ...(until === undefined || full ? {} : LIVE), keep });
    if (settled.length || !marks.length) return settled;
    // Should the search ever come back empty, the live reading stands.
    return Decoder.greedy(model, marks, until);
  }

  /** One pass with a learned model and no search: the fallback. */
  private static greedy(model: DecoderModel, marks: { start: number; end: number }[], until?: number): DecoderOutput[] {
    const d = new Decoder({ model });
    d.learnGaps = !model.gapModel;
    const out: DecoderOutput[] = [];
    for (const m of marks) out.push(...d.keyDown(m.start), ...d.keyUp(m.end));
    if (until === undefined) out.push(...d.flush(marks[marks.length - 1].end + 30));
    else out.push(...d.tick(until));
    return out;
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
    // Learned from the gaps themselves: the valley between the classes.
    if (this.gapModel) return this.charSplit;
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
      if (this.pending.length && gap >= this.charBoundary) {
        out.push(...this.finishChar());
        if (gap >= this.wordBoundary) out.push(...this.emitSpace(t, gap));
      }
      this.learnGap(gap);
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
    if (isGlitch(d, this.dit)) return [];
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
    // Not a character as keyed: two letters ran together. Split at the longest
    // gaps inside until every piece is a character, as a listener would.
    const pieces = this.repair(marks) ?? [marks];
    const out: DecoderOutput[] = [];
    for (const piece of pieces) {
      const pattern = piece.map((m) => (m.kind === 'dit' ? '.' : '-')).join('');
      const token = tokenOf(pattern) ?? null;
      const char: DecodedChar = {
        token,
        pattern,
        marks: piece,
        start: piece[0].start,
        end: piece[piece.length - 1].end,
        confidence: token ? this.confidenceOf(piece) : 0,
        wpm: this.wpm,
      };
      this.history.push(char);
      this.charsSinceSpace++;
      this.spaceEmitted = false;
      out.push({ kind: 'char', char });
    }
    return out;
  }

  /**
   * Splits an unknown pattern into known characters at its longest internal
   * gaps (longest first), or null when no split works. A cut needs a gap that
   * stands out: longer than the character's other gaps (1.3 times their
   * median) and at least half the character boundary. Evenly keyed elements
   * are never cut.
   */
  private repair(marks: DecodedMark[], depth = 0): DecodedMark[][] | null {
    const pattern = marks.map((m) => (m.kind === 'dit' ? '.' : '-')).join('');
    if (tokenOf(pattern)) return [marks];
    if (marks.length < 2 || depth > 3) return null;
    const gaps = marks.slice(1).map((m, i) => ({ at: i + 1, gap: m.start - marks[i].end }));
    const median = (xs: number[]) => {
      const v = [...xs].sort((x, y) => x - y);
      return v.length ? v[Math.floor(v.length / 2)] : 0;
    };
    const cuts = gaps
      .filter((c) => {
        const others = gaps.filter((o) => o !== c).map((o) => o.gap);
        return c.gap >= 0.5 * this.charBoundary && (!others.length || c.gap >= 1.3 * median(others));
      })
      .sort((x, y) => y.gap - x.gap)
      .slice(0, 3);
    for (const c of cuts) {
      const left = this.repair(marks.slice(0, c.at), depth + 1);
      const right = left && this.repair(marks.slice(c.at), depth + 1);
      if (left && right) return [...left, ...right];
    }
    return null;
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
      // Seed from near the extremes, so a big speed change separates within a
      // few marks, but one or two clicks cannot pose as the dit (learned, a
      // click shrinks the dit and lets the next clicks through).
      const sorted = [...this.marks].sort((a, b) => a - b);
      const cut = Math.floor(sorted.length / 8);
      const lo = sorted[cut];
      const hi = sorted[sorted.length - 1 - cut];
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

    // Until the gaps have shown their own classes, assume they follow the speed.
    const scale = this.dit / before;
    if (!this.gapModel && Math.abs(Math.log(scale)) > 0.02) {
      this.elemGap *= scale;
      this.charGap *= scale;
      this.wordBoundaryEst *= scale;
    }
  }

  private learnGap(g: number) {
    if (!this.learnGaps) return;
    if (g > 30 * this.dit + 3) return; // a pause, not spacing
    if (g < 0.3 * this.dit) return; // a dropout inside a mark
    this.gaps.push(Math.log(g));
    if (this.gaps.length > GAP_WINDOW) this.gaps.shift();
    this.fitGaps();
  }

  /** Splits recent gaps into element, character and word classes (see breaks.ts). */
  private fitGaps() {
    if (this.gaps.length < 3) return;
    const c = gapClasses(this.gaps);
    const modes = [...c.modes];
    const valleys = [...c.valleys];
    const counts = [...c.counts];
    const n = this.gaps.length;
    // Element gaps are a large share of all gaps (even all-E/T text has more
    // than a fifth); a small group below them is a few hurried gaps, not a class.
    while (modes.length > 1 && counts[0] < Math.max(2, 0.2 * n)) {
      counts[1] += counts[0];
      modes.shift();
      valleys.shift();
      counts.shift();
    }
    // A single stray gap between two classes joins the nearer one.
    for (let i = 1; i < modes.length - 1; i++) {
      if (counts[i] >= 2) continue;
      const intoLower = modes[i] - modes[i - 1] <= modes[i + 1] - modes[i];
      if (intoLower) {
        counts[i - 1] += counts[i];
        valleys.splice(i - 1, 1);
      } else {
        counts[i + 1] += counts[i];
        valleys.splice(i, 1);
      }
      modes.splice(i, 1);
      counts.splice(i, 1);
      i--;
    }
    if (modes.length >= 2 && modes[1] - modes[0] >= ELEM_CHAR) {
      this.elemGap = Math.exp(modes[0]);
      this.charGap = Math.exp(modes[1]);
      this.charSplit = Math.exp(valleys[0]);
      this.wordBoundaryEst = valleys.length >= 2 && modes[2] - modes[1] >= CHAR_WORD ? Math.exp(valleys[1]) : 1.7 * this.charGap;
      this.gapModel = true;
      return;
    }
    // One class only (a single long character, or single-element letters):
    // keep the current estimates.
  }
}
