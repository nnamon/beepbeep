// Chooses the listener's evidence scale (alpha) by added letter error on the
// training beds, scenes with thumps and reverb as in training.
import { it } from 'vitest';
import { Listener, listenerTuning } from '../src/lib/dsp/listener';
import { FISTS } from '../src/lib/decoder/fists';
import { mulberry32 } from '../src/lib/util/random';
import { FS, mix, renderTone, segment, type Timbre } from './lib/scene';
import { decodeMarks, letterError, read } from './lib/run';
import { benchBeds } from './train.bench';

it('alpha', () => {
  const beds = benchBeds();
  const train = beds.filter((_, i) => i % 2 === 0);
  const test = beds.filter((_, i) => i % 2 === 1);
  const scenes = (set: typeof beds, seed0: number) => {
    const out: { x: Float32Array; ref: string; pitch: number }[] = [];
    let seed = seed0;
    for (const bed of set) for (const timbre of ['sine', 'square'] as Timbre[]) for (const snr of [0, 6, 12, 20]) {
      const rng = mulberry32(seed++);
      const fist = FISTS[[0, 1, 2, 5, 6][Math.floor(rng() * 5)]];
      const keying = { text: ['CQ CQ DE K1ABC K', 'VVV VVV DE 9V1XX', 'TNX FER CALL 73'][Math.floor(rng() * 3)], fist, seed };
      const thump = rng() < 0.5 ? { level: -10 + rng() * 15 } : undefined;
      const tone = renderTone(keying, { pitch: 600, timbre, amplitude: 0.05, thump });
      out.push({ x: mix(tone.samples, segment(bed.samples, rng() * 200, tone.samples.length), 600, 0.05, snr), ref: decodeMarks(tone.marks), pitch: 600 });
    }
    return out;
  };
  const tr = scenes(train, 5000);
  const te = scenes(test, 9000);
  const rows: string[] = [];
  for (const a of [0.2, 0.4, 0.7, 1.0, 1.5, 2.5]) {
    listenerTuning.alpha = a;
    const err = (ss: typeof tr) => ss.reduce((acc, s) => acc + letterError(s.ref, read((fs, o) => new Listener(fs, o), s.x, FS, s.pitch, 15).text), 0) / ss.length;
    rows.push(`alpha ${a.toFixed(1)}  train ${(err(tr) * 100).toFixed(1)}%  test ${(err(te) * 100).toFixed(1)}%`);
  }
  console.log('ALPHA\n' + rows.join('\n'));
}, 24 * 3600 * 1000);
