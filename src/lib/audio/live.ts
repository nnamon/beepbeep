// Live decoding of your own sending, from the microphone or the keyboard keyer.

import { engine } from './engine';
import { Keyer, type KeyEvent } from './keyer';
import { Decoder, isGlitch, isHeld, type DecodedChar, type DecoderOutput } from '../decoder/decoder';
import { redecodeAsync } from '../decoder/redecode';
import { StableReading } from '../decoder/stable';
import type { DetectorEvent } from '../dsp/detector';
import { signal } from '../state/signal.svelte';
import { buildSchedule } from '../morse/schedule';

/** Mic, keyboard straight key (Space), keyboard paddles, or the on-screen touch key. */
export type InputSource = 'mic' | 'straight' | 'iambicA' | 'iambicB' | 'touch';

// The decoder the on-screen touch key drives, if one is listening.
let touchTarget: LiveDecoder | null = null;

/** Presses or releases the on-screen touch key; `timeStamp` is the input event's. */
export function touchKey(down: boolean, timeStamp?: number) {
  touchTarget?.pressStraight(down, timeStamp === undefined ? undefined : eventTime(timeStamp));
}

/**
 * An input event's moment on the audio clock. Events carry their own
 * timestamp (performance clock); handling may run late if the page is busy.
 */
function eventTime(timeStamp: number): number {
  const late = performance.now() - timeStamp;
  // A timestamp on another clock (some older browsers) or absurdly old: use now.
  if (!(late >= 0 && late < 2000)) return engine.now;
  return engine.now - late / 1000;
}

export interface LiveStatus {
  level: number;
  pitch: number | null;
  snr: number;
  keyDown: boolean;
  wpm: number;
}

export interface Mark {
  start: number;
  end: number;
}

export interface LiveOptions {
  source: InputSource;
  charWpm: number;
  effectiveWpm?: number;
  pitch: number;
  onOutput?: (o: DecoderOutput) => void;
  onStatus?: (s: LiveStatus) => void;
  onKey?: (down: boolean, t: number) => void;
}

export class LiveDecoder {
  decoder: Decoder;
  /** Raw marks of the current over, for the rhythm view. */
  marks: Mark[] = [];
  outputs: DecoderOutput[] = [];
  private keyer: Keyer | null = null;
  private unsub: (() => void) | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastDit = 0;
  private downAt = 0;
  private status: LiveStatus = { level: -90, pitch: null, snr: 0, keyDown: false, wpm: 0 };
  private keyHandlers: { down: (e: KeyboardEvent) => void; up: (e: KeyboardEvent) => void } | null = null;

  constructor(private opts: LiveOptions) {
    this.decoder = new Decoder({ initialWpm: opts.charWpm, initialEffectiveWpm: opts.effectiveWpm });
    this.status.wpm = opts.charWpm;
  }

  get source() {
    return this.opts.source;
  }

  /** Moves to another way of keying (mic, touch key, keyboard), keeping what has been decoded. */
  async switchSource(source: InputSource) {
    if (source === this.opts.source) return;
    this.stop();
    this.opts = { ...this.opts, source };
    await this.start();
  }

  async start() {
    await engine.ensure();
    if (this.opts.source === 'mic') {
      this.unsub = engine.onEvents((events, time) => this.onDetector(events, time));
      engine.command({ type: 'dit', dit: this.decoder.ditEstimate });
    } else {
      this.keyer = new Keyer({
        mode: this.opts.source === 'touch' ? 'straight' : this.opts.source,
        dit: 1.2 / this.opts.charWpm,
        now: () => engine.now,
        tone: {
          on: (on) => void engine.sidetone(on, this.opts.pitch),
          element: (s, e) => engine.sidetoneElement(s, e, this.opts.pitch),
        },
        emit: (e) => this.onKey(e),
      });
      this.attachKeyboard();
      this.tickTimer = setInterval(() => this.push(this.decoder.tick(engine.now)), 20);
      if (this.opts.source === 'touch') {
        touchTarget = this;
        signal.touchKey = true;
      }
    }
  }

