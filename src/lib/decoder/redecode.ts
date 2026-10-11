// Second-pass decoding through a worker, so the search (tens of milliseconds
// per over, more on a phone) never runs on the thread that times the key.
// Without workers (unit tests, a browser that refuses), it runs in place.

import { Decoder, type DecoderModel, type DecoderOutput } from './decoder';

interface Pending {
  model: DecoderModel;
  marks: { start: number; end: number }[];
  until?: number;
  resolve: (o: DecoderOutput[]) => void;
}

let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, Pending>();

function fallBack() {
  worker = null;
  for (const [id, p] of pending) {
    pending.delete(id);
    p.resolve(Decoder.redecode(p.model, p.marks, p.until));
  }
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') return (worker = null);
    worker = new Worker(new URL('./settle.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<{ id: number; outputs: DecoderOutput[] }>) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      p?.resolve(e.data.outputs);
    });
    worker.addEventListener('error', fallBack);
  } catch {
    worker = null;
  }
  return worker;
}

/** Decoder.redecode, off the main thread when possible. */
export function redecodeAsync(model: DecoderModel, marks: { start: number; end: number }[], until?: number): Promise<DecoderOutput[]> {
  const w = getWorker();
  if (!w) return Promise.resolve(Decoder.redecode(model, marks, until));
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, { model, marks, until, resolve });
    w.postMessage({ id, model, marks, until });
  });
}
