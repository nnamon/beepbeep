// One signal on the radio read as continuous text: the Radio tab's reader for
// one channel of the detector. Key-down and key-up times come in; words come
// out, written once and never changed, in lines that read like a log.
//
// It is built from the decoder for your own keying (decoder.ts for the speed
// and the gaps, settle.ts for reading an over as a whole, stable.ts for
// writing words down) and adds what a radio needs:
//
//  - Nobody presses "Done sending": an over ends at a silence of several word
//    gaps (and never under a second). Each over is read by the search on its
//    own, so a station's own pauses mid-over cost nothing, and the next
//    station is read from its own marks.
//  - A QSO on one channel: the two stations take turns at their own speeds,
//    and the pause between them can be as short as a word gap. The first
//    marks after each word gap are checked against the speed before it; a
//    clear change starts a new over there.
//  - Hours of listening: the search sees a window of the current over (the
//    words still being read and some written ones before them), and every
//    list is capped, so memory and time per mark stay flat.
//  - A detector's errors: a silence far shorter than any gap inside a letter
//    is a fade, and the mark goes on; a mark far shorter than a dit is a click
//    and is dropped; an over too sparse to be code (static) shows nothing.
//  - Lines: a new line at each over, and after a word that hands over (K, KN,
//    SK, BK).
//
// In the browser the search runs in the shared worker (redecode.ts), one
// search at a time for all channels: ends of overs first, then the rest.
// Without workers (Node, tests) it runs in place and the text is up to date
// as soon as a key event or tick returns.

import { Decoder, isHeld, type DecodedChar, type DecoderModel, type DecoderOutput } from '../decoder/decoder';
import { kmeans2 } from '../decoder/kmeans';
import { redecodeAsync } from '../decoder/redecode';
import type { Kept } from '../decoder/settle';

export interface Mark {
  start: number;
  end: number;
}

/** Settings; tests sweep them. */
export const channelTuning = {
  /** An over ends after a silence of this many word boundaries of the fist (between letter and word gaps), and never under `minOver` seconds. */
  overWords: 3,
  minOver: 1,
  /** Marks keyed after a word before it is written down (stable.ts uses 20 for beginners). */
  writeAfter: 20,
  /** Words are written in batches, once the first word waiting has this many marks more after it (with `writeFull`, fewer full searches). */
  writeBatch: 0,
  /**
   * Words are written from the full search (true), or from the quick one used
   * while keying, about a third of the work. On 11 band scenarios with a
   * detector's errors the two read the same (21.2% of letters wrong).
   */
  writeFull: false,
  /** The over is read again at each word gap, or after this many new marks without one. */
  readEvery: 12,
  /** A word gap is checked for a change of station once this many marks follow it, against up to `changeBefore` marks before it (at least `changeMin`). */
  changeAfter: 10,
  changeBefore: 24,
  changeMin: 6,
  /**
   * The speed change (log) that starts a new over at a word gap, and how much
   * better the new speed must fit the marks and gaps after it (`speedShift`).
   */
  change: Math.log(1.2),
  changeGain: 1,
  /** Errors (log) larger than this count no more: a false mark or a fade costs the same at any speed. */
  shiftClip: 0.35,
  /** The largest change of speed looked for (log): 2 times either way. */
  shiftMax: Math.log(2),
  /**
   * Marks shorter than this many dits are clicks, noise or a fade's pieces,
   * not dits (the decoder for your own keying drops under a quarter). On 11
   * band scenarios with a detector's errors, 19.3% of letters wrong against
   * 20.4% at a quarter; at 0.45 a station three times as fast loses its dits.
   */
  minMark: 0.35,
  /** Written marks kept in the search's window before the words still being read. */
  context: 40,
  /** The window is trimmed when its written marks pass `context` by this many. */
  trimAfter: 60,
  /**
   * A silence shorter than this many dits inside a mark is a fade, and the
   * mark goes on: no gap inside a letter is that short (a keyer's are a dit, a
   * hand's at least half of one).
   */
  dropout: 0.4,
  /** Marks not yet written that force an over to end (no word gap for this long is not text). */
  maxUnwritten: 150,
  /** The text keeps its last this many characters. */
  textCap: 20000,
  /**
   * Noise, not code: an over of fewer marks than this, or whose marks fill
   * less than `minDuty` of the time they span, writes nothing. Code keeps the
   * key down a third to a half of the time; a code-practice broadcast at 18
   * wpm characters and 5 overall about 12%; scattered clicks of static a few
   * percent.
   */
  minMarks: 2,
  minDuty: 0.08,
};

