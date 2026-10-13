// Every signal at once: the multi-signal detector's events in (detector.ts,
// run by the radio worklet), one ChannelDecoder (channel.ts) per channel, the
// Radio screen's signals out. Nothing here touches the browser, so the tests
// run it on the detector's output just as the app does.
//
//  - Time. The detector times each key event by the input, and an event can
//    come out up to `lag` seconds after the moment it times. Each decoder is
//    told the time as `time - lag`, so it does not take for silence what the
//    detector has not decided on yet. While a key is down, it is told no later
//    than the key-down.
//  - A mark the detector withdraws after its key-down (its pitch was wrong,
//    or it was a stronger station's key clicks heard through the filter) gets
//    its key-up at its own start. A key-down goes to its decoder together with
//    its key-up, so a withdrawn mark changes nothing there.
//  - Speed. Each decoder's dit goes back to its channel's filter when it has
//    changed by more than 8% since it was last sent.
//  - Signals that end. The detector drops a channel 45 seconds after its last
//    mark, and every channel ends when listening stops. Its text is kept and
//    shown as quiet. A new channel within 25 Hz of it later (the same station
//    again, or another on its pitch) goes on with it, under the same id, on a
//    new line. The 20 most recently heard of these are kept, until Clear.
//  - Hours of listening: each decoder keeps a capped window and text
//    (channel.ts), the detector at most 8 channels, and at most 20 signals
//    that ended are kept, so memory stays flat.

import { ChannelDecoder, type ChannelOptions } from './channel';
import type { RadioEvent } from './detector';
import type { RadioSignal } from './source';

/** A new channel this close to a signal that ended, Hz, goes on with it (the detector gives stations closer than 25 Hz one channel). */
export const SAME_HZ = 25;
/** Signals that ended (silent 45 seconds, or listening stopped) kept with their text: the most recently heard. */
export const KEEP_ENDED = 20;
/** A decoder's dit goes back to the detector when it has changed by more than this share. */
export const DIT_CHANGE = 0.08;
/** Silence put into a signal's decoder when its channel ends, seconds: its over ends and its last words are written. */
const BREAK = 60;
/** How far before its first signal event a new channel's first key event can be, seconds (the detector's 8 seconds to pass a channel on, and the 6 seconds of audio it hears again), with room. */
const BACKLOG = 30;

interface Track {
  signal: RadioSignal;
  dec: ChannelDecoder;
  /** Its detector channel; null once it ended. */
  ch: number | null;
  /** The decoder's time is the detector's plus this (a signal taken up again by a new channel, or after Stop, goes on in time). */
  shift: number;
  /** A key-down (detector time) not yet given to the decoder: it goes with its key-up. */
  downAt: number | null;
  /** The decoder's time so far. */
  last: number;
  /** The dit last sent to the detector. */
  sentDit: number;
  /** Marks since it began or since Clear. */
  heard: number;
}

export interface JoinOptions {
  /** Told a channel's dit when it changes: the source sends it to the detector. */
  onDit?: (ch: number, dit: number) => void;
  /** The page clock, ms (performance.now()), for `lastHeard`. */
  clock?: () => number;
  /** Options for each channel's decoder (tests run its search in place). */
  channel?: ChannelOptions;
}

export class SignalJoin {
  private live = new Map<number, Track>();
  private ended: Track[] = [];
  private nextId = 1;
  private readonly onDit: (ch: number, dit: number) => void;
  private readonly clock: () => number;
  /** Marks given to decoders, marks withdrawn by the detector, and key-downs that came out after their decoder's time had passed them. */
  readonly counts = { marks: 0, withdrawn: 0, late: 0 };

  constructor(private readonly opts: JoinOptions = {}) {
    this.onDit = opts.onDit ?? (() => undefined);
    this.clock = opts.clock ?? (() => performance.now());
  }

  /**
   * A batch from the detector: its events, its time and lag (seconds of
   * input), and `at`, the page time (ms) the batch stands for.
   */
  feed(events: RadioEvent[], time: number, lag: number, at = this.clock()): void {
    for (const e of events) {
      if (e.type === 'signal') {
        this.onSignal(e.ch, e.hz, e.snr, e.t);
        continue;
      }
      const k = this.live.get(e.ch);
      if (!k) continue;
      if (e.type === 'gone') {
        this.end(k);
        continue;
      }
      if (e.down) {
        k.downAt ??= e.t;
        k.signal.keying = true;
        continue;
      }
      const start = k.downAt;
      k.downAt = null;
      k.signal.keying = false;
      if (start === null) continue;
      if (e.t <= start) {
        this.counts.withdrawn++;
        continue;
      }
      if (start + k.shift < k.last) this.counts.late++;
      k.dec.keyDown(start + k.shift);
      k.dec.keyUp(e.t + k.shift);
      k.last = Math.max(k.last, e.t + k.shift);
      k.heard++;
      this.counts.marks++;
      k.signal.lastHeard = at - (time - e.t) * 1000;
    }
    const now = time - lag;
    for (const k of this.live.values()) {
      const t = Math.min(now, k.downAt ?? Infinity) + k.shift;
      if (t > k.last) {
        k.dec.tick(t);
        k.last = t;
      }
      const dit = k.dec.dit;
      if (Math.abs(dit - k.sentDit) > DIT_CHANGE * dit) {
        k.sentDit = dit;
        this.onDit(k.ch!, dit);
      }
    }
  }

