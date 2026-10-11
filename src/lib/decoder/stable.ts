// What the screen shows while you key. Like an operator copying, a word is
// written down a few letters after it ends and is not changed after that:
// keying faster or slower later on must not rewrite what you already read.
// Each new reading still uses the whole over, so the fist is learned from
// everything, but it has to begin with the words written down.

import type { DecoderModel, DecoderOutput } from './decoder';
import type { Kept } from './settle';

type Marks = { start: number; end: number }[];
export type Reread = (model: DecoderModel, marks: Marks, until: number | undefined, keep: Kept[], full?: boolean) => Promise<DecoderOutput[]>;

/**
 * Marks keyed after a word before it is written down (five or six letters),
 * and the word is written from a full search, not the quick one used while
 * keying. Sooner costs accuracy: a beginner's early letters are read from too
 * little of their keying. On the beginner scorecard, 96 overs per fist, the
 * mean error against reading the whole over again was +1.8 points at 12
 * marks, +1.6 at 16 and +0.6 at 20; writing a word down as soon as the next
 * one began, with the quick search, about doubled it.
 */
export const WRITE_AFTER = 20;

export class StableReading {
  /** Whole words written down, each with the space after it. */
  private written: DecoderOutput[] = [];
  private last: DecoderOutput[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private latest = 0;
  private epoch = 0;

  constructor(private reread: Reread) {}

  /** A new over. */
  reset() {
    this.written = [];
    this.last = [];
    this.epoch++;
    this.latest++;
  }

  /** While keying: the words written down, then the rest read again. */
  update(model: DecoderModel, marks: Marks, until: number): Promise<DecoderOutput[]> {
    const n = ++this.latest;
    const epoch = this.epoch;
    return this.serial(async () => {
      // A newer request is waiting; this reading would never be shown.
      if (n !== this.latest || epoch !== this.epoch) return this.last;
      let out = await this.read(model, marks, until);
      if (epoch !== this.epoch) return out;
      let cut = this.cut(out);
      if (cut >= 0) {
        // A word is due to be written down: read it with the full search first.
        out = await this.read(model, marks, until, true);
        if (epoch !== this.epoch) return out;
        cut = this.cut(out);
      }
      this.written.push(...out.slice(this.written.length, this.written.length + cut + 1));
      this.last = out;
      return out;
    });
  }

  /** End of the over: what is not written down is read once more with the full search. Then a new over. */
  finish(model: DecoderModel, marks: Marks): Promise<DecoderOutput[]> {
    this.latest++;
    return this.serial(async () => {
      const out = marks.length ? await this.read(model, marks) : [];
      this.reset();
      return out;
    });
  }

  /** Index (after the written words) of the last space followed by WRITE_AFTER marks, or -1. */
  private cut(out: DecoderOutput[]): number {
    const tail = out.slice(this.written.length);
    let after = 0;
    for (let i = tail.length - 1; i >= 0; i--) {
      const o = tail[i];
      if (o.kind === 'char') after += o.char.marks.length;
      else if (i < tail.length - 1 && after >= WRITE_AFTER) return i;
    }
    return -1;
  }

  private async read(model: DecoderModel, marks: Marks, until?: number, full = false): Promise<DecoderOutput[]> {
    const keep: Kept[] = [];
    this.written.forEach((o, i) => {
      if (o.kind === 'char') keep.push({ pattern: o.char.pattern, space: this.written[i + 1]?.kind === 'space' });
    });
    const out = await this.reread(model, marks, until, keep, full);
    // The written words come back as they were; keep the very same objects.
    return [...this.written, ...out.slice(this.written.length)];
  }

  private serial<T>(f: () => Promise<T>): Promise<T> {
    const run = this.queue.then(f, f);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