/** Words after which the other station takes over: the next word starts a new line. */
const HAND_OVER = new Set(['K', 'KN', '<KN>', '<SK>', 'BK', '<BK>']);

/** A reading of an over: the whole-over search (settle.ts) with what is written down. */
export type ChannelRead = (model: DecoderModel, marks: Mark[], until: number | undefined, keep: Kept[], full: boolean, prefer?: Kept[]) => DecoderOutput[] | Promise<DecoderOutput[]>;

const inPlace: ChannelRead = (model, marks, until, keep, full, prefer) => Decoder.redecode(model, marks, until, keep, full, prefer);

type Maybe<T> = T | Promise<T>;
const then = <T, U>(x: Maybe<T>, f: (v: T) => Maybe<U>): Maybe<U> => (x instanceof Promise ? x.then(f) : f(x));

/**
 * One search at a time for every channel, through the one worker: an over's
 * end goes first, then readings while keying, oldest request first.
 */
class SearchQueue {
  private waiting: { prio: number; seq: number; go: () => void }[] = [];
  private busy = false;
  private seq = 0;

  turn(prio: number): Promise<() => void> {
    return new Promise((resolve) => {
      this.waiting.push({ prio, seq: ++this.seq, go: () => resolve(() => this.release()) });
      this.next();
    });
  }

  private release() {
    this.busy = false;
    this.next();
  }

  private next() {
    if (this.busy || !this.waiting.length) return;
    this.waiting.sort((a, b) => a.prio - b.prio || a.seq - b.seq);
    const w = this.waiting.shift()!;
    this.busy = true;
    w.go();
  }
}

const shared = new SearchQueue();

export interface Speed {
  dit: number;
  dah: number;
}

/**
 * Dit and dah lengths from a few marks: the medians of the short and the long
 * ones, split by 2-means in log time. Null when the marks are all of one
 * length (all dits or all dahs), too few, or the two lengths are not a dit
 * and a dah apart (1.8 to 4.5 times: a fade's pieces or false marks are not
 * dits).
 */
export function fitSpeed(marks: readonly Mark[]): Speed | null {
  if (marks.length < 4) return null;
  const sorted = marks.map((m) => Math.log(m.end - m.start)).sort((a, b) => a - b);
  // Seeded at the shortest and longest, except one far from the rest (a click or two marks run together).
  const last = sorted.length - 1;
  const apart = Math.log(1.6);
  let i = 0;
  while (i < last - 1 && sorted[i + 1] - sorted[i] > apart) i++;
  if (sorted[last] - sorted[i] < apart) i = 0;
  let j = last;
  while (j > i + 1 && sorted[j] - sorted[j - 1] > apart) j--;
  if (sorted[j] - sorted[i] < apart) j = last;
  const k = kmeans2(sorted, sorted[i], sorted[j]);
  if (k.nLow < 1 || k.nHigh < 1 || k.high - k.low < Math.log(1.6)) return null;
  const mid = (k.low + k.high) / 2;
  const lo = sorted.filter((x) => x < mid);
  const hi = sorted.filter((x) => x >= mid);
  const med = (xs: number[]) => xs[xs.length >> 1];
  const s = { dit: Math.exp(med(lo)), dah: Math.exp(med(hi)) };
  return s.dah / s.dit >= 1.8 && s.dah / s.dit <= 4.5 ? s : null;
}

/** A fist's lengths, seconds: dit and dah, and the gaps inside letters, between letters and between words. */
export interface Fist extends Speed {
  elem: number;
  char: number;
  word: number;
}

/**
 * How much faster or slower `marks`, and the gaps between them, are keyed
 * than the fist `f`: the log of the factor that fits them best (up to
 * `channelTuning.shiftMax`), how much better it fits than no change, and how
 * many marks it makes dits and dahs. Each length is judged against its
 * nearest class (any gap longer than a word gap fits), its squared log error
 * clipped at `channelTuning.shiftClip`, so a false mark, a lost one or a fade
 * costs the same at every speed.
 */