  /** Every signal heard since the start or the last Clear, newest activity first. */
  list(): RadioSignal[] {
    this.prune();
    const all = [...this.live.values()].filter((k) => k.heard > 0).concat(this.ended);
    return all.map((k) => ({ ...k.signal, wpm: k.dec.wpm, text: k.dec.text, pending: k.dec.pending })).sort((a, b) => b.lastHeard - a.lastHeard);
  }

  /** Forgets every signal's text. Signals still on the air are listed again when next heard; their decoders keep the speed learned. */
  clear(): void {
    for (const k of this.live.values()) {
      k.dec.reset();
      k.heard = 0;
    }
    this.ended = [];
  }

  /**
   * Listening stopped: every signal ends, and the over each was reading is
   * read and written (in the browser, once the search worker gets to it).
   * The next batch comes from a new detector.
   */
  stop(): void {
    for (const k of [...this.live.values()]) this.end(k);
  }

  /** No search running or waiting: every text is as up to date as the input. */
  get idle(): boolean {
    for (const k of this.live.values()) if (!k.dec.idle) return false;
    return this.ended.every((k) => k.dec.idle);
  }

  /** Signals held, live and ended (tests: memory stays flat). */
  get size(): { live: number; ended: number } {
    return { live: this.live.size, ended: this.ended.length };
  }

  private onSignal(ch: number, hz: number, snr: number, t: number) {
    let k = this.live.get(ch);
    if (!k) {
      k = this.takeUp(hz) ?? this.make(hz);
      // Its decoder's time goes on from where it was, with a break.
      if (k.last > -Infinity) k.shift = Math.max(k.shift, k.last + BREAK - (t - BACKLOG));
      k.ch = ch;
      this.live.set(ch, k);
    }
    k.signal.pitch = hz;
    k.signal.snr = snr;
  }

  /** The signal that ended nearest `hz`, within `SAME_HZ`, taken out of the ended ones; null if none. */
  private takeUp(hz: number): Track | null {
    let near: Track | null = null;
    for (const k of this.ended) {
      const d = Math.abs(k.signal.pitch - hz);
      if (d <= SAME_HZ && (!near || d < Math.abs(near.signal.pitch - hz))) near = k;
    }
    if (!near) return null;
    this.ended = this.ended.filter((k) => k !== near);
    // The new channel's filter starts from the speed this decoder knows.
    near.sentDit = 0;
    return near;
  }

  private make(hz: number): Track {
    const dec = new ChannelDecoder(this.opts.channel);
    return {
      signal: { id: this.nextId++, pitch: hz, wpm: null, snr: 0, keying: false, lastHeard: 0, text: '', pending: '' },
      dec,
      ch: null,
      shift: 0,
      downAt: null,
      last: -Infinity,
      // Nothing is known of the speed yet: the detector sizes its filter from the channel's own marks.
      sentDit: dec.dit,
      heard: 0,
    };
  }

  /** The channel ended: a key still down is no mark, and the over in progress ends. */
  private end(k: Track) {
    if (k.ch !== null) this.live.delete(k.ch);
    k.ch = null;
    k.downAt = null;
    k.signal.keying = false;
    if (k.last > -Infinity) {
      k.last += BREAK;
      k.dec.tick(k.last);
    }
    this.ended.push(k);
    this.prune();
  }

  /**
   * Signals that ended with nothing to show go; of the rest, the most recently
   * heard `KEEP_ENDED` are kept. Run as a signal ends and whenever the list is
   * read (a search still running in the worker may have written nothing yet).
   */
  private prune() {
    this.ended = this.ended.filter((k) => k.dec.text || k.dec.pending || !k.dec.idle);
    if (this.ended.length > KEEP_ENDED) {
      this.ended.sort((a, b) => b.signal.lastHeard - a.signal.lastHeard);
      this.ended.length = KEEP_ENDED;
    }
  }
}
