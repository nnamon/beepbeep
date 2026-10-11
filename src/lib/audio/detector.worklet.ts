// AudioWorklet: runs the detector on the audio thread and posts key events,
// tone lock and level to the main thread. Decoding happens on the main thread.

import { Detector, type DetectorEvent } from '../dsp/detector';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

export type WorkletCommand =
  | { type: 'dit'; dit: number }
  | { type: 'pin'; hz: number | null }
  | { type: 'squelch'; db: number | null }
  | { type: 'mute'; muted: boolean }
  | { type: 'spectrum' }
  | { type: 'record'; on: boolean };

export type WorkletMessage =
  | { type: 'events'; events: DetectorEvent[]; time: number }
  | { type: 'spectrum'; hz: number[]; db: number[] }
  /** Raw input while recording a sample (debug builds); t0 is the detector time of its first sample. */
  | { type: 'pcm'; data: Float32Array; t0: number; last: boolean };

class DetectorProcessor extends AudioWorkletProcessor {
  private detector: Detector;

  constructor() {
    super();
    this.detector = new Detector(sampleRate, {});
    this.port.onmessage = (e: MessageEvent<WorkletCommand>) => {
      const m = e.data;
      if (m.type === 'dit') this.detector.setDit(m.dit);
      else if (m.type === 'pin') {
        const events = this.detector.setPinned(m.hz);
        this.port.postMessage({ type: 'events', events, time: this.detector.time } satisfies WorkletMessage);
      } else if (m.type === 'squelch') this.detector.setSquelch(m.db);
      else if (m.type === 'mute') this.detector.setMuted(m.muted);
      else if (m.type === 'spectrum') {
        const s = this.detector.spectrum();
        this.port.postMessage({ type: 'spectrum', hz: s.hz, db: s.db } satisfies WorkletMessage);
      } else if (m.type === 'record') {
        if (m.on) this.rec = [];
        else if (this.rec) {
          this.sendPcm(true);
          this.rec = null;
        }
      }
    };
  }

  private rec: Float32Array[] | null = null;
  private recLen = 0;
  private recT0 = 0;

  private sendPcm(last: boolean) {
    const data = new Float32Array(this.recLen);
    let at = 0;
    for (const c of this.rec ?? []) {
      data.set(c, at);
      at += c.length;
    }
    this.port.postMessage({ type: 'pcm', data, t0: this.recT0, last } satisfies WorkletMessage, [data.buffer]);
    this.rec = [];
    this.recLen = 0;
  }

  private lastPost = 0;

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel && channel.length) {
      if (this.rec) {
        if (!this.recLen) this.recT0 = this.detector.time;
        this.rec.push(channel.slice());
        this.recLen += channel.length;
        if (this.recLen >= sampleRate / 4) this.sendPcm(false);
      }
      const events = this.detector.process(channel);
      // Post at least every 10 ms, even with no events, so the decoder can
      // close a character as soon as the gap after it is long enough.
      if (events.length || this.detector.time - this.lastPost >= 0.01) {
        this.lastPost = this.detector.time;
        this.port.postMessage({ type: 'events', events, time: this.detector.time } satisfies WorkletMessage);
      }
    }
    return true;
  }
}

registerProcessor('beepbeep-detector', DetectorProcessor);