export function speedShift(f: Fist, marks: readonly Mark[]): { shift: number; gain: number; dits: number; dahs: number } {
  const ms: number[] = [];
  const gs: number[] = [];
  marks.forEach((m, i) => {
    ms.push(Math.log(m.end - m.start));
    if (i) gs.push(Math.log(m.start - marks[i - 1].end));
  });
  const [dit, dah, elem, char, word] = [f.dit, f.dah, f.elem, f.char, f.word].map(Math.log);
  const clip = channelTuning.shiftClip ** 2;
  const cost = (s: number) => {
    let c = 0;
    for (const x of ms) c += Math.min(clip, Math.min(Math.abs(x - s - dit), Math.abs(x - s - dah)) ** 2);
    for (const x of gs) c += Math.min(clip, Math.min(Math.abs(x - s - elem), Math.abs(x - s - char), Math.max(0, word - x + s)) ** 2);
    return c;
  };
  const none = cost(0);
  let shift = 0;
  let best = none;
  // Dits alone fit two speeds as well (dits as dahs three times as fast, the
  // gaps inside letters as letter gaps): a tie goes to the smaller change.
  const steps = Math.round(channelTuning.shiftMax / 0.02);
  for (let k = -steps; k <= steps; k++) {
    const c = cost(k * 0.02) + 0.3 * Math.abs(k * 0.02);
    if (c < best) {
      best = c;
      shift = k * 0.02;
    }
  }
  const mid = (dit + dah) / 2 + shift;
  const dits = ms.filter((x) => x < mid).length;
  return { shift, gain: none - cost(shift), dits, dahs: ms.length - dits };
}

/** The same fist at another speed: every time scaled by `s`. */
function scaled(m: DecoderModel, s: number): DecoderModel {
  const l = Math.log(s);
  return {
    ...m,
    dit: m.dit * s,
    dah: m.dah * s,
    elemGap: m.elemGap * s,
    charGap: m.charGap * s,
    wordBoundaryEst: m.wordBoundaryEst * s,
    charSplit: m.charSplit * s,
    marks: m.marks.map((x) => x + l),
    gaps: m.gaps.map((x) => x + l),
  };
}

interface Line {
  t: number;
  text: string;
}

interface Word {
  text: string;
  letters: Kept[];
  marks: number;
  start: number;
  /** A word space follows it in the reading, and how long that gap is (0 without one). */
  spaced: boolean;
  gap: number;
}

function wordsOf(out: DecoderOutput[]): Word[] {
  const words: Word[] = [];
  let chars: DecodedChar[] = [];
  const close = (gap: number | null) => {
    if (!chars.length) return;
    const spaced = gap !== null;
    words.push({
      text: chars.map((c) => c.token ?? '⁇').join(''),
      letters: chars.map((c, i) => ({ pattern: c.pattern, space: spaced && i === chars.length - 1 })),
      marks: chars.reduce((n, c) => n + c.marks.length, 0),
      start: chars[0].start,
      spaced,
      gap: gap ?? 0,
    });
    chars = [];
  };
  for (const o of out) {
    if (o.kind === 'char') chars.push(o.char);
    else close(o.gap);
  }
  close(null);
  return words;
}

/** Letters of a reading with whether a word space follows each. */
function keptOf(out: DecoderOutput[]): Kept[] {
  return wordsOf(out).flatMap((w) => w.letters);
}

interface Over {
  /** Marks in the search's window; written words before it have left. */
  marks: Mark[];
  /** Marks that have left the window. */
  base: number;
  /** Letters written down, from the window's first mark, and how many marks they cover. */
  written: Kept[];
  writtenMarks: number;
  /** The latest reading of the window. */
  last: DecoderOutput[];
  /** Window length when last read. */
  read: number;
  /** Its current line, once a word is written; null: the next word starts a new line. */
  line: Line | null;
  /** Its first word goes on the line before (an over ended only for its length). */
  continues: boolean;
  /** No more marks come to it (closed), and its last words are written (done). */
  closed: boolean;
  done: boolean;
  /** Marks (counted from the over's start) up to which word gaps were checked for a change of station. */
  checked: number;
  /** Speed from its last marks. */
  fit: Speed | null;
}

function newOver(continues = false): Over {
  return { marks: [], base: 0, written: [], writtenMarks: 0, last: [], read: 0, line: null, continues, closed: false, done: false, checked: 0, fit: null };
}

