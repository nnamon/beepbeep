// The Radio screen's source: every signal in the radio's audio at once. The
// microphone feeds the multi-signal detector in its own AudioWorklet
// (radio.worklet.ts); its events are joined to one decoder per channel on
// this thread (join.ts), and the screen is told a few times a second.
//
// The microphone is the app's shared one. While Radio listens, the detector
// for your own key hears nothing; it takes over again on Stop. The radio is
// not your key: nothing here keys or plays a sidetone, and the pitch you
// pinned and the squelch you set in Setup are not used.

import { engine } from '../audio/engine';
import { lastMicFailure, signal, startMic } from '../state/signal.svelte';
import { SignalJoin } from './join';
import type { RadioSignal, RadioSource } from './source';

/** How often the screen is told, ms. */
const PUSH_MS = 250;

export class MultiSignalSource implements RadioSource {
  private join = new SignalJoin({ onDit: (ch, dit) => engine.radioCommand({ type: 'dit', ch, dit }) });
  private subs = new Set<(signals: RadioSignal[]) => void>();
  private unsub: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Each start; Stop while the browser still asks for the microphone gives that start up. */
  private run = 0;

  async start(): Promise<void> {
    if (this.unsub) return;
    const run = ++this.run;
    // The radio's worklet first: just after an update, an old build's file that
    // is gone reloads the page into the new build before the microphone is asked for.
    await engine.prepareRadio();
    if (!signal.micOn) {
      const info = await startMic();
      if (!info) throw lastMicFailure() ?? new Error("The microphone didn't start.");
    }
    if (run !== this.run || this.unsub) return;
    await engine.startRadio();
    if (run !== this.run || this.unsub) {
      if (!this.unsub) engine.stopRadio();
      return;
    }
    this.unsub = engine.onRadio((b) => this.join.feed(b.events, b.time, b.lag));
    this.push();
    this.emit();
  }

  stop() {
    this.run++;
    if (!this.unsub) return;
    this.unsub();
    this.unsub = null;
    engine.stopRadio();
    // The over each signal was reading is written; the screen is told until the last search is done.
    this.join.stop();
    this.emit();
  }

  clear() {
    this.join.clear();
    this.emit();
  }

  subscribe(fn: (signals: RadioSignal[]) => void): () => void {
    this.subs.add(fn);
    fn(this.join.list());
    return () => this.subs.delete(fn);
  }

  /** Tells the screen a few times a second while listening, and after Stop until every search is done. */
  private push() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.emit();
      if (!this.unsub && this.join.idle && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }, PUSH_MS);
  }

  private emit() {
    const list = this.join.list();
    for (const fn of this.subs) fn(list);
  }
}
