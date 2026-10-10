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
  | { type: 'mute'; muted: boolean }
  | { type: 'spectrum' };

export type WorkletMessage =
  | { type: 'events'; events: DetectorEvent[]; time: number }
  | { type: 'spectrum'; hz: number[]; db: number[] };

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
      } else if (m.type === 'mute') this.detector.setMuted(m.muted);
      else if (m.type === 'spectrum') {
        const s = this.detector.spectrum();
        this.port.postMessage({ type: 'spectrum', hz: s.hz, db: s.db } satisfies WorkletMessage);
      }
    };
  }

  private lastPost = 0;

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel && channel.length) {
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
