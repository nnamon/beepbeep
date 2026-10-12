// The second ear (detector.ts, earTuning): tones with a strong third harmonic
// (square wave, buzzer) keyed in the DEMAND beds, the laptop room takes in
// samples/ and synthetic speech, pinned at 500, 700 and 900 Hz. For each band
// SNR: the letter error noise adds (against the reading of the true marks),
// mark recall and precision; by keying as well. And stray letters on 30 s of
// each bed alone after VVV keyed over it at 15 dB, so the second ear has
// started. Sine tones never start the second ear; E0 covers them.
//
//   docker compose run --rm dev npm run bench -- ear
//   PART=0/2 ... PART=1/2: half the beds each, in parallel; OUT=path writes the rows as JSON.
//
// Run it on two checkouts to compare detectors.

import { it } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Detector } from '../src/lib/dsp/detector';
import { roomNoise } from '../src/lib/dsp/roomnoise';
import { FISTS, type Fist } from '../src/lib/decoder/fists';
import { FS, loadBed, mix, renderTone, segment, type Timbre } from './lib/scene';
import { decodeMarks, letterError, letters, read, scoreMarks, type MakeDetector } from './lib/run';

const SNRS = [6, 10, 15, 20];
const PITCHES = [500, 700, 900];
const TIMBRES: Timbre[] = ['square', 'buzzer'];
const fist = (name: string) => FISTS.find((f) => f.name === name)!;
/** Paddles through an electronic keyer, as in E0. */
const KEYER: Fist = { name: 'paddles, keyer', wpm: 18, dah: 3, elem: 1, char: 3.4, word: 7.5, jitter: 0.01, gapJitter: 0.2, elemJitter: 0.01, perChar: 0, drift: 0, hesitate: 0.05 };
const KEYINGS = [
  { text: 'CQ CQ DE K1ABC K', fist: fist('straight key, fair'), seed: 11 },
  { text: 'VVV TNX FER CALL', fist: fist('newbie, rushed letters'), seed: 12 },
  { text: 'NAME IS TOM QTH SINGAPORE', fist: fist('touch key, beginner'), seed: 13 },
  { text: 'UR RST 579 579 73', fist: KEYER, seed: 14 },
];
const make: MakeDetector = (fs, o) => new Detector(fs, o);

function beds(): { name: string; load: () => Float32Array }[] {
  const out: { name: string; load: () => Float32Array }[] = [];
  if (existsSync('data/demand')) for (const f of readdirSync('data/demand').filter((f) => f.endsWith('.wav')).sort()) out.push({ name: f.slice(0, -4), load: () => loadBed(`data/demand/${f}`) });
  if (existsSync('samples')) {
    for (const f of readdirSync('samples').filter((f) => f.endsWith('.json') && f.startsWith('2026')).sort()) {
      const meta = JSON.parse(readFileSync(`samples/${f}`, 'utf8'));
      if (meta.kind === 'noise') out.push({ name: `laptop-${f.slice(9, 15)}`, load: () => loadBed(`samples/${f.slice(0, -5)}.wav`) });
    }
  }
  out.push({ name: 'synthetic-speech', load: () => roomNoise('speech', 60, FS, 0.05, 7) });
  return out;
}

const [part, parts] = (process.env.PART ?? '0/1').split('/').map(Number);

it('ear', () => {
  const rows: { bed: string; pitch: number; timbre: string; keying: string; snr: number; err: number; recall: number; precision: number }[] = [];
  const strays: { bed: string; pitch: number; timbre: string; letters: number }[] = [];
  const refs = new Map<string, string>();
  for (const [bi, { name, load }] of beds().entries()) {
    if (bi % parts !== part) continue;
    const bed = load();
    for (const pitch of PITCHES) {
      for (const timbre of TIMBRES) {
        // VVV over the bed at 15 dB, then the bed alone.
        const pre = renderTone({ text: 'VVV', fist: fist('straight key, fair'), seed: 5 }, { pitch, timbre, amplitude: 0.05 }, 0.5);
        const tone = new Float32Array(pre.samples.length + 30 * FS);
        tone.set(pre.samples);
        const alone = read(make, mix(tone, segment(bed, 3 + pitch / 100, tone.length), pitch, 0.05, 15), FS, pitch, 15);
        const after = pre.marks[pre.marks.length - 1].end + 0.3;
        strays.push({ bed: name, pitch, timbre, letters: letters(decodeMarks(alone.marks.filter((m) => m.start > after))) });
        for (const [k, keying] of KEYINGS.entries()) {
          const t = renderTone(keying, { pitch, timbre, amplitude: 0.05 });
          const noise = segment(bed, 7 * k + 31 + pitch / 100, t.samples.length);
          const key = `${keying.seed}|${timbre}|${pitch}`;
          if (!refs.has(key)) refs.set(key, decodeMarks(t.marks));
          for (const snr of SNRS) {
            const r = read(make, mix(t.samples, noise, pitch, 0.05, snr), FS, pitch, 15);
            const m = scoreMarks(r.marks, t.marks);
            rows.push({ bed: name, pitch, timbre, keying: keying.fist.name, snr, err: letterError(refs.get(key)!, r.text), recall: m.recall, precision: m.precision });
          }
        }
      }
    }
  }
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ rows, strays }));
  const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
  const pct = (v: number[]) => (avg(v) * 100).toFixed(1).padStart(5);
  const lines = SNRS.map((s) => {
    const at = rows.filter((r) => r.snr === s);
    return `${String(s).padStart(2)} dB  letter error ${pct(at.map((r) => r.err))}%  recall ${pct(at.map((r) => r.recall))}  precision ${pct(at.map((r) => r.precision))}`;
  });
  const byKeying = KEYINGS.map((k) => `${k.fist.name.padEnd(24)} ${SNRS.map((s) => `${pct(rows.filter((r) => r.keying === k.fist.name && r.snr === s).map((r) => r.err))}%`).join(' ')}`);
  console.log(`\nEAR (beds ${part + 1} of ${parts}): letter error added by noise, mark recall and precision (%)\n${lines.join('\n')}\nby keying, ${SNRS.join(', ')} dB:\n${byKeying.join('\n')}\nstray letters: ${strays.reduce((a, s) => a + s.letters, 0)} in ${strays.length} stretches of 30 s\n`);
}, 24 * 3600 * 1000);
