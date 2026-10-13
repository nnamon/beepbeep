// AudioWorklet: runs the Radio's multi-signal detector (detector.ts) on the
// microphone and posts its events in batches (batch.ts) to the main thread,
// where each channel is decoded (join.ts). It also keeps a debug counter of
// the time each call takes, sent on request.

import { RadioRunner, type RadioCommand, type RadioMessage } from './batch';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

// Not every browser gives a worklet a performance clock. Date.now() counts
// whole milliseconds, but summed over thousands of calls it still measures
// their total time.
const perf = (globalThis as { performance?: { now?: () => number } }).performance;
const precise = typeof perf?.now === 'function';
const clock = precise ? () => perf!.now!() : () => Date.now();

class RadioProcessor extends AudioWorkletProcessor {
  private runner = new RadioRunner(sampleRate);
  private quanta = 0;
  private samples = 0;
  private ms = 0;
  private maxMs = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<RadioCommand>) => {
      const m = e.data;
      if (m.type === 'stats') {
        const stats: RadioMessage = { type: 'stats', quanta: this.quanta, audioSec: this.samples / sampleRate, ms: this.ms, maxMs: this.maxMs, clock: precise ? 'performance' : 'date' };
        this.port.postMessage(stats);
        return;
      }
      const reply = this.runner.command(m);
      if (reply) this.port.postMessage(reply);
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (input && input.length) {
      // Timed with the post: the batch is copied to the main thread here too.
      const t0 = clock();
      const batch = this.runner.process(input);
      if (batch) this.port.postMessage(batch satisfies RadioMessage);
      const dt = clock() - t0;
      this.quanta++;
      this.samples += input.length;
      this.ms += dt;
      if (dt > this.maxMs) this.maxMs = dt;
    }
    return true;
  }
}

registerProcessor('beepbeep-radio', RadioProcessor);