  stop() {
    this.unsub?.();
    this.unsub = null;
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.keyer?.stop();
    this.keyer = null;
    this.detachKeyboard();
    if (touchTarget === this) {
      touchTarget = null;
      signal.touchKey = false;
      signal.keyDown = false;
    }
  }

  /** Ends the current over: emits any pending character. */
  flush(): DecoderOutput[] {
    const t = this.opts.source === 'mic' ? this.lastEventTime + 10 : engine.now + 10;
    const out = this.decoder.flush(t);
    this.push(out);
    return out;
  }

  /** Starts a fresh over, keeping the speed estimate. */
  resetOver() {
    this.marks = [];
    this.outputs = [];
    this.head = [];
    this.headMarks = 0;
    this.reading.reset();
  }

  setSpeed(charWpm: number) {
    this.keyer?.setOptions({ dit: 1.2 / charWpm });
  }

  /** Keys from an on-screen control (for touch use of the straight key). */
  pressStraight(down: boolean, at?: number) {
    this.keyer?.straight(down, at);
  }

  /**
   * Your recent marks and the standard keying of the same decoded characters at
   * your measured speed, both starting at the first of those characters. Marks
   * still being keyed (not yet decoded) trail on your row.
   */
  recentRhythm(maxMarks = 30): { yours: Mark[]; standard: Mark[] } {
    const toks: string[] = [];
    let n = 0;
    let from = Infinity;
    for (let i = this.outputs.length - 1; i >= 0; i--) {
      const o = this.outputs[i];
      if (o.kind === 'space') {
        if (toks.length) toks.unshift(' ');
        continue;
      }
      if (!o.char.token || n + o.char.marks.length > maxMarks) break;
      toks.unshift(o.char.token);
      n += o.char.marks.length;
      from = o.char.marks[0]?.start ?? from;
    }
    if (!toks.length) return { yours: this.marks.slice(-maxMarks), standard: [] };
    const yours = this.marks.filter((m) => m.start >= from - 1e-6);
    const std = buildSchedule(toks.join('').trim(), { charWpm: Math.max(5, this.decoder.wpm), leadIn: 0, tail: 0 });
    return { yours, standard: std.marks.map((m) => ({ start: m.start, end: m.end })) };
  }

  /** Overs already settled (kept, not decoded again) and the marks they cover. */
  private head: DecoderOutput[] = [];
  private headMarks = 0;
  /** The current over as shown: finished words stay as written. */
  private reading = new StableReading(redecodeAsync);

  /**
   * The over so far, decoded again with everything learned about this fist.
   * Words already finished stay as they were read; the word in progress is
   * read again, and letters still being keyed are left out. Earlier overs
   * stay as they were settled, so this costs one over however long the session.
   */
  async settled(): Promise<DecoderOutput[]> {
    const now = this.opts.source === 'mic' ? this.lastEventTime : engine.now;
    const over = await this.reading.update(this.decoder.model(), this.marks.slice(this.headMarks), now);
    return [...this.head, ...over];
  }

  /** At the end of an over: the last word read once more, and the over joins the settled ones. */
  async settle(): Promise<DecoderOutput[]> {
    const from = this.headMarks;
    const tail = this.marks.slice(from);
    this.headMarks = this.marks.length;
    const over = await this.reading.finish(this.decoder.model(), tail);
    if (over.length) {
      if (this.head.length && this.head[this.head.length - 1].kind !== 'space') {
        this.head.push({ kind: 'space', t: tail[0].start, gap: tail[0].start - this.marks[from - 1].end });
      }
      this.head.push(...over);
    }
    this.outputs = [...this.head];
    return this.outputs;
  }

  get chars(): DecodedChar[] {
    return this.outputs.filter((o) => o.kind === 'char').map((o) => (o as { char: DecodedChar }).char);
  }

