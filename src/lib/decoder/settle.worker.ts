// Runs the whole-over search off the main thread, so re-reading an over never
// delays the handling of the key (see redecodeAsync).
import { Decoder, type DecoderModel } from './decoder';

interface Request {
  id: number;
  model: DecoderModel;
  marks: { start: number; end: number }[];
  until?: number;
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, model, marks, until } = e.data;
  self.postMessage({ id, outputs: Decoder.redecode(model, marks, until) });
};
