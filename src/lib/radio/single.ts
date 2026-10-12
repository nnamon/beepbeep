// The interim radio source: today's microphone path, one detector locked to
// one pitch at a time, decoded continuously. When the detector moves to a tone
// at another pitch (another station), that is another signal with its own
// decoder, so both sides of a QSO keep their own text and speed. Two stations
// sending at once are not both decoded: the detector follows the stronger.
// The multi-signal engine replaces this behind RadioSource.
//
// Overs end after a few seconds of silence; each is read once more as a whole
// and added to the text. The over in progress is the signal's `pending` text.
//
// The radio is not your key: the detector listens at any pitch, without the
// pinned pitch or squelch you set up for your own sending, and nothing here
// keys or plays a sidetone.

import { engine } from '../audio/engine';
import { Decoder, isGlitch, isHeld, type DecoderOutput } from '../decoder/decoder';
import { redecodeAsync } from '../decoder/redecode';
import { StableReading, type Reread } from '../decoder/stable';
import { outputsToText } from '../decoder/pipeline';
import type { DetectorEvent } from '../dsp/detector';
import { settings } from '../state/settings.svelte';
import { lastMicFailure, signal, startMic } from '../state/signal.svelte';
import type { RadioSignal, RadioSource } from './source';

/** Silence that ends an over, seconds. Longer than a slow sender's word gap (7 dits at 5 wpm is 1.7 s). */
export const OVER_GAP = 3;
/**
 * An over this long (marks, about 15 words) ends at its next word break. Each
 * letter reads the open over again, so a long transmission with no pause (a
 * bulletin) must not grow without end.
 */
export const OVER_MARKS = 200;
/** Marks heard before the speed counts as measured. */
export const SPEED_AFTER = 20;
/** Characters of text kept per signal. */
export const KEEP_CHARS = 20_000;
/** A lock this close to a signal's pitch, Hz, is the same signal (the detector follows drift within 40 Hz). */
export const SAME_HZ = 40;
/** Signals kept at most; the one heard longest ago goes first. */
export const MAX_SIGNALS = 8;
/** The speed a new signal's decoder starts from: the middle of what is heard on the air. */
const START_WPM = 18;
/** How often the screen is told, ms. */
const PUSH_MS = 250;

type Mark = { start: number; end: number };

/** Drops the oldest text beyond `max` characters, starting again at a word. */
export function keepLast(text: string, max = KEEP_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.length - max;
  const at = text.slice(cut).search(/\s/);
  return at >= 0 ? text.slice(cut + at + 1) : text.slice(cut);
}

/**
 * One signal's decoding: detector events in (on the detector's clock), its
 * RadioSignal out. `clock` is performance.now, or a test's.
 */
export class RadioChannel {
  readonly signal: RadioSignal;
  private decoder = new Decoder({ initialWpm: START_WPM });
  private reading: StableReading;
  /** Marks of the over in progress. */
  private marks: Mark[] = [];
  private down = false;
  private downAt = 0;
  private lastUp = 0;
  /** Detector time of the latest message. */
  private now = 0;
  /** Marks since the start or the last Clear: the signal is shown from the first. */
  private heard = 0;
  /** Marks since the start: the speed is shown once there are enough. */
  private measured = 0;
  /** Each reading asked for; an older one that comes back late is dropped. */
  private req = 0;
  /** Bumped by Clear: readings of text from before it are dropped. */
  private gen = 0;
  /** Overs being read for the last time, in order, so the text stays in order. */
  private settling: Promise<void> = Promise.resolve();

  constructor(
    id: number,
    pitch: number,
    private clock: () => number = () => performance.now(),
    reread: Reread = redecodeAsync,
  ) {
    this.signal = { id, pitch, wpm: null, snr: 0, keying: false, lastHeard: 0, text: '', pending: '' };
    this.reading = new StableReading(reread);
  }

  /** The dit the decoder expects now, seconds: the detector's filters follow it. */
  get dit(): number {
    return this.decoder.ditEstimate;
  }

  /** Anything heard since the start or the last Clear. */
  get heardAny(): boolean {
    return this.heard > 0;
  }

