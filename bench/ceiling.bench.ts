// Ceilings for E0: the decoder on the true marks, and each detector on the clean tone.
import { it } from 'vitest';
import { Detector } from '../src/lib/dsp/detector';
import { FISTS } from '../src/lib/decoder/fists';
import { Detector as Before } from './baselines/detector-3e97a7c';
import { FS, renderTone, type Timbre } from './lib/scene';
import { decodeMarks, letterError, read, scoreMarks } from './lib/run';

const fair = FISTS.find((f) => f.name.startsWith('straight'))!;
const beginner = FISTS.find((f) => f.name === 'newbie, rushed letters')!;
const KEYINGS = [
  { text: 'CQ CQ DE K1ABC K', fist: fair, seed: 11 },
  { text: 'VVV VVV TNX FER CALL', fist: fair, seed: 12 },
  { text: 'CQ CQ DE K1ABC K', fist: beginner, seed: 13 },
  { text: 'NAME IS TOM QTH SINGAPORE', fist: beginner, seed: 14 },
];

it('ceilings', () => {
  const rows: string[] = [];
  for (const k of KEYINGS) {
    for (const timbre of ['sine', 'square'] as Timbre[]) {
      const tone = renderTone(k, { pitch: 600, timbre, amplitude: 0.05 });
      // A whisper of noise so floors are measurable, 60 dB under the tone in its ERB.
      const x = new Float32Array(tone.samples.length);
      let s = 1;
      for (let i = 0; i < x.length; i++) { s = (s * 16807) % 2147483647; x[i] = tone.samples[i] + 2e-5 * ((s / 2147483647) * 2 - 1); }
      const truth = decodeMarks(tone.marks);
      const b = read((fs, o) => new Before(fs, o), x, FS, 600, 15);
      const n = read((fs, o) => new Detector(fs, o), x, FS, 600, 15);
      const sb = scoreMarks(b.marks, tone.marks), sn = scoreMarks(n.marks, tone.marks);
      rows.push(`${k.fist.name.slice(0, 14).padEnd(14)} ${timbre.padEnd(6)} ${k.text.padEnd(26)} true marks ${(letterError(k.text, truth) * 100).toFixed(0).padStart(3)}% ${JSON.stringify(truth).padEnd(28)} before ${(letterError(k.text, b.text) * 100).toFixed(0).padStart(3)}% R${sb.recall.toFixed(2)} | now ${(letterError(k.text, n.text) * 100).toFixed(0).padStart(3)}% R${sn.recall.toFixed(2)} ${JSON.stringify(n.text)}`);
    }
  }
  console.log('\nCEIL\n' + rows.join('\n'));
});