export interface ChannelOptions {
  /** The speed to expect before any marks, wpm (default 20). */
  initialWpm?: number;
  /** Run the search in place, not in the worker (default: in place only where there are no workers). */
  inPlace?: boolean;
  /** The search itself (tests). */
  read?: ChannelRead;
}

export class ChannelDecoder {
  private live: Decoder;
  private readonly read: ChannelRead;
  private readonly async: boolean;
  private cur: Over = newOver();
  /** Ended overs whose last words are not written yet, oldest first. */
  private closing: Over[] = [];
  private wantRead = false;
  private busy = false;
  private epoch = 0;
  private down = false;
  private downAt = 0;
  /** The key went down again within a fade: this mark continues the last. */
  private resumes = false;
  /** End of the last mark kept. */
  private lastEnd = -Infinity;
  private now = 0;
  private lastFit: Speed | null = null;
  /** The last over's speed, to compare a new over's first marks with. */
  private prevFit: Speed | null = null;
  /** Gaps the readings took for word gaps, newest last (for when an over ends). */
  private wordGaps: number[] = [];
  /** End of the last mark of the words written (for measuring how far the text trails). */
  private writtenTo = -Infinity;
  /** Letters the live decoder read after the marks of the latest search, shown until the next. */
  private tail: DecoderOutput[] = [];
  private tailFrom = -Infinity;
  private known = false;
  private list: Line[] = [];
  private length = 0;
  private cache: string | null = '';

  constructor(opts: ChannelOptions = {}) {
    this.live = new Decoder({ initialWpm: opts.initialWpm ?? 20 });
    const here = opts.inPlace ?? (opts.read === undefined && typeof Worker === 'undefined');
    this.read = opts.read ?? (here ? inPlace : redecodeAsync);
    this.async = !here;
  }

  keyDown(t: number): void {
    this.tick(t);
    if (this.down) return;
    this.down = true;
    this.downAt = t;
    const T = channelTuning;
    const o = this.cur;
    let last: Mark | undefined = o.marks[o.marks.length - 1];
    // Far too long without a word written (no word gaps the reading believes, or
    // the search falling behind): the over ends at this word gap, its line goes on.
    const unwritten = o.marks.length - o.writtenMarks;
    if (last && (unwritten > 2 * T.maxUnwritten || (unwritten > T.maxUnwritten && t - last.end >= this.live.wordBoundary))) {
      this.endOver(true);
      last = undefined;
    }
    const s = this.scale;
    this.resumes = !!last && last.end === this.lastEnd && t - last.end < (s.sure ? T.dropout : 0.2) * s.dit;
    this.hear(this.live.keyDown(t));
  }

  keyUp(t: number): void {
    if (!this.down) return;
    this.down = false;
    this.now = Math.max(this.now, t);
    const d = t - this.downAt;
    const s = this.scale;
    const glitch = d < Math.max(0.008, (s.sure ? channelTuning.minMark : 0.25) * s.dit) || isHeld(d, this.dah);
    this.hear(this.live.keyUp(t));
    // The live decoder keeps every character it reads; only its speed and gaps are used here.
    if (this.live.history.length > 64) this.live.history.splice(0, this.live.history.length - 32);
    const o = this.cur;
    if (this.resumes) {
      // After a fade: the mark it cut goes on, and is read again.
      const last = o.marks[o.marks.length - 1];
      if (!isHeld(t - last.start, this.dah)) {
        last.end = t;
        this.lastEnd = t;
        o.read = Math.min(o.read, o.marks.length - 1);
        return;
      }
    }
    if (glitch) return;
    o.marks.push({ start: this.downAt, end: t });
    this.lastEnd = t;
    o.fit = fitSpeed(o.marks.slice(-channelTuning.changeBefore));
    if (o.fit) {
      this.lastFit = o.fit;
      this.known = true;
    }
    // A new over at another speed: the live decoder starts again at it.
    const T = channelTuning;
    if (o.base === 0 && o.marks.length === T.changeAfter && o.checked === 0 && this.prevFit) {
      const f = this.fistOf(this.prevFit);
      const r = speedShift(f, o.marks);
      if (decisive(r)) this.relearn(atShift(f, r.shift));
    }
    this.checkChange(o);
  }

