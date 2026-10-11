// Turns per-frame evidence (the logit that the tone is on) into marks: an
// on/off hidden Markov model whose on and off states each have a minimum
// duration tied to the dit, decoded by Viterbi with a fixed lag. A frame's
// state is committed once `lag` more frames have been seen, so one weak frame
// cannot split a dah and one noisy frame cannot veto a run of steady tone.
// See docs/research/hearing-the-key.md, E3.

/** Tests sweep it. */
export const segmenterTuning = { offDits: 1.2 };

export interface SegmenterOptions {
  /** Frame length, seconds. */
  frame: number;
  /** Frames of look-ahead before a frame's state is committed. */
  lag: number;
  /** Scale on the evidence: frames are correlated, so each counts for less. */
  alpha: number;
}

export class Segmenter {
  private minOn = 2;
  private minOff = 2;
  private lsOn = 0;
  private lgOn = 0;
  private lsOff = 0;
  private lgOff = 0;
  private S = 4;
  private score = new Float64Array(4);
  /** Back-pointers for the last lag+1 frames. */
  private back: Int16Array[] = [];
  private t = 0;
  /** The committed state of the last committed frame. */
  private committedOn = false;

  constructor(
    private readonly opts: SegmenterOptions,
    dit: number,
  ) {
    // Minimum durations are fixed at the start (0.3 dit, 15 to 30 ms; a quick
    // hand's gap inside a letter can be half a dit): they shape the state
    // space, and rebuilding it would lose the frames in flight.
    const f = opts.frame;
    this.minOn = Math.max(2, Math.round(Math.min(0.03, Math.max(0.015, 0.3 * dit)) / f));
    this.minOff = this.minOn;
    this.S = this.minOn + this.minOff;
    this.score = new Float64Array(this.S).fill(-Infinity);
    this.score[this.S - 1] = 0;
    this.configure(dit);
  }

  /**
   * Expected durations follow the dit (`offDits`: the typical gap, in dits;
   * most gaps are inside a letter, about one dit). Applied in place.
   */
  configure(dit: number) {
    const f = this.opts.frame;
    const stayOn = 1 - 1 / Math.max(2, (1.2 * dit) / f);
    const stayOff = 1 - 1 / Math.max(2, (segmenterTuning.offDits * dit) / f);
    this.lsOn = Math.log(stayOn);
    this.lgOn = Math.log(1 - stayOn);
    this.lsOff = Math.log(stayOff);
    this.lgOff = Math.log(1 - stayOff);
  }

  /**
   * One frame of evidence. Returns the committed state of the frame `lag`
   * frames back (true: tone on), or null while fewer have been seen.
   */
  push(logit: number): boolean | null {
    const S = this.S;
    const next = new Float64Array(S).fill(-Infinity);
    const bp = new Int16Array(S);
    const set = (to: number, from: number, v: number) => {
      if (v > next[to]) {
        next[to] = v;
        bp[to] = from;
      }
    };
    for (let s = 0; s < S; s++) {
      const v = this.score[s];
      if (v === -Infinity) continue;
      if (s < this.minOn - 1) set(s + 1, s, v);
      else if (s === this.minOn - 1) {
        set(s, s, v + this.lsOn);
        set(this.minOn, s, v + this.lgOn);
      } else if (s < S - 1) set(s + 1, s, v);
      else {
        set(s, s, v + this.lsOff);
        set(0, s, v + this.lgOff);
      }
    }
    const e = (this.opts.alpha * logit) / 2;
    let max = -Infinity;
    for (let s = 0; s < S; s++) {
      if (next[s] > -Infinity) next[s] += s < this.minOn ? e : -e;
      if (next[s] > max) max = next[s];
    }
    // Keep the numbers small.
    for (let s = 0; s < S; s++) next[s] -= max;
    this.score = next;
    this.back.push(bp);
    this.t++;
    if (this.back.length <= this.opts.lag) return null;
    // Trace back `lag` frames from the best state now.
    let s = 0;
    for (let k = 1; k < S; k++) if (this.score[k] > this.score[s]) s = k;
    for (let k = this.back.length - 1; k > this.back.length - 1 - this.opts.lag; k--) s = this.back[k][s];
    this.back.shift();
    this.committedOn = s < this.minOn;
    return this.committedOn;
  }

  /** Frames pushed so far. */
  get frames(): number {
    return this.t;
  }
}