  /** Detector events, and the detector time of the message that carried them. */
  feed(events: DetectorEvent[], time: number) {
    const out: DecoderOutput[] = [];
    for (const e of events) {
      if (e.type === 'key') out.push(...this.key(e.down, e.t));
      else if (e.type === 'lock') this.signal.pitch = e.hz;
      else {
        if (e.pitch) this.signal.pitch = e.pitch;
        // Its strength while it sends: in the silence after, the detector's measure fades.
        if (e.keyDown) this.signal.snr = e.snr;
        this.signal.keying = e.keyDown;
        this.now = Math.max(this.now, e.t);
        out.push(...this.decoder.tick(e.t));
      }
    }
    this.now = Math.max(this.now, time);
    out.push(...this.decoder.tick(this.now));
    if (out.length) {
      // A long over ends at a word break and goes on, on the same line.
      if (this.marks.length >= OVER_MARKS && out.some((o) => o.kind === 'space')) this.endOver(' ');
      else this.read();
    }
    if (!this.down && this.marks.length && this.now - this.lastUp >= OVER_GAP) this.endOver('\n');
  }

  /** Ends the over in progress (on Stop, or when the detector moves to another signal). Resolves once its text is added. */
  finish(): Promise<void> {
    // A key still down is let up; a mark that long is no mark.
    this.decoder.flush(this.now + 10);
    this.down = false;
    this.signal.keying = false;
    if (this.marks.length) this.endOver('\n');
    return this.settling;
  }

  /** Forgets the text; the speed learned so far is kept. */
  clear() {
    this.gen++;
    this.req++;
    this.marks = [];
    this.heard = 0;
    this.reading.reset();
    this.decoder.flush(this.now + 10);
    this.decoder.history.splice(0);
    this.down = false;
    this.signal.keying = false;
    this.signal.text = '';
    this.signal.pending = '';
  }

  private key(down: boolean, t: number): DecoderOutput[] {
    this.now = Math.max(this.now, t);
    this.signal.keying = down;
    if (down) {
      if (this.down) return [];
      this.down = true;
      this.downAt = t;
      return this.decoder.keyDown(t);
    }
    if (!this.down) return [];
    this.down = false;
    this.lastUp = t;
    // Glitches and a carrier held down are dropped once, here, so every reading sees the same marks.
    const d = t - this.downAt;
    if (!isGlitch(d, this.decoder.ditEstimate) && !isHeld(d, this.decoder.dahEstimate)) {
      this.marks.push({ start: this.downAt, end: t });
      this.heard++;
      this.measured++;
      this.signal.lastHeard = this.clock();
    }
    const out = this.decoder.keyUp(t);
    if (this.measured >= SPEED_AFTER) this.signal.wpm = this.decoder.wpm;
    return out;
  }

  /** The over so far, read again with all that has been learned: words already written stay. */
  private read() {
    if (!this.marks.length) return;
    const n = ++this.req;
    const gen = this.gen;
    void this.reading.update(this.decoder.model(), this.marks.slice(), this.now).then((o) => {
      if (n === this.req && gen === this.gen) this.signal.pending = outputsToText(o);
    });
  }

  /** The over is read once more as a whole and added to the text, followed by `sep`. */
  private endOver(sep: string) {
    const marks = this.marks;
    this.marks = [];
    // After silence, the last letter ends. A long over ends as the next word's first mark starts: that mark goes on.
    if (!this.down) this.decoder.flush(this.now + 10);
    // Kept for fist reports elsewhere; here it would only grow.
    this.decoder.history.splice(0);
    const n = ++this.req;
    const gen = this.gen;
    // Asked for now, so it is read before the next over's readings.
    const last = this.reading.finish(this.decoder.model(), marks);
    this.settling = this.settling
      .then(() => last)
      .then((out) => {
        if (gen !== this.gen) return;
        const words = outputsToText(out);
        if (words) this.signal.text = keepLast(this.signal.text + words + sep);
        // Unless the next over is already being read.
        if (n === this.req) this.signal.pending = '';
      });
  }
}

/**
 * The detector's events, shared out by pitch: each tone it locks to is a
 * signal of its own. Nothing here touches the browser, so tests feed it a
 * detector run offline.
 */
export class SignalTracker {
  private channels: RadioChannel[] = [];
  private active: RadioChannel | null = null;
  private nextId = 1;

  constructor(
    /** Told the dit the active signal's decoder expects, for the detector's filters. */
    private onDit: (dit: number) => void = () => undefined,
    private clock: () => number = () => performance.now(),
    private reread: Reread = redecodeAsync,
  ) {}

  /** Detector events, and the detector time of the message that carried them. */
  feed(events: DetectorEvent[], time: number) {
    let from = 0;
    events.forEach((e, i) => {
      if (e.type !== 'lock') return;
      // What came before the lock was heard at the old pitch.
      if (i > from) this.current(null).feed(events.slice(from, i), e.t);
      this.lockTo(e.hz);
      from = i;
    });
    const rest = from ? events.slice(from) : events;
    const pitch = rest.find((e) => e.type === 'status')?.pitch ?? null;
    this.current(pitch).feed(rest, time);
  }