  /** Call often (every 50 ms or so of input time): letters, words and overs close on silence. */
  tick(t: number): void {
    this.now = Math.max(this.now, t);
    this.hear(this.live.tick(t));
    if (this.down) return;
    const o = this.cur;
    if (!o.marks.length) return;
    const silence = t - this.lastEnd;
    if (silence >= this.overEnd()) {
      this.endOver(false);
      return;
    }
    // At a word gap, or after a long word: read the over again.
    const fresh = o.marks.length - o.read;
    if (fresh > 0 && silence >= 2 * this.dit && (silence >= this.live.wordBoundary || fresh >= channelTuning.readEvery)) {
      this.wantRead = true;
      this.pump();
    }
  }

  /** Letters from the live decoder, shown after the latest reading until the next one. */
  private hear(out: DecoderOutput[]) {
    for (const o of out) if (o.kind === 'space' || o.char.start > this.tailFrom) this.tail.push(o);
    if (this.tail.length > 200) this.tail.splice(0, this.tail.length - 100);
  }

  /** Words written down, newest last, a line for each over; capped at the last `channelTuning.textCap` characters. */
  get text(): string {
    if (this.cache === null) this.cache = this.list.map((l) => l.text).join('\n');
    return this.cache;
  }

  /**
   * The words still being read, which may change, with the space or line
   * break that puts them after `text`: show `text + pending`.
   */
  get pending(): string {
    let s = '';
    let after = this.list.length > 0;
    let newLine = false;
    for (const o of [...this.closing, this.cur]) {
      const words = this.unwritten(o);
      newLine = !o.line && !(o.continues && after);
      if (!words.length) continue;
      for (const w of words) {
        if (s || after) s += newLine ? '\n' : ' ';
        s += w.text;
        newLine = HAND_OVER.has(w.text);
      }
      after = true;
    }
    // Letters the live decoder has read since, in the current over.
    let live = '';
    if (!this.noise(this.cur)) for (const o of this.tail) live += o.kind === 'space' ? ' ' : (o.char.token ?? '⁇');
    live = live.trim().replace(/ +/g, ' ');
    if (live) {
      const newLine = !this.cur.line && !this.unwritten(this.cur).length && !(this.cur.continues && after);
      s += (s || after ? (newLine ? '\n' : ' ') : '') + live;
    }
    return s;
  }

  /** Character speed, wpm, once the marks have shown it. */
  get wpm(): number | null {
    return this.known ? 1.2 / this.dit : null;
  }

  /**
   * The dit that short marks and short silences are judged against: the
   * smaller of the over's and the live decoder's (which sees every mark and
   * follows a faster station soonest), and whether the over's own marks have
   * shown its speed yet. Until they have (the first marks of a station, or
   * one much faster than the last) a dit may be far shorter than expected, so
   * only clicks are dropped (a quarter of a dit, as for your own keying) and
   * only very short silences (a fifth) join a mark.
   */
  private get scale(): { dit: number; sure: boolean } {
    return { dit: Math.min(this.dit, this.live.ditEstimate), sure: this.cur.fit !== null && this.cur.marks.length >= 8 };
  }

  /** The dit the current station is sending, seconds. */
  get dit(): number {
    return this.cur.fit?.dit ?? this.lastFit?.dit ?? this.live.ditEstimate;
  }

  private get dah(): number {
    return this.cur.fit?.dah ?? this.lastFit?.dah ?? this.live.dahEstimate;
  }

  /** Lines with the time each began (its first mark, seconds of input time), for saving with times. */
  get lines(): { t: number; text: string }[] {
    return this.list.map((l) => ({ t: l.t, text: l.text }));
  }

  /** Forgets the text and the over being read; keeps listening at the speed learned. */
  reset(): void {
    this.epoch++;
    this.closing = [];
    this.cur = newOver();
    this.wantRead = false;
    this.tail = [];
    this.list = [];
    this.length = 0;
    this.cache = '';
  }

  /** No search running or waiting: the text is as up to date as the input. */
  get idle(): boolean {
    return !this.busy && !this.closing.length && !this.wantRead;
  }

