// The real laptop recordings (samples/, local), replayed through each detector:
// letter error on keying takes (against samples/labels.json where the text
// given at recording was wrong) and stray letters on room-only takes.
//
//   docker compose run --rm dev npm run bench -- real

import { it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Detector } from '../src/lib/dsp/detector';
import { Listener, listenerModels, listenerTuning } from '../src/lib/dsp/listener';
import { segmenterTuning } from '../src/lib/dsp/segmenter';
import { readWav } from '../src/lib/util/wav';
import { Detector as Before } from './baselines/detector-3e97a7c';
import { letterError, letters, read, type MakeDetector } from './lib/run';

// Evidence models: as trained now (src/lib/dsp/evidence-weights.json), and each
// one kept in bench/models/ for comparison (the first: 450-850 Hz, 10-24 wpm, no keyer).
const trained = { ...listenerModels };
const listener = (offDits: number, models: typeof trained): MakeDetector => (fs, o) => {
  listenerTuning.combine = 'pure';
  segmenterTuning.offDits = offDits;
  // Read every millisecond, so they hold for this detector's whole run.
  listenerModels.pure = models.pure;
  listenerModels.rich = models.rich;
  return new Listener(fs, o);
};
const stored = existsSync('bench/models') ? readdirSync('bench/models').filter((f) => f.endsWith('.json')).sort() : [];

const DETECTORS: Record<string, MakeDetector> = {
  before: (fs, o) => new Before(fs, o),
  now: (fs, o) => new Detector(fs, o),
  'off2.5': listener(2.5, trained),
  'off1.2': listener(1.2, trained),
  ...Object.fromEntries(stored.map((f) => [f.replace(/^evidence-|\.json$/g, ''), listener(1.2, JSON.parse(readFileSync(`bench/models/${f}`, 'utf8')))])),
};

it('real', () => {
  if (!existsSync('samples')) return;
  const labels: Record<string, string | null> = existsSync('samples/labels.json') ? JSON.parse(readFileSync('samples/labels.json', 'utf8')) : {};
  const names = readdirSync('samples').filter((f) => f.startsWith('2026') && f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  const rows: string[] = [];
  const totals: Record<string, { err: number; stray: number }> = {};
  for (const n of names) {
    const meta = JSON.parse(readFileSync(`samples/${n}.json`, 'utf8'));
    const { samples, sampleRate } = readWav(readFileSync(`samples/${n}.wav`));
    const keyed = n in labels ? labels[n] : meta.keyed || null;
    const cells: string[] = [];
    for (const [d, make] of Object.entries(DETECTORS)) {
      const r = read(make, samples, sampleRate, meta.playback?.pitch ?? meta.settings.pinnedHz ?? null, meta.settings.sendWpm || 15);
      totals[d] ??= { err: 0, stray: 0 };
      if (meta.kind === 'noise') {
        totals[d].stray += letters(r.text);
        cells.push(`${d} ${String(letters(r.text)).padStart(3)}L ${JSON.stringify(r.text).slice(0, 18).padEnd(18)}`);
      } else if (keyed) {
        const e = letterError(keyed, r.text);
        totals[d].err += e;
        cells.push(`${d} ${(e * 100).toFixed(0).padStart(4)}% ${JSON.stringify(r.text).slice(0, 18).padEnd(18)}`);
      } else cells.push(`${d}     ? ${JSON.stringify(r.text).slice(0, 18).padEnd(18)}`);
    }
    rows.push(`${n.slice(9).padEnd(24)} ${(meta.notes || meta.kind).slice(0, 14).padEnd(14)} ${cells.join(' | ')}`);
  }
  const sum = Object.entries(totals).map(([d, t]) => `${d}: summed letter error ${(t.err * 100).toFixed(0)}%, stray letters ${t.stray}`).join('; ');
  console.log(`\nREAL\n${rows.join('\n')}\n${sum}\n`);
});
