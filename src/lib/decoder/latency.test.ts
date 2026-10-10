// Decode latency: time from the key-up that ends a character to the decoder
// emitting it, through the same detector and decoder the browser runs. A
// character is only complete once the silence after it outlasts a gap inside a
// character, so the floor is about 1.7 dits. The live path ticks on each
// worklet message, at least every 10 ms.

import { afterAll, describe, expect, it } from 'vitest';
import { renderText } from '../morse/render';
import { Detector } from '../dsp/detector';
import { Decoder } from './decoder';
import { applyEvents } from './pipeline';

const FS = 48000;
const ROWS: string[] = [];

function measure(wpm: number, tickEvery: number): number[] {
  const { samples, schedule } = renderText('PARIS PARIS PARIS PARIS', { sampleRate: FS, pitch: 650, amplitude: 0.4, charWpm: wpm, noise: { snrDb: 25 }, seed: 3 });
  const ends = new Map<number, number>();
  for (const m of schedule.marks) ends.set(m.charIndex, Math.max(ends.get(m.charIndex) ?? 0, m.end));
  const truth = [...ends.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => e);
  const detector = new Detector(FS, { dit: 1.2 / wpm });
  const decoder = new Decoder({ initialWpm: wpm });
  const emitted: number[] = [];
  let lastTick = 0;
  for (let i = 0; i < samples.length; i += 128) {
    const events = detector.process(samples.subarray(i, Math.min(samples.length, i + 128)));
    const due = events.length > 0 || detector.time - lastTick >= tickEvery;
    if (due) lastTick = detector.time;
    const out = [...applyEvents(decoder, events), ...(due ? decoder.tick(detector.time) : [])];
    for (const o of out) if (o.kind === 'char') emitted.push(detector.time);
    detector.setDit(decoder.ditEstimate);
  }
  // Skip the first word while the speed estimate settles.
  return emitted.slice(5, truth.length).map((t, k) => (t - truth[k + 5]) * 1000);
}

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

describe('decode latency, key-up to character', () => {
  for (const wpm of [12, 15, 20, 25, 30]) {
    it(`${wpm} wpm`, () => {
      const dit = 1200 / wpm;
      const block = measure(wpm, 0);
      const live = measure(wpm, 0.01);
      ROWS.push(
        `${String(wpm).padStart(2)} wpm  dit ${dit.toFixed(0).padStart(3)} ms  ` +
          `per-block tick: median ${pct(block, 0.5).toFixed(0).padStart(3)} p90 ${pct(block, 0.9).toFixed(0).padStart(3)} ms  ` +
          `live, 10 ms tick: median ${pct(live, 0.5).toFixed(0).padStart(3)} p90 ${pct(live, 0.9).toFixed(0).padStart(3)} ms`,
      );
      expect(block.length).toBeGreaterThan(10);
      // Bound: the boundary (at most 2.6 dits of silence) plus filter delay and one tick.
      expect(pct(block, 0.9)).toBeLessThan(2.6 * dit + 40);
      expect(pct(live, 0.9)).toBeLessThan(2.6 * dit + 50);
    });
  }
  afterAll(() => console.log(`\nDecode latency\n${ROWS.join('\n')}\n`));
});
