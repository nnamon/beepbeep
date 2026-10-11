// Trains the detector's evidence models (src/lib/dsp/evidence.ts) on the
// benchmark's training beds and writes src/lib/dsp/evidence-weights.json.
//   pure: a sine sidetone, the fundamental's rise and steadiness
//   rich: a tone with harmonics (square wave, buzzer), harmonics 1-5
// Scenes vary pitch (450-850 Hz), speed (10-24 wpm), fist, timbre, key thump,
// room reverberation, mistuning and SNR. Reports ROC area on the held-out beds.
// Wider ranges were tried (bench/models/, docs/research/hearing-the-key.md 6b):
// the features carry across pitch already, and training on 300-1200 Hz made the
// models worse at every pitch, including the ones it added.
//
//   docker compose run --rm dev npm run bench -- train
//   PITCH=300-1200 WPM=8-35 KEYER=1 SEED=5000 OUT=bench/models/x.json ... to vary it

import { it } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Evidence, RICH, featureRow } from '../src/lib/dsp/evidence';
import { roomNoise } from '../src/lib/dsp/roomnoise';
import { FISTS } from '../src/lib/decoder/fists';
import { mulberry32 } from '../src/lib/util/random';
import { FS, loadBed, mix, renderTone, segment, type Mark, type Timbre } from './lib/scene';
import { auc, labels } from './lib/features';
import { trainMlp } from './lib/mlp';
import { mlpLogit, type Mlp } from '../src/lib/dsp/evidence';

const TEXTS = ['CQ CQ DE K1ABC K', 'VVV TNX FER CALL', 'NAME IS TOM QTH SINGAPORE', 'UR RST 579 579 73', 'PARIS PARIS DE 9V1XX'];
const FISTNAMES = ['straight key, fair', 'newbie, rushed letters', 'newbie, hesitant', 'touch key, beginner', 'clean, 20 wpm (control)', 'paddles, keyer'];
/** Paddles through an electronic keyer: machine-timed elements, hand spacing between letters. */
const KEYER = { name: 'paddles, keyer', wpm: 18, dah: 3, elem: 1, char: 3.4, word: 7.5, jitter: 0.01, gapJitter: 0.2, elemJitter: 0.01, perChar: 0, drift: 0, hesitate: 0.05 };
const SNRS = [-6, -3, 0, 3, 6, 10, 15, 20, 30];
const range = (v: string | undefined, d: [number, number]) => (v ? (v.split('-').map(Number) as [number, number]) : d);
const PITCH = range(process.env.PITCH, [450, 850]);
const WPM = range(process.env.WPM, [10, 24]);
const fistNames = process.env.KEYER === '1' ? FISTNAMES : FISTNAMES.filter((n) => n !== KEYER.name);
const SEED = Number(process.env.SEED ?? 1000);
const OUT = process.env.OUT ?? 'src/lib/dsp/evidence-weights.json';

export function benchBeds(): { name: string; samples: Float32Array }[] {
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

interface Scene {
  bed: string;
  timbre: Timbre;
  snr: number;
  rows: number[][];
  y: Int8Array;
}

function scene(bed: { name: string; samples: Float32Array }, timbre: Timbre, snr: number, seed: number): Scene {
  const rng = mulberry32(seed);
  // The app's whole search range of pitches, and speeds from a slow beginner to a quick operator.
  const pitch = PITCH[0] + Math.floor(rng() * (PITCH[1] - PITCH[0]));
  const fist = [...FISTS, KEYER].find((f) => f.name === fistNames[Math.floor(rng() * fistNames.length)])!;
  const wpm = WPM[0] + Math.floor(rng() * (WPM[1] - WPM[0] + 1));
  const keying = { text: TEXTS[Math.floor(rng() * TEXTS.length)], fist: { ...fist, wpm }, seed };
  // Half the scenes with a key's thump at the edges, half in a reverberant room.
  const thump = rng() < 0.5 ? { level: -10 + rng() * 15 } : undefined;
  const reverb = rng() < 0.5 ? { rt60: 0.2 + rng() * 0.4, level: -20 + rng() * 10 } : undefined;
  const tone = renderTone(keying, { pitch, timbre, amplitude: 0.05, thump, reverb });
  const x = mix(tone.samples, segment(bed.samples, rng() * 200, tone.samples.length), pitch, 0.05, snr);
  // Pinned within a few hertz of the tone, as a calibrated pin is.
  const mistune = (rng() - 0.5) * 6;
  const ev = new Evidence(FS, timbre === 'sine' ? [1] : RICH, Math.min(250, Math.max(30, (4 * wpm) / 1.2)));
  ev.tune(pitch + mistune);
  const rows: number[][] = [];
  for (let i = 0; i < x.length; i++) {
    const f = ev.step(x[i], 0);
    if (f) rows.push(featureRow(f));
  }
  return { bed: bed.name, timbre, snr, rows, y: labels(tone.marks as Mark[], rows.length) };
}

it('train', () => {
  const beds = benchBeds();
  const train = beds.filter((_, i) => i % 2 === 0).map((b) => b.name);
  const scenes: Scene[] = [];
  let seed = SEED;
  for (const bed of beds) for (const timbre of ['sine', 'square', 'buzzer'] as Timbre[]) for (const snr of SNRS) scenes.push(scene(bed, timbre, snr, seed++));
  const fit = (pick: (s: Scene) => boolean) => {
    const rows: number[][] = [];
    const ys: number[] = [];
    for (const sc of scenes.filter((s) => train.includes(s.bed) && pick(s))) {
      for (let i = 0; i < sc.y.length; i += 5) {
        if (sc.y[i] < 0) continue;
        rows.push(sc.rows[i]);
        ys.push(sc.y[i]);
      }
    }
    return trainMlp(rows, ys);
  };
  const pure: Mlp = fit((s) => s.timbre === 'sine');
  const rich: Mlp = fit((s) => s.timbre !== 'sine');
  // Held-out ROC area per timbre and SNR.
  const lines: string[] = [];
  for (const timbre of ['sine', 'square', 'buzzer'] as Timbre[]) {
    const w = timbre === 'sine' ? pure : rich;
    const parts = SNRS.map((snr) => {
      const v = scenes
        .filter((s) => !train.includes(s.bed) && s.timbre === timbre && s.snr === snr)
        .map((s) => auc(Float64Array.from(s.rows.map((r) => mlpLogit(timbre === 'sine' ? r.slice(0, 3) : r, w))), s.y))
        .filter((a) => Number.isFinite(a));
      return (v.reduce((a, b) => a + b, 0) / v.length).toFixed(3);
    });
    lines.push(`${timbre.padEnd(7)} ${parts.join('  ')}`);
  }
  writeFileSync(
    OUT,
    JSON.stringify({ note: 'Trained by bench/train.bench.ts; do not edit by hand.', trainedOn: train, scenes: { pitch: PITCH, wpm: WPM, fists: fistNames, seed: SEED }, pure, rich }, null, 2) + '\n',
  );
  console.log(`\nEvidence models (trained on ${train.length} beds). Held-out ROC area by SNR ${SNRS.join(' ')} dB\n${lines.join('\n')}\n`);
}, 24 * 3600 * 1000);