  /** What is held, for tests: marks in windows, lines, characters of text. */
  get footprint(): { marks: number; lines: number; chars: number; history: number; writtenTo: number } {
    const marks = [...this.closing, this.cur].reduce((n, o) => n + o.marks.length, 0);
    return { marks, lines: this.list.length, chars: this.length, history: this.live.history.length, writtenTo: this.writtenTo };
  }

  /** Too sparse to be code (see `channelTuning.minDuty`). */
  private noise(o: Over): boolean {
    const ms = o.marks;
    if (o.base + ms.length < channelTuning.minMarks) return true;
    if (ms.length < 2) return false;
    let on = 0;
    for (const m of ms) on += m.end - m.start;
    return on / (ms[ms.length - 1].end - ms[0].start) < channelTuning.minDuty;
  }

  /** Silence that ends an over. */
  private overEnd(): number {
    const T = channelTuning;
    // Twice the word gaps the readings found, so false marks that upset the live
    // decoder's gaps cannot end overs at a code-practice broadcast's long word gaps.
    const g = [...this.wordGaps].sort((a, b) => a - b);
    const word = g.length >= 3 ? g[g.length >> 1] : 0;
    return Math.max(T.minOver, T.overWords * this.live.wordBoundary, 2 * word);
  }

  private endOver(continues: boolean) {
    const o = this.cur;
    o.closed = true;
    if (o.fit) this.prevFit = o.fit;
    this.closing.push(o);
    this.cur = newOver(continues);
    this.tail = [];
    this.tailFrom = this.lastEnd;
    this.pump();
  }

  /**
   * At a word gap with enough marks after it: are they from another station?
   * A clear change of speed starts a new over at the gap. At the start of an
   * over the marks are compared with the last over's, and the live decoder
   * starts again at the new speed.
   */
  private checkChange(o: Over) {
    const T = channelTuning;
    const n = o.marks.length;
    const j = n - T.changeAfter;
    const at = o.base + j;
    if (j < 1 || at <= o.checked) return;
    o.checked = at;
    if (j < T.changeMin || j < o.writtenMarks || o.marks[j].start - o.marks[j - 1].end < this.live.wordBoundary) return;
    // The other station may begin at a later word gap among these marks: split where the new speed fits best.
    let best: { at: number; shift: number; gain: number; before: Speed; fist: Fist } | null = null;
    for (let c = j; c <= n - 4; c++) {
      if (c > j && o.marks[c].start - o.marks[c - 1].end < this.live.wordBoundary) continue;
      const before = fitSpeed(o.marks.slice(Math.max(0, c - T.changeBefore), c));
      if (!before) continue;
      const fist = this.fistOf(before);
      const r = speedShift(fist, o.marks.slice(c));
      if (decisive(r) && (!best || r.gain > best.gain)) best = { at: c, ...r, before, fist };
    }
    if (!best) return;
    // The marks before the gap end their over; the rest begin a new one.
    const after = atShift(best.fist, best.shift);
    const next = newOver();
    next.marks = o.marks.splice(best.at);
    next.fit = after;
    next.checked = next.marks.length;
    o.fit = best.before;
    this.prevFit = best.before;
    this.lastFit = after;
    this.relearn(after);
    o.closed = true;
    this.closing.push(o);
    this.cur = next;
    this.tail = [];
    this.tailFrom = o.marks[o.marks.length - 1].end;
    this.pump();
  }

  /** A speed with gaps in the proportions the live decoder has learned (word gaps 7/3 of letter gaps). */
  private fistOf(s: Speed): Fist {
    const m = this.live.model();
    const k = s.dit / m.dit;
    return { dit: s.dit, dah: s.dah, elem: m.elemGap * k, char: m.charGap * k, word: ((m.charGap * 7) / 3) * k };
  }

  /** The live decoder's speed and gaps moved to a new speed. */
  private relearn(s: Speed) {
    const m = this.live.model();
    this.live = new Decoder({ model: scaled(m, s.dit / m.dit) });
  }

  private modelFor(o: Over): DecoderModel {
    const m = this.live.model();
    const f = o.fit;
    if (!f || Math.abs(Math.log(f.dit / m.dit)) < Math.log(1.15)) return m;
    return scaled(m, f.dit / m.dit);
  }

