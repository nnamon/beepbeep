// Live decoding of your own sending, from the microphone or the keyboard keyer.

import { engine } from './engine';
import { Keyer, type KeyEvent } from './keyer';
import { Decoder, type DecodedChar, type DecoderOutput } from '../decoder/decoder';
import type { DetectorEvent } from '../dsp/detector';
import { signal } from '../state/signal.svelte';

export type InputSource = 'mic' | 'straight' | 'iambicA' | 'iambicB';

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

  async start() {
    await engine.ensure();
    if (this.opts.source === 'mic') {
      this.unsub = engine.onEvents((events) => this.onDetector(events));
      engine.command({ type: 'dit', dit: this.decoder.ditEstimate });
    } else {
      this.keyer = new Keyer({
        mode: this.opts.source,
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
  }

  setSpeed(charWpm: number) {
    this.keyer?.setOptions({ dit: 1.2 / charWpm });
  }

  /** Keys from an on-screen control (for touch use of the straight key). */
  pressStraight(down: boolean) {
    this.keyer?.straight(down);
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

  private onDetector(events: DetectorEvent[]) {
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
      this.marks.push({ start: this.downAt, end: e.t });
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
      if (this.opts.source === 'straight' && e.code === 'Space') {
        e.preventDefault();
        this.keyer?.straight(true);
      } else if (e.code === 'BracketLeft' || e.code === 'Comma' || e.code === 'KeyZ') {
        e.preventDefault();
        this.keyer?.paddle('dit', true);
      } else if (e.code === 'BracketRight' || e.code === 'Period' || e.code === 'KeyX') {
        e.preventDefault();
        this.keyer?.paddle('dah', true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (this.opts.source === 'straight' && e.code === 'Space') this.keyer?.straight(false);
      else if (e.code === 'BracketLeft' || e.code === 'Comma' || e.code === 'KeyZ') this.keyer?.paddle('dit', false);
      else if (e.code === 'BracketRight' || e.code === 'Period' || e.code === 'KeyX') this.keyer?.paddle('dah', false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    this.keyHandlers = { down, up };
  }

  private detachKeyboard() {
    if (!this.keyHandlers) return;
    window.removeEventListener('keydown', this.keyHandlers.down);
    window.removeEventListener('keyup', this.keyHandlers.up);
    this.keyHandlers = null;
  }
}
