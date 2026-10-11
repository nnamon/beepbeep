// Keyboard keying for practice without a radio: a straight key on one key, or
// iambic paddles (mode A or B) on two. Element timing is scheduled on the
// audio clock, so the key events it reports are exact.

export interface KeyEvent {
  down: boolean;
  t: number;
}

export interface KeyerOptions {
  mode: 'straight' | 'iambicA' | 'iambicB';
  /** Seconds per dit (iambic only). */
  dit: number;
  /** Audio clock, seconds. */
  now: () => number;
  /** Sidetone control. */
  tone: {
    on: (on: boolean) => void;
    element: (start: number, end: number) => void;
  };
  emit: (e: KeyEvent) => void;
}

type Paddle = 'dit' | 'dah';

export class Keyer {
  private pressed: Record<Paddle, boolean> = { dit: false, dah: false };
  private latched: Record<Paddle, boolean> = { dit: false, dah: false };
  private last: Paddle | null = null;
  private running = false;
  private nextAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private straightDown = false;

  constructor(private opts: KeyerOptions) {}

  setOptions(o: Partial<KeyerOptions>) {
    this.opts = { ...this.opts, ...o };
  }

  /**
   * Straight key down/up. `at` is when it happened on the audio clock (from
   * the input event's own timestamp), so a busy page cannot shift the timing.
   */
  straight(down: boolean, at?: number) {
    if (this.opts.mode !== 'straight' || down === this.straightDown) return;
    this.straightDown = down;
    this.opts.tone.on(down);
    this.opts.emit({ down, t: at ?? this.opts.now() });
  }

  paddle(p: Paddle, down: boolean) {
    if (this.opts.mode === 'straight') return;
    this.pressed[p] = down;
    if (down) {
      this.latched[p] = true;
      if (!this.running) this.start();
    }
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = false;
    this.pressed = { dit: false, dah: false };
    this.latched = { dit: false, dah: false };
    if (this.straightDown) this.straight(false);
  }

  private start() {
    this.running = true;
    this.nextAt = Math.max(this.opts.now() + 0.01, this.nextAt);
    this.step();
  }

  private choose(): Paddle | null {
    const dit = this.latched.dit || this.pressed.dit;
    const dah = this.latched.dah || this.pressed.dah;
    if (dit && dah) return this.last === 'dit' ? 'dah' : 'dit';
    if (dit) return 'dit';
    if (dah) return 'dah';
    return null;
  }

  private step() {
    const el = this.choose();
    if (!el) {
      this.running = false;
      return;
    }
    const d = this.opts.dit;
    const start = Math.max(this.nextAt, this.opts.now() + 0.005);
    const end = start + (el === 'dit' ? d : 3 * d);
    this.latched[el] = false;
    // Mode B: squeezing during an element earns the opposite element after it.
    if (this.opts.mode === 'iambicB' && this.pressed.dit && this.pressed.dah) {
      this.latched[el === 'dit' ? 'dah' : 'dit'] = true;
    }
    this.last = el;
    this.opts.tone.element(start, end);
    this.opts.emit({ down: true, t: start });
    this.opts.emit({ down: false, t: end });
    this.nextAt = end + d;
    // Wake shortly before the next element could start and decide then.
    const wait = Math.max(0, (this.nextAt - this.opts.now()) * 1000 - 8);
    this.timer = setTimeout(() => {
      this.timer = null;
      // Mode A forgets a squeeze released during the element.
      if (this.opts.mode === 'iambicA' && !this.pressed.dit && !this.pressed.dah) {
        this.latched = { dit: false, dah: false };
      }
      this.step();
    }, wait);
  }
}