  get text(): string {
    let s = '';
    for (const o of this.outputs) s += o.kind === 'space' ? ' ' : (o.char.token ?? '⁇');
    return s.trim();
  }

  private lastEventTime = 0;

  private onDetector(events: DetectorEvent[], time: number) {
    for (const e of events) {
      if (e.type === 'key') this.onKey({ down: e.down, t: e.t });
      else if (e.type === 'status') {
        this.lastEventTime = e.t;
        this.push(this.decoder.tick(e.t));
        this.status = { level: e.level, pitch: e.pitch, snr: e.snr, keyDown: e.keyDown, wpm: this.decoder.wpm };
        this.opts.onStatus?.(this.status);
      } else if (e.type === 'lock') {
        this.status = { ...this.status, pitch: e.hz };
        this.opts.onStatus?.(this.status);
      }
    }
    // Every message carries the detector clock; ticking on it closes characters promptly.
    this.lastEventTime = Math.max(this.lastEventTime, time);
    this.push(this.decoder.tick(time));
    const dit = this.decoder.ditEstimate;
    if (Math.abs(dit - this.lastDit) / dit > 0.08) {
      this.lastDit = dit;
      engine.command({ type: 'dit', dit });
    }
  }

  private onKey(e: KeyEvent) {
    this.lastEventTime = e.t;
    this.opts.onKey?.(e.down, e.t);
    if (e.down) {
      this.downAt = e.t;
      this.push(this.decoder.keyDown(e.t));
    } else {
      // Glitches and a key held down are dropped here once, so every later reading sees the same marks.
      const d = e.t - this.downAt;
      if (!isGlitch(d, this.decoder.ditEstimate) && !isHeld(d, this.decoder.dahEstimate)) this.marks.push({ start: this.downAt, end: e.t });
      this.push(this.decoder.keyUp(e.t));
    }
    if (this.opts.source !== 'mic') {
      // Keyboard keyer events can be scheduled slightly ahead; the LED follows them.
      const delay = Math.max(0, (e.t - engine.now) * 1000);
      setTimeout(() => {
        signal.keyDown = e.down;
        if (e.down) signal.lastKeyDown = performance.now();
      }, delay);
      this.status = { ...this.status, keyDown: e.down, wpm: this.decoder.wpm };
      this.opts.onStatus?.(this.status);
    }
  }

  private push(out: DecoderOutput[]) {
    for (const o of out) {
      this.outputs.push(o);
      this.opts.onOutput?.(o);
    }
  }

  private attachKeyboard() {
    const isField = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (isField(e.target) || e.repeat) return;
      if (this.straightKeyed && e.code === 'Space') {
        e.preventDefault();
        this.keyer?.straight(true, eventTime(e.timeStamp));
      } else if (e.code === 'BracketLeft' || e.code === 'Comma' || e.code === 'KeyZ') {
        e.preventDefault();
        this.keyer?.paddle('dit', true);
      } else if (e.code === 'BracketRight' || e.code === 'Period' || e.code === 'KeyX') {
        e.preventDefault();
        this.keyer?.paddle('dah', true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (this.straightKeyed && e.code === 'Space') this.keyer?.straight(false, eventTime(e.timeStamp));
      else if (e.code === 'BracketLeft' || e.code === 'Comma' || e.code === 'KeyZ') this.keyer?.paddle('dit', false);
      else if (e.code === 'BracketRight' || e.code === 'Period' || e.code === 'KeyX') this.keyer?.paddle('dah', false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    this.keyHandlers = { down, up };
  }

  /** Space keys a straight key for the keyboard and touch sources alike. */
  private get straightKeyed(): boolean {
    return this.opts.source === 'straight' || this.opts.source === 'touch';
  }

  private detachKeyboard() {
    if (!this.keyHandlers) return;
    window.removeEventListener('keydown', this.keyHandlers.down);
    window.removeEventListener('keyup', this.keyHandlers.up);
    this.keyHandlers = null;
  }
}