  /** Every signal heard since the start or the last Clear, newest activity first. */
  list(): RadioSignal[] {
    return this.channels
      .filter((c) => c.heardAny)
      .sort((a, b) => b.signal.lastHeard - a.signal.lastHeard)
      .map((c) => ({ ...c.signal }));
  }

  /** The dit the signal listened to now is expected to have, seconds; null before anything is heard. */
  get dit(): number | null {
    return this.active?.dit ?? null;
  }

  /** Ends the over in progress. Resolves once its text is added. */
  finish(): Promise<void> {
    return this.active?.finish() ?? Promise.resolve();
  }

  /** Forgets every signal; the one listened to now keeps what it learned of the speed. */
  clear() {
    for (const c of this.channels) c.clear();
    this.channels = this.active ? [this.active] : [];
  }

  /** The signal being listened to; the first one is made when the detector is first heard. */
  private current(pitch: number | null): RadioChannel {
    if (!this.active) {
      this.active = this.make(pitch ?? 0);
      this.onDit(this.active.dit);
    }
    return this.active;
  }

  /** The detector locked to `hz`: the same signal if it is near, otherwise another. */
  private lockTo(hz: number) {
    const was = this.active;
    if (was && (!was.signal.pitch || Math.abs(was.signal.pitch - hz) <= SAME_HZ)) return;
    if (was) void was.finish();
    let near: RadioChannel | null = null;
    for (const c of this.channels) {
      if (c !== was && Math.abs(c.signal.pitch - hz) <= SAME_HZ && (!near || Math.abs(c.signal.pitch - hz) < Math.abs(near.signal.pitch - hz))) near = c;
    }
    // A signal that was never heard (the detector's first lock was on a stray tone) is not kept.
    this.channels = this.channels.filter((c) => c.heardAny || c === near);
    this.active = near ?? this.make(hz);
    if (this.channels.length > MAX_SIGNALS) {
      const oldest = this.channels.filter((c) => c !== this.active).sort((a, b) => a.signal.lastHeard - b.signal.lastHeard)[0];
      this.channels = this.channels.filter((c) => c !== oldest);
    }
    this.onDit(this.active.dit);
  }

  private make(pitch: number): RadioChannel {
    const c = new RadioChannel(this.nextId++, pitch, this.clock, this.reread);
    this.channels.push(c);
    return c;
  }
}

/** Today's microphone path: the app's detector, one pitch at a time. */
export class SingleSignalSource implements RadioSource {
  private tracker = new SignalTracker((dit) => this.sendDit(dit));
  private subs = new Set<(signals: RadioSignal[]) => void>();
  private unsub: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Each start; Stop while the browser still asks for the microphone gives that start up. */
  private run = 0;
  private lastDit = 0;

  async start(): Promise<void> {
    if (this.unsub) return;
    const run = ++this.run;
    await engine.ensure();
    if (!signal.micOn) {
      const info = await startMic();
      if (!info) throw lastMicFailure() ?? new Error("The microphone didn't start.");
    }
    if (run !== this.run || this.unsub) return;
    // Any pitch, at the detector's own threshold: the pin and squelch are for your own key.
    engine.command({ type: 'pin', hz: null });
    engine.command({ type: 'squelch', db: null });
    this.lastDit = 0;
    this.unsub = engine.onEvents((events, time) => this.onEvents(events, time));
    this.timer = setInterval(() => this.emit(), PUSH_MS);
    this.emit();
  }

  stop() {
    this.run++;
    if (!this.unsub) return;
    this.unsub();
    this.unsub = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Your own pitch and squelch again, for the screens that listen to your key.
    engine.command({ type: 'pin', hz: settings.pinnedHz });
    engine.command({ type: 'squelch', db: settings.squelchDb });
    void this.tracker.finish().then(() => this.emit());
    this.emit();
  }

  clear() {
    this.tracker.clear();
    this.emit();
  }

  subscribe(fn: (signals: RadioSignal[]) => void): () => void {
    this.subs.add(fn);
    fn(this.tracker.list());
    return () => this.subs.delete(fn);
  }

  private onEvents(events: DetectorEvent[], time: number) {
    this.tracker.feed(events, time);
    const dit = this.tracker.dit;
    if (dit) this.sendDit(dit);
  }

  private sendDit(dit: number) {
    if (Math.abs(dit - this.lastDit) / dit <= 0.08) return;
    this.lastDit = dit;
    engine.command({ type: 'dit', dit });
  }

  private emit() {
    const list = this.tracker.list();
    for (const fn of this.subs) fn(list);
  }
}
