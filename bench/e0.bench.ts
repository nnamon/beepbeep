// E0: detector benchmark on keyed sidetones in real and synthetic noise beds.
// For each bed and band SNR (tone fundamental against the noise within one
// ERB of it): the letter error noise adds (against the reading of the true
// marks, so the decoder's own errors on a beginner's fist are not counted),
// mark recall and precision; and stray letters per minute on the bed alone.
//
//   docker compose run --rm dev npm run bench -- e0
//
// Beds: data/demand/*.wav (DEMAND, CC BY 4.0, channel 1, 16 kHz), room-only
// takes in samples/ (local, not committed), synthetic speech. Results go to
// bench/results/.

import { it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Detector } from '../src/lib/dsp/detector';
import { roomNoise } from '../src/lib/dsp/roomnoise';
import { FISTS } from '../src/lib/decoder/fists';
import { Detector as Before } from './baselines/detector-3e97a7c';
import { Listener } from '../src/lib/dsp/listener';
import { FS, loadBed, mix, renderTone, segment, type Timbre } from './lib/scene';
import { decodeMarks, letterError, letters, read, scoreMarks, type MakeDetector } from './lib/run';

const DETECTORS: Record<string, MakeDetector> = {
  before: (fs, o) => new Before(fs, o),
  now: (fs, o) => new Detector(fs, o),
  listener: (fs, o) => new Listener(fs, o),
};

const SNRS = [-6, -3, 0, 3, 6, 10, 15, 20];
const TIMBRES: Timbre[] = ['sine', 'square'];
const PITCH = 600;
const fair = FISTS.find((f) => f.name.startsWith('straight'))!;
const beginner = FISTS.find((f) => f.name === 'newbie, rushed letters')!;
const KEYINGS = [
  { text: 'CQ CQ DE K1ABC K', fist: fair, seed: 11 },
  { text: 'VVV VVV TNX FER CALL', fist: fair, seed: 12 },
  { text: 'CQ CQ DE K1ABC K', fist: beginner, seed: 13 },
  { text: 'NAME IS TOM QTH SINGAPORE', fist: beginner, seed: 14 },
];

function beds(): { name: string; samples: Float32Array }[] {
  const out: { name: string; samples: Float32Array }[] = [];
  if (existsSync('data/demand')) {
    for (const f of readdirSync('data/demand').filter((f) => f.endsWith('.wav')).sort()) out.push({ name: f.slice(0, -4), samples: loadBed(`data/demand/${f}`) });
  }
  if (existsSync('samples')) {
    for (const f of readdirSync('samples').filter((f) => f.endsWith('.json') && f.startsWith('2026')).sort()) {
      const meta = JSON.parse(readFileSync(`samples/${f}`, 'utf8'));
      if (meta.kind === 'noise') out.push({ name: `laptop-${meta.notes || 'room'}-${f.slice(9, 15)}`, samples: loadBed(`samples/${f.slice(0, -5)}.wav`) });
    }
  }
  out.push({ name: 'synthetic-speech', samples: roomNoise('speech', 60, FS, 0.05, 7) });
  return out;
}

const only = (process.env.BEDS ?? '').split(',').filter(Boolean);

// What a perfect detector would give: the decoder's reading of the true marks.
const refs = new Map<string, string>();
function reference(keying: (typeof KEYINGS)[number], timbre: Timbre, marks: { start: number; end: number }[]): string {
  const key = `${keying.seed}|${timbre}`;
  if (!refs.has(key)) refs.set(key, decodeMarks(marks));
  return refs.get(key)!;
}

it('E0', () => {
  const all = beds().filter((b) => !only.length || only.some((o) => b.name.includes(o)));
  const results: Record<string, unknown>[] = [];
  const rows: string[] = [];
  for (const bed of all) {
    for (const [dname, make] of Object.entries(DETECTORS)) {
      // Stray letters on the bed alone: up to 60 s.
      const quiet = segment(bed.samples, 0, Math.min(bed.samples.length, 60 * FS));
      const stray = letters(read(make, quiet, FS, PITCH, 15).text) / (quiet.length / FS / 60);
      const curve: number[] = [];
      const recall: number[] = [];
      const precision: number[] = [];
      for (const snr of SNRS) {
        let err = 0;
        let r = 0;
        let p = 0;
        let n = 0;
        for (const timbre of TIMBRES) {
          for (const [k, keying] of KEYINGS.entries()) {
            const tone = renderTone(keying, { pitch: PITCH, timbre, amplitude: 0.05 });
            const noise = segment(bed.samples, 7 * k + (timbre === 'sine' ? 0 : 31), tone.samples.length);
            const x = mix(tone.samples, noise, PITCH, 0.05, snr);
            const got = read(make, x, FS, PITCH, 15);
            err += letterError(reference(keying, timbre, tone.marks), got.text);
            const m = scoreMarks(got.marks, tone.marks);
            r += m.recall;
            p += m.precision;
            n++;
          }
        }
        curve.push(err / n);
        recall.push(r / n);
        precision.push(p / n);
      }
      // The SNR at which letter error falls to a level: interpolated on the curve, from the top down.
      const at = (level: number) => {
        for (let i = SNRS.length - 1; i > 0; i--) {
          if (curve[i] <= level && curve[i - 1] > level) return SNRS[i - 1] + ((SNRS[i] - SNRS[i - 1]) * (curve[i - 1] - level)) / (curve[i - 1] - curve[i]);
        }
        return curve[0] <= level ? SNRS[0] : Infinity;
      };
      results.push({ bed: bed.name, detector: dname, snrs: SNRS, letterError: curve, recall, precision, snr5: at(0.05), snr20: at(0.2), strayPerMin: stray });
      const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(1).padStart(5) : '  >20');
      const pct = (v: number[]) => v.map((c) => (c * 100).toFixed(0).padStart(4)).join('');
      rows.push(
        `${bed.name.padEnd(28)} ${dname.padEnd(6)} SNR5 ${fmt(at(0.05))} SNR20 ${fmt(at(0.2))} stray/min ${stray.toFixed(1).padStart(5)} | err ${pct(curve)} | recall ${pct(recall)} | precision ${pct(precision)}`,
      );
    }
  }
  mkdirSync('bench/results', { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
  writeFileSync(`bench/results/e0-${stamp}.json`, JSON.stringify({ snrs: SNRS, timbres: TIMBRES, pitch: PITCH, keyings: KEYINGS.map((k) => ({ text: k.text, fist: k.fist.name, seed: k.seed })), results }, null, 2));
  console.log(`\nE0: letter error added by noise, mark recall and precision (%), by band SNR ${SNRS.join(' ')} dB\n${rows.join('\n')}\n`);
}, 24 * 3600 * 1000);
