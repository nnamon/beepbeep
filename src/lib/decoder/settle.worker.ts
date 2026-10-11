// Runs the whole-over search off the main thread, so re-reading an over never
// delays the handling of the key (see redecodeAsync).
import { Decoder, type DecoderModel } from './decoder';
import type { Kept } from './settle';

interface Request {
  id: number;
  model: DecoderModel;
  marks: { start: number; end: number }[];
  until?: number;
  keep?: Kept[];
  full?: boolean;
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, model, marks, until, keep, full } = e.data;
  self.postMessage({ id, outputs: Decoder.redecode(model, marks, until, keep, full) });
};