  private pump() {
    if (this.busy) return;
    if (!this.async) {
      this.busy = true;
      try {
        while (this.closing.length || this.wantRead) void this.next();
      } finally {
        this.busy = false;
      }
      return;
    }
    if (!this.closing.length && !this.wantRead) return;
    this.busy = true;
    void shared.turn(this.closing.length ? 0 : 1).then(async (release) => {
      const ending = this.closing[0];
      try {
        await this.next();
      } catch {
        // A failed search leaves the reading as it was, and the next one tries
        // again; an ended over is given up, so one bad over cannot stop the rest.
        if (ending && this.closing[0] === ending) {
          ending.done = true;
          this.closing.shift();
        }
      } finally {
        release();
        this.busy = false;
        this.pump();
      }
    });
  }

  /** The most urgent work: an ended over's last words, else a new reading of the current one. */
  private next(): Maybe<void> {
    const epoch = this.epoch;
    if (this.closing.length) {
      const o = this.closing[0];
      return then(this.finish(o), () => {
        if (epoch !== this.epoch) return;
        o.done = true;
        this.closing.shift();
      });
    }
    this.wantRead = false;
    return this.preview(this.cur);
  }

  /** Reads the over so far; words with enough marks after them are read with the full search and written down. */
  private preview(o: Over): Maybe<void> {
    const marks = o.marks.slice();
    o.read = marks.length;
    // Nothing new, or noise that would show nothing: no search.
    if (marks.length <= o.writtenMarks || this.noise(o)) return;
    const keep = o.written.slice();
    const model = this.modelFor(o);
    const until = this.now;
    const epoch = this.epoch;
    if (o === this.cur) {
      this.tailFrom = marks[marks.length - 1].end;
      this.tail = [];
    }
    const T = channelTuning;
    const write = (out: DecoderOutput[]) => {
      o.last = out;
      const cut = this.cut(o, out);
      if (cut >= 0) this.write(o, wordsOf(out), cut);
    };
    const full = (): Maybe<void> =>
      then(this.read(model, marks, until, keep, true), (out) => {
        if (epoch === this.epoch && !o.done) write(out);
      });
    const due = T.writeAfter + T.writeBatch;
    // A word is due to be written: read with the full search straight away.
    if (T.writeFull && this.cut(o, o.last, marks.length, due) >= 0) return full();
    return then(this.read(model, marks, until, keep, false), (quick) => {
      if (epoch !== this.epoch || o.done) return;
      if (!T.writeFull || this.cut(o, quick, undefined, due) < 0) {
        if (T.writeFull) o.last = quick;
        else write(quick);
        return;
      }
      return full();
    });
  }

  /** The over's last words: the window read once more with the full search, keeping what is on screen unless a clearly better reading changes it. */
  private finish(o: Over): Maybe<void> {
    const marks = o.marks.slice();
    if (marks.length <= o.writtenMarks || this.noise(o)) return;
    const epoch = this.epoch;
    return then(this.read(this.modelFor(o), marks, undefined, o.written.slice(), true, keptOf(o.last)), (out) => {
      if (epoch !== this.epoch) return;
      const words = wordsOf(out);
      this.write(o, words, words.length - 1);
    });
  }

  /** Words of a reading not written yet (those within the over's marks). */
  private unwritten(o: Over): Word[] {
    if (this.noise(o)) return [];
    const words = wordsOf(o.last);
    const start = this.writtenWords(o, words);
    if (start < 0) return [];
    const out: Word[] = [];
    let marks = o.writtenMarks;
    for (let i = start; i < words.length; i++) {
      marks += words[i].marks;
      if (marks > o.marks.length) break;
      out.push(words[i]);
    }
    return out;
  }

  /** How many of a reading's words are written already, or -1 if the reading does not begin with them. */
  private writtenWords(o: Over, words: Word[]): number {
    let letters = 0;
    let i = 0;
    while (letters < o.written.length && i < words.length) letters += words[i++].letters.length;
    if (letters !== o.written.length) return -1;
    let k = 0;
    for (let w = 0; w < i; w++) for (const l of words[w].letters) if (l.pattern !== o.written[k++].pattern) return -1;
    return i;
  }

