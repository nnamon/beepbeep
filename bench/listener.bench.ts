// Sanity checks for the soft-evidence detector on clean and lightly noisy scenes.
import { it } from 'vitest';
import { Listener } from '../src/lib/dsp/listener';
import { FISTS } from '../src/lib/decoder/fists';
import { FS, renderTone, type Timbre } from './lib/scene';
import { decodeMarks, letterError, read, scoreMarks } from './lib/run';

it('listener', () => {
  const rows: string[] = [];
  for (const fistName of ['straight key, fair', 'newbie, rushed letters']) {
    const fist = FISTS.find((f) => f.name === fistName)!;
    for (const timbre of ['sine', 'square'] as Timbre[]) {
      const k = { text: 'CQ CQ DE K1ABC K', fist, seed: 11 };
      const tone = renderTone(k, { pitch: 600, timbre, amplitude: 0.05 });
      const x = new Float32Array(tone.samples.length);
      let s = 7;
      for (let i = 0; i < x.length; i++) { s = (s * 16807) % 2147483647; x[i] = tone.samples[i] + 2e-4 * ((s / 2147483647) * 2 - 1); }
      const r = read((fs, o) => new Listener(fs, o), x, FS, 600, 15);
      const m = scoreMarks(r.marks, tone.marks);
      rows.push(`${fistName.slice(0, 14).padEnd(14)} ${timbre.padEnd(6)} recall ${m.recall.toFixed(2)} precision ${m.precision.toFixed(2)} edges ${m.startMs.toFixed(0)}/${m.endMs.toFixed(0)} ms  err ${(letterError(decodeMarks(tone.marks), r.text) * 100).toFixed(0)}%  ${JSON.stringify(r.text)} (${r.marks.length} marks, truth ${tone.marks.length})`);
    }
  }
  console.log('LISTENER\n' + rows.join('\n'));
});
