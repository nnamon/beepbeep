// E2: front-end evidence, scored per 1 ms frame against whether the tone is
// on, independent of any key state machine or decoder. Each measure is a
// number per frame; its ROC area says how well it separates tone-on frames
// from tone-off frames in a given noise bed and SNR.
//
//   s1 f0 level      rise of the fundamental's channel over its floor
//   s2 f0 vs room    s1 minus the rise of flanking channels (comodulation)
//   s3 + steadiness  s2, penalised when the phase is not steady at the pitch
//   s4 glimpse       best of s3 over harmonics 1..5 (glimpsing, harmonicity)
//   s5 learned       logistic regression over all per-harmonic features,
//                    trained on half the beds, tested on the other half
//
//   docker compose run --rm dev npm run bench -- e2

import { it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { roomNoise } from '../src/lib/dsp/roomnoise';
import { FISTS } from '../src/lib/decoder/fists';
import { FS, loadBed, mix, renderTone, segment, type Timbre } from './lib/scene';
import { PITCH, auc, features, labels, scores, trainLogistic } from './lib/features';

const SNRS = [-6, 0, 6, 12];

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

it('E2', () => {
  const fair = FISTS.find((f) => f.name.startsWith('straight'))!;
  const keyings = [
    { text: 'CQ CQ DE K1ABC K', fist: fair, seed: 21 },
    { text: 'VVV TNX FER CALL', fist: fair, seed: 22 },
  ];
  const all = beds();
  // Train the learned combination on every other bed; test on the rest.
  const train = all.filter((_, i) => i % 2 === 0).map((b) => b.name);
  type Scene = { bed: string; timbre: Timbre; snr: number; perH: ReturnType<typeof features>; y: Int8Array };
  const scenes: Scene[] = [];
  for (const bed of all) {
    for (const timbre of ['sine', 'square'] as Timbre[]) {
      for (const snr of SNRS) {
        for (const [k, keying] of keyings.entries()) {
          const tone = renderTone(keying, { pitch: PITCH, timbre, amplitude: 0.05 });
          const x = mix(tone.samples, segment(bed.samples, 11 * k + 3, tone.samples.length), PITCH, 0.05, snr);
          const perH = features(x);
          scenes.push({ bed: bed.name, timbre, snr, perH, y: labels(tone.marks, perH[0].rise.length) });
        }
      }
    }
  }
  // Training rows: a subsample of labelled frames from training beds.
  const rows: number[][] = [];
  const ys: number[] = [];
  for (const sc of scenes.filter((s) => train.includes(s.bed))) {
    for (let i = 0; i < sc.y.length; i += 7) {
      if (sc.y[i] < 0) continue;
      rows.push(sc.perH.flatMap((p) => [p.rise[i], p.room[i], p.steady[i]]));
      ys.push(sc.y[i]);
    }
  }
  const weights = trainLogistic(rows, ys);
  // AUC per measure, averaged over test beds, by timbre and SNR.
  const table: Record<string, Record<string, number[]>> = {};
  const perBed: string[] = [];
  for (const sc of scenes.filter((s) => !train.includes(s.bed))) {
    const s = scores(sc.perH, weights);
    const key = `${sc.timbre} ${String(sc.snr).padStart(3)} dB`;
    table[key] ??= { s1: [], s2: [], s3: [], s4: [], s5: [] };
    for (const m of ['s1', 's2', 's3', 's4', 's5'] as const) table[key][m].push(auc(s[m], sc.y));
  }
  const mean = (v: number[]) => v.filter((x) => Number.isFinite(x)).reduce((a, b) => a + b, 0) / v.filter((x) => Number.isFinite(x)).length;
  const lines = Object.entries(table).map(([k, v]) => `${k.padEnd(14)} f0 level ${mean(v.s1).toFixed(3)}  f0 vs room ${mean(v.s2).toFixed(3)}  +steadiness ${mean(v.s3).toFixed(3)}  glimpse h1-5 ${mean(v.s4).toFixed(3)}  learned ${mean(v.s5).toFixed(3)}`);
  // Per test bed at 0 dB, square: where each measure stands.
  for (const bed of all.filter((b) => !train.includes(b.name))) {
    const sc = scenes.filter((s) => s.bed === bed.name && s.snr === 0);
    const by = (timbre: Timbre, m: 's1' | 's4' | 's5') => mean(sc.filter((s) => s.timbre === timbre).map((s) => auc(scores(s.perH, weights)[m], s.y)));
    perBed.push(`${bed.name.padEnd(26)} 0 dB  sine: f0 ${by('sine', 's1').toFixed(3)} glimpse ${by('sine', 's4').toFixed(3)} learned ${by('sine', 's5').toFixed(3)} | square: f0 ${by('square', 's1').toFixed(3)} glimpse ${by('square', 's4').toFixed(3)} learned ${by('square', 's5').toFixed(3)}`);
  }
  mkdirSync('bench/results', { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
  writeFileSync(`bench/results/e2-${stamp}.json`, JSON.stringify({ train, weights, table }, null, 2));
  console.log(`\nE2: per-frame ROC area on test beds (${all.length - train.length} beds; trained on ${train.length})\n${lines.join('\n')}\n\nPer test bed, 0 dB\n${perBed.join('\n')}\n\nweights ${weights.map((w) => w.toFixed(3)).join(' ')}\n`);
}, 24 * 3600 * 1000);
