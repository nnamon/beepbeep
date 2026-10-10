// Wires the detector's key events into the decoder, with speed feedback, and
// turns decoder output into text. Used live (main thread) and in tests.

import { Detector, type DetectorEvent, type DetectorOptions } from '../dsp/detector';
import { Decoder, type DecodedChar, type DecoderOptions, type DecoderOutput } from './decoder';

export interface DecodeResult {
  text: string;
  chars: DecodedChar[];
  outputs: DecoderOutput[];
  pitch: number | null;
  wpm: number;
}

/** Applies detector events to a decoder in order. Returns decoder output. */
export function applyEvents(decoder: Decoder, events: DetectorEvent[]): DecoderOutput[] {
  const out: DecoderOutput[] = [];
  for (const e of events) {
    if (e.type === 'key') out.push(...(e.down ? decoder.keyDown(e.t) : decoder.keyUp(e.t)));
    else if (e.type === 'status') out.push(...decoder.tick(e.t));
  }
  return out;
}

export function outputsToText(outputs: DecoderOutput[]): string {
  let s = '';
  for (const o of outputs) {
    if (o.kind === 'space') s += ' ';
    else s += o.char.token ?? '⁇';
  }
  return s.trim();
}

/** Decodes a whole buffer offline, in 128-sample blocks like the AudioWorklet. */
export function decodeSamples(
  samples: Float32Array,
  sampleRate: number,
  opts: DetectorOptions & DecoderOptions = {},
): DecodeResult {
  const detector = new Detector(sampleRate, { ...opts, dit: 1.2 / (opts.initialWpm ?? 15) });
  const decoder = new Decoder(opts);
  const outputs: DecoderOutput[] = [];
  const block = 128;
  for (let i = 0; i < samples.length; i += block) {
    const events = detector.process(samples.subarray(i, Math.min(samples.length, i + block)));
    outputs.push(...applyEvents(decoder, events));
    outputs.push(...decoder.tick(detector.time));
    detector.setDit(decoder.ditEstimate);
  }
  outputs.push(...decoder.flush(detector.time + 10));
  return {
    text: outputsToText(outputs),
    chars: outputs.filter((o) => o.kind === 'char').map((o) => (o as { char: DecodedChar }).char),
    outputs,
    pitch: detector.pitch,
    wpm: decoder.wpm,
  };
}
