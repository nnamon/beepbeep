// E0: detector benchmark on keyed sidetones in real and synthetic noise beds,
// across pitches, timbres, speeds and keys (straight key and electronic
// keyer), so nothing is tuned to one operator's setup. For each band SNR
// (tone fundamental against the noise within one ERB of it): the letter error
// noise adds (against the reading of the true marks, so the decoder's own
// errors on a beginner's fist are not counted), mark recall and precision;
// and stray letters per minute on the bed alone, with the detector pinned at
// each pitch. Reported by pitch (over beds), by keying, and by bed.
//
//   docker compose run --rm dev npm run bench -- e0
//   BEDS=DLIVING,laptop DETECTORS=now,listener ... to narrow it
//
// Beds: data/demand/*.wav (DEMAND, CC BY 4.0, channel 1, 16 kHz), room-only
// takes in samples/ (local, not committed), synthetic speech. Results go to
// bench/results/.

import { it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Detector } from '../src/lib/dsp/detector';
import { roomNoise } from '../src/lib/dsp/roomnoise';
import { FISTS, type Fist } from '../src/lib/decoder/fists';
import { Detector as Before } from './baselines/detector-3e97a7c';
import { Listener } from '../src/lib/dsp/listener';
import { FS, loadBed, mix, renderTone, segment, type Timbre } from './lib/scene';
import { decodeMarks, letterError, letters, read, scoreMarks, type MakeDetector } from './lib/run';

const ALL_DETECTORS: Record<string, MakeDetector> = {
  before: (fs, o) => new Before(fs, o),
  now: (fs, o) => new Detector(fs, o),
  listener: (fs, o) => new Listener(fs, o),
};
const DETECTORS = Object.fromEntries(Object.entries(ALL_DETECTORS).filter(([k]) => (process.env.DETECTORS ?? 'now,listener').split(',').includes(k)));

const SNRS = [0, 6, 10, 15, 20];
const PITCHES = [400, 600, 800, 1000];
const TIMBRES: Timbre[] = ['sine', 'square'];
const fist = (name: string) => FISTS.find((f) => f.name === name)!;
/** Paddles through an electronic keyer: elements and the gaps inside a letter machine-timed, letter and word spacing by hand. */
const KEYER: Fist = { name: 'paddles, keyer', wpm: 18, dah: 3, elem: 1, char: 3.4, word: 7.5, jitter: 0.01, gapJitter: 0.2, elemJitter: 0.01, perChar: 0, drift: 0, hesitate: 0.05 };
const KEYINGS = [
  { text: 'CQ CQ DE K1ABC K', fist: fist('straight key, fair'), seed: 11 },
  { text: 'VVV TNX FER CALL', fist: fist('newbie, rushed letters'), seed: 12 },
  { text: 'NAME IS TOM QTH SINGAPORE', fist: fist('touch key, beginner'), seed: 13 },
  { text: 'UR RST 579 579 73', fist: KEYER, seed: 14 },
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
function reference(key: string, marks: { start: number; end: number }[]): string {
  if (!refs.has(key)) refs.set(key, decodeMarks(marks));
  return refs.get(key)!;
}

interface Cell {
  err: number[];
  recall: number[];
  precision: number[];
  n: number;
  stray: number[];
}

it('E0', () => {
  const all = beds().filter((b) => !only.length || only.some((o) => b.name.includes(o)));
  const results: Record<string, unknown>[] = [];
  const cell = (): Cell => ({ err: SNRS.map(() => 0), recall: SNRS.map(() => 0), precision: SNRS.map(() => 0), n: 0, stray: [] });
  const byPitch: Record<string, Record<string, Cell>> = {};
  const byKeying: Record<string, Record<string, Cell>> = {};
  const byBed: Record<string, Record<string, Cell>> = {};
  const add = (c: Cell, si: number, err: number, rec: number, prec: number) => {
    c.err[si] += err;
    c.recall[si] += rec;
    c.precision[si] += prec;
    if (si === 0) c.n++;
  };
  for (const bed of all) {
    for (const [dname, make] of Object.entries(DETECTORS)) {
      for (const pitch of PITCHES) {
        const quiet = segment(bed.samples, 0, Math.min(bed.samples.length, 60 * FS));
        const stray = letters(read(make, quiet, FS, pitch, 15).text) / (quiet.length / FS / 60);
        ((byPitch[dname] ??= {})[pitch] ??= cell()).stray.push(stray);
        ((byBed[dname] ??= {})[bed.name] ??= cell()).stray.push(stray);
        for (const timbre of TIMBRES) {
          for (const [k, keying] of KEYINGS.entries()) {
            const tone = renderTone(keying, { pitch, timbre, amplitude: 0.05 });
            const noise = segment(bed.samples, 7 * k + (timbre === 'sine' ? 0 : 31) + pitch / 100, tone.samples.length);
            const ref = reference(`${keying.seed}|${timbre}|${pitch}`, tone.marks);
            SNRS.forEach((snr, si) => {
              const got = read(make, mix(tone.samples, noise, pitch, 0.05, snr), FS, pitch, 15);
              const err = letterError(ref, got.text);
              const m = scoreMarks(got.marks, tone.marks);
              for (const c of [byPitch[dname][pitch], ((byKeying[dname] ??= {})[keying.fist.name] ??= cell()), byBed[dname][bed.name]]) add(c, si, err, m.recall, m.precision);
              results.push({ bed: bed.name, detector: dname, pitch, timbre, keying: keying.fist.name, snr, letterError: err, recall: m.recall, precision: m.precision, strayPerMin: stray });
            });
          }
        }
      }
    }
  }
  const pct = (v: number[], n: number) => v.map((x) => ((x / n) * 100).toFixed(0).padStart(4)).join('');
  const mean = (v: number[]) => v.reduce((a, x) => a + x, 0) / Math.max(1, v.length);
  const table = (title: string, groups: Record<string, Record<string, Cell>>, keys: string[]) => {
    const out = [title];
    for (const key of keys) {
      for (const d of Object.keys(DETECTORS)) {
        const c = groups[d]?.[key];
        if (!c) continue;
        out.push(`${key.padEnd(24)} ${d.padEnd(9)} err ${pct(c.err, c.n)} | recall ${pct(c.recall, c.n)} | precision ${pct(c.precision, c.n)}${c.stray.length ? ` | stray/min ${mean(c.stray).toFixed(1)}` : ''}`);
      }
    }
    return out.join('\n');
  };
  const report = [
    `Columns: band SNR ${SNRS.join(' ')} dB`,
    table(`By pitch (over ${all.length} beds)`, byPitch, PITCHES.map(String)),
    table('By keying', byKeying, KEYINGS.map((k) => k.fist.name)),
    table('By bed', byBed, all.map((b) => b.name)),
  ].join('\n\n');
  mkdirSync('bench/results', { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
  writeFileSync(
    `bench/results/e0-${stamp}.json`,
    JSON.stringify({ snrs: SNRS, pitches: PITCHES, timbres: TIMBRES, keyings: KEYINGS.map((k) => ({ text: k.text, fist: k.fist, seed: k.seed })), results }, null, 2),
  );
  console.log(`\nE0: letter error added by noise, mark recall and precision (%)\n${report}\n`);
}, 24 * 3600 * 1000);
