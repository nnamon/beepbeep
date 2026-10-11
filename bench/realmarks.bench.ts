import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Detector } from '../src/lib/dsp/detector';
import { Listener, listenerTuning } from '../src/lib/dsp/listener';
import { readWav } from '../src/lib/util/wav';
import { read } from './lib/run';
it('realmarks', () => {
  const n = process.env.NAME ?? '20261011-154517-keying-t6';
  const meta = JSON.parse(readFileSync(`samples/${n}.json`, 'utf8'));
  const { samples, sampleRate } = readWav(readFileSync(`samples/${n}.wav`));
  const f = (m: { start: number; end: number }[]) => m.map((x) => `${x.start.toFixed(3)}+${((x.end - x.start) * 1000).toFixed(0)}`).join(' ');
  const a = read((fs, o) => new Detector(fs, o), samples, sampleRate, meta.settings.pinnedHz, 15);
  listenerTuning.combine = 'pure';
  const b = read((fs, o) => new Listener(fs, o), samples, sampleRate, meta.settings.pinnedHz, 15);
  console.log(`RM\nnow      ${a.text}\n${f(a.marks)}\nlistener ${b.text}\n${f(b.marks)}`);
});
