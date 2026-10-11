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
//   PART=0/6 ... PART=5/6, TAG=x: a sixth of the beds each, in parallel;
//   then FILES=bench/results/e0-x-* npm run bench -- e0merge for the tables.
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
import { e0Report, type E0Row } from './lib/e0report';

const ALL_DETECTORS: Record<string, MakeDetector> = {
  before: (fs, o) => new Before(fs, o),
  now: (fs, o) => new Detector(fs, o),
  listener: (fs, o) => new Listener(fs, o),
};
const DETECTORS = Object.fromEntries(Object.entries(ALL_DETECTORS).filter(([k]) => (process.env.DETECTORS ?? 'now,listener').split(',').includes(k)));

const SNRS = [0, 6, 10, 15, 20];
const PITCHES = process.env.PITCHES ? process.env.PITCHES.split(',').map(Number) : [400, 600, 800, 1000];
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

/** The beds by name; each loaded only when its turn comes. */
function beds(): { name: string; load: () => Float32Array }[] {
  const out: { name: string; load: () => Float32Array }[] = [];
  if (existsSync('data/demand')) {
    for (const f of readdirSync('data/demand').filter((f) => f.endsWith('.wav')).sort()) out.push({ name: f.slice(0, -4), load: () => loadBed(`data/demand/${f}`) });
  }
  if (existsSync('samples')) {
    for (const f of readdirSync('samples').filter((f) => f.endsWith('.json') && f.startsWith('2026')).sort()) {
      const meta = JSON.parse(readFileSync(`samples/${f}`, 'utf8'));
      if (meta.kind === 'noise') out.push({ name: `laptop-${meta.notes || 'room'}-${f.slice(9, 15)}`, load: () => loadBed(`samples/${f.slice(0, -5)}.wav`) });
    }
  }
  out.push({ name: 'synthetic-speech', load: () => roomNoise('speech', 60, FS, 0.05, 7) });
  return out;
}

const only = (process.env.BEDS ?? '').split(',').filter(Boolean);
const [part, parts] = (process.env.PART ?? '0/1').split('/').map(Number);

// What a perfect detector would give: the decoder's reading of the true marks.
const refs = new Map<string, string>();
function reference(key: string, marks: { start: number; end: number }[]): string {
  if (!refs.has(key)) refs.set(key, decodeMarks(marks));
  return refs.get(key)!;
}

it('E0', () => {
  const all = beds()
    .filter((b) => !only.length || only.some((o) => b.name.includes(o)))
    .filter((_, i) => i % parts === part);
  const results: E0Row[] = [];
  for (const { name, load } of all) {
    const bed = { name, samples: load() };
    for (const [dname, make] of Object.entries(DETECTORS)) {
      for (const pitch of PITCHES) {
        const quiet = segment(bed.samples, 0, Math.min(bed.samples.length, 60 * FS));
        const stray = letters(read(make, quiet, FS, pitch, 15).text) / (quiet.length / FS / 60);
        for (const timbre of TIMBRES) {
          for (const [k, keying] of KEYINGS.entries()) {
            const tone = renderTone(keying, { pitch, timbre, amplitude: 0.05 });
            const noise = segment(bed.samples, 7 * k + (timbre === 'sine' ? 0 : 31) + pitch / 100, tone.samples.length);
            const ref = reference(`${keying.seed}|${timbre}|${pitch}`, tone.marks);
            SNRS.forEach((snr) => {
              const got = read(make, mix(tone.samples, noise, pitch, 0.05, snr), FS, pitch, 15);
              const err = letterError(ref, got.text);
              const m = scoreMarks(got.marks, tone.marks);
              results.push({ bed: bed.name, detector: dname, pitch, timbre, keying: keying.fist.name, snr, letterError: err, recall: m.recall, precision: m.precision, strayPerMin: stray });
            });
          }
        }
      }
    }
  }
  mkdirSync('bench/results', { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
  const tag = process.env.TAG ? `${process.env.TAG}-${part}of${parts}-` : '';
  writeFileSync(
    `bench/results/e0-${tag}${stamp}.json`,
    JSON.stringify({ snrs: SNRS, pitches: PITCHES, timbres: TIMBRES, keyings: KEYINGS.map((k) => ({ text: k.text, fist: k.fist, seed: k.seed })), results }, null, 2),
  );
  console.log(`\nE0: letter error added by noise, mark recall and precision (%)\n${e0Report(results, SNRS)}\n`);
}, 24 * 3600 * 1000);