  /**
   * Index of the last word followed by a word space and `writeAfter` marks
   * (of the reading, or `marks` in all), within the over's marks; -1 if none.
   */
  private cut(o: Over, out: DecoderOutput[], marks?: number, after = channelTuning.writeAfter): number {
    const words = wordsOf(out);
    const start = this.writtenWords(o, words);
    if (start < 0) return -1;
    let total = o.writtenMarks;
    const ends: number[] = [];
    for (let i = start; i < words.length; i++) {
      total += words[i].marks;
      ends.push(total);
    }
    if (marks !== undefined) total = marks;
    let best = -1;
    for (let i = start; i < words.length; i++) {
      const end = ends[i - start];
      if (words[i].spaced && end <= o.marks.length && total - end >= after) best = i;
    }
    return best;
  }

  /** Writes the words of a reading after those written, up to `upto`, then trims the window. */
  private write(o: Over, words: Word[], upto: number) {
    const start = this.writtenWords(o, words);
    if (start < 0) return;
    // Noise is read like code, so the search moves on, but none of it is shown.
    const shown = !this.noise(o);
    for (let i = start; i <= upto && i < words.length; i++) {
      const w = words[i];
      if (o.writtenMarks + w.marks > o.marks.length) break;
      if (shown) this.append(o, w);
      if (w.spaced) {
        this.wordGaps.push(w.gap);
        if (this.wordGaps.length > 15) this.wordGaps.shift();
      }
      o.written.push(...w.letters.map((l, k) => ({ pattern: l.pattern, space: k === w.letters.length - 1 })));
      o.writtenMarks += w.marks;
      this.writtenTo = o.marks[o.writtenMarks - 1].end;
    }
    this.trim(o);
  }

  private append(o: Over, w: Word) {
    if (!o.line && o.continues && this.list.length) o.line = this.list[this.list.length - 1];
    o.continues = false;
    if (!o.line) {
      o.line = { t: w.start, text: w.text };
      this.length += (this.list.length ? 1 : 0) + w.text.length;
      this.list.push(o.line);
    } else {
      o.line.text += ` ${w.text}`;
      this.length += 1 + w.text.length;
    }
    if (HAND_OVER.has(w.text)) o.line = null;
    this.cap();
    this.cache = null;
  }

  /** Keeps the last `textCap` characters: whole lines go first, then the start of the oldest. */
  private cap() {
    const cap = channelTuning.textCap;
    while (this.length > cap && this.list.length > 1) {
      this.length -= this.list[0].text.length + 1;
      this.list.shift();
    }
    if (this.length > cap) {
      const first = this.list[0];
      let cut = this.length - cap;
      const space = first.text.indexOf(' ', cut);
      cut = space >= 0 ? space + 1 : first.text.length;
      first.text = first.text.slice(cut);
      this.length -= cut;
    }
  }

  /** Written words leave the window, all but `context` marks of them before the words still being read. */
  private trim(o: Over) {
    const T = channelTuning;
    if (o.writtenMarks <= T.context + T.trimAfter) return;
    let letters = 0;
    let marks = 0;
    let wordLetters = 0;
    let wordMarks = 0;
    for (const k of o.written) {
      wordLetters++;
      wordMarks += k.pattern.length;
      if (!k.space) continue;
      if (o.writtenMarks - (marks + wordMarks) < T.context) break;
      letters += wordLetters;
      marks += wordMarks;
      wordLetters = 0;
      wordMarks = 0;
    }
    if (!marks) return;
    o.marks.splice(0, marks);
    o.base += marks;
    o.written.splice(0, letters);
    o.writtenMarks -= marks;
    o.read = Math.max(0, o.read - marks);
    // The reading loses the same letters (and the spaces after them).
    let chars = 0;
    let k = 0;
    while (k < o.last.length && chars < letters) if (o.last[k++].kind === 'char') chars++;
    while (k < o.last.length && o.last[k].kind === 'space') k++;
    o.last = o.last.slice(k);
  }
}

/**
 * A clear change of speed: large enough, a clearly better fit, and from marks
 * holding both dits and dahs (dits alone, as in 5 or SH, cannot tell a speed).
 */
function decisive(r: { shift: number; gain: number; dits: number; dahs: number }): boolean {
  const T = channelTuning;
  return Math.abs(r.shift) >= T.change && r.gain >= T.changeGain && r.dits >= 2 && r.dahs >= 2;
}

/** A fist's speed moved by a log factor. */
function atShift(f: Speed, shift: number): Speed {
  const k = Math.exp(shift);
  return { dit: f.dit * k, dah: f.dah * k };
}
