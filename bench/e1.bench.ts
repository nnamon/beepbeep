// E1: oracles. With the tone and the noise known separately, a 5 ms frame is
// glimpsed where the tone leads the noise in one ERB (local SNR above 0 dB:
// the ideal binary mask, Wang 2005), at the fundamental alone or at any
// harmonic. "Audible": each true mark kept whole, with its true timing, if at
// least half its frames are glimpsed (deletions only). "Glimpses": the marks
// cut to their glimpsed fragments. The gap from a real detector to "audible"
// is what better detection can win; what "audible" itself loses is what only
// inference across covered stretches can recover.
//
//   docker compose run --rm dev npm run bench -- e1

import { it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { FFT, hann } from '../src/lib/dsp/fft';
import { Detector } from '../src/lib/dsp/detector';
import { roomNoise } from '../src/lib/dsp/roomnoise';
import { FISTS } from '../src/lib/decoder/fists';
import { FS, bandPower, erb, loadBed, renderTone, segment, type Mark, type Timbre } from './lib/scene';
import { decodeMarks, letterError, read } from './lib/run';

const SNRS = [-6, -3, 0, 3, 6, 10, 15];
const PITCH = 600;
const fair = FISTS.find((f) => f.name.startsWith('straight'))!;
const beginner = FISTS.find((f) => f.name === 'newbie, rushed letters')!;
const KEYINGS = [
  { text: 'CQ CQ DE K1ABC K', fist: fair, seed: 11 },
  { text: 'VVV VVV TNX FER CALL', fist: fair, seed: 12 },
  { text: 'CQ CQ DE K1ABC K', fist: beginner, seed: 13 },
  { text: 'NAME IS TOM QTH SINGAPORE', fist: beginner, seed: 14 },
];
const HOP = 0.005;

/** Per 5 ms frame, the power of x in one ERB around each frequency (21 ms Hann window). */
function bandFrames(x: Float32Array, freqs: number[]): Float64Array[] {
  const N = 1024;
  const fft = new FFT(N);
  const w = hann(N);
  const binHz = FS / N;
  const hop = Math.round(HOP * FS);
  const frames = Math.floor((x.length - N) / hop) + 1;
  const out = freqs.map(() => new Float64Array(frames));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let j = 0; j < frames; j++) {
    for (let i = 0; i < N; i++) {
      re[i] = x[j * hop + i] * w[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    freqs.forEach((f, h) => {
      const half = erb(f) / 2;
      let p = 0;
      for (let k = Math.max(1, Math.ceil((f - half) / binHz)); k <= Math.floor((f + half) / binHz); k++) p += re[k] ** 2 + im[k] ** 2;
      out[h][j] = p;
    });
  }
  return out;
}

/**
 * The true marks an ideal listener could hear: those with at least half their
 * frames glimpsed (the tone leading at some harmonic in `harmonics`), kept
 * whole with their true timing. Deletions only; the upper bound for any
 * detector that cannot infer across covered stretches.
 */
function audibleMarks(marks: Mark[], tone: Float32Array, noise: Float32Array, harmonics: number[]): Mark[] {
  const freqs = harmonics.map((h) => h * PITCH);
  const t = bandFrames(tone, freqs);
  const n = bandFrames(noise, freqs);
  const centre = (j: number) => (j * HOP * FS + 512) / FS;
  return marks.filter((m) => {
    let seen = 0;
    let all = 0;
    for (let j = 0; j < t[0].length; j++) {
      const c = centre(j);
      if (c < m.start || c > m.end) continue;
      all++;
      if (freqs.some((_, h) => t[h][j] > n[h][j])) seen++;
    }
    return all > 0 && seen >= all / 2;
  });
}

/** The true marks cut to where the tone leads at some harmonic in `harmonics`; fragments under 20 ms dropped. */
function glimpses(marks: Mark[], tone: Float32Array, noise: Float32Array, harmonics: number[]): Mark[] {
  const freqs = harmonics.map((h) => h * PITCH);
  const t = bandFrames(tone, freqs);
  const n = bandFrames(noise, freqs);
  const N = 1024;
  const centre = (j: number) => (j * HOP * FS + N / 2) / FS;
  const audible = (j: number) => freqs.some((_, h) => t[h][j] > n[h][j]);
  const out: Mark[] = [];
  for (const m of marks) {
    let start: number | null = null;
    for (let j = 0; j < t[0].length; j++) {
      const c = centre(j);
      if (c < m.start || c > m.end) continue;
      if (audible(j)) start ??= Math.max(m.start, c - HOP / 2);
      else if (start !== null) {
        out.push({ start, end: c - HOP / 2 });
        start = null;
      }
    }
    if (start !== null) out.push({ start, end: m.end });
  }
  return out.filter((g) => g.end - g.start >= 0.02);
}

function beds(): { name: string; samples: Float32Array }[] {
  const out: { name: string; samples: Float32Array }[] = [];
  if (existsSync('data/demand')) for (const f of readdirSync('data/demand').filter((f) => f.endsWith('.wav')).sort()) out.push({ name: f.slice(0, -4), samples: loadBed(`data/demand/${f}`) });
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

it('E1', () => {
  const rows: string[] = [];
  const results: Record<string, unknown>[] = [];
  for (const bed of beds().filter((b) => !only.length || only.some((o) => b.name.includes(o)))) {
    for (const timbre of ['sine', 'square'] as Timbre[]) {
      const curves: Record<string, number[]> = { fundamental: [], harmonics: [], audibleF0: [], audibleH: [], detector: [] };
      for (const snr of SNRS) {
        const err: Record<string, number> = { fundamental: 0, harmonics: 0, audibleF0: 0, audibleH: 0, detector: 0 };
        for (const [k, keying] of KEYINGS.entries()) {
          const tone = renderTone(keying, { pitch: PITCH, timbre, amplitude: 0.05 });
          const raw = segment(bed.samples, 7 * k + (timbre === 'sine' ? 0 : 31), tone.samples.length);
          const half = erb(PITCH) / 2;
          const g = Math.sqrt(((0.05 * 0.05) / 2) / bandPower(raw, PITCH - half, PITCH + half) / Math.pow(10, snr / 10));
          const noise = raw.map((v) => v * g);
          const x = tone.samples.map((v, i) => v + noise[i]);
          const ref = decodeMarks(tone.marks);
          err.fundamental += letterError(ref, decodeMarks(glimpses(tone.marks, tone.samples, noise, [1])));
          err.harmonics += letterError(ref, decodeMarks(glimpses(tone.marks, tone.samples, noise, timbre === 'sine' ? [1] : [1, 3, 5])));
          err.audibleF0 += letterError(ref, decodeMarks(audibleMarks(tone.marks, tone.samples, noise, [1])));
          err.audibleH += letterError(ref, decodeMarks(audibleMarks(tone.marks, tone.samples, noise, timbre === 'sine' ? [1] : [1, 3, 5])));
          err.detector += letterError(ref, read((fs, o) => new Detector(fs, o), x, FS, PITCH, 15).text);
        }
        for (const key of Object.keys(err)) curves[key].push(err[key] / KEYINGS.length);
      }
      results.push({ bed: bed.name, timbre, snrs: SNRS, ...curves });
      const pct = (v: number[]) => v.map((c) => (c * 100).toFixed(0).padStart(4)).join('');
      rows.push(`${bed.name.padEnd(22)} ${timbre.padEnd(6)} audible f0 ${pct(curves.audibleF0)} | audible f0+h ${pct(curves.audibleH)} | glimpses f0+h ${pct(curves.harmonics)} | detector ${pct(curves.detector)}`);
    }
  }
  mkdirSync('bench/results', { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
  writeFileSync(`bench/results/e1-${stamp}.json`, JSON.stringify({ snrs: SNRS, pitch: PITCH, results }, null, 2));
  console.log(`\nE1: letter error added by noise (%), band SNR ${SNRS.join(' ')} dB\n${rows.join('\n')}\n`);
}, 24 * 3600 * 1000);
