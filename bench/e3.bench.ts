// E3: soft decisions. Per-frame evidence (E2's features) becomes a probability
// that the tone is on (a logistic model per timbre, trained on half the beds),
// and a hidden Markov model with on and off states and minimum durations tied
// to the dit finds the most likely sequence of marks over the whole stretch
// (Viterbi). Scored against the true marks like E0, next to today's detector.
//
//   docker compose run --rm dev npm run bench -- e3

import { it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Detector } from '../src/lib/dsp/detector';
import { roomNoise } from '../src/lib/dsp/roomnoise';
import { FISTS } from '../src/lib/decoder/fists';
import { FS, loadBed, mix, renderTone, segment, type Mark, type Timbre } from './lib/scene';
import { PITCH, features, labels, trainLogistic, type Features } from './lib/features';
import { decodeMarks, letterError, read, scoreMarks } from './lib/run';

const SNRS = [-6, 0, 3, 6, 10, 15];
const STEP = 5; // ms per HMM frame

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

const row = (perH: Features, i: number) => perH.flatMap((p) => [p.rise[i], p.room[i], p.steady[i]]);

/** Per STEP-ms frame: the logit of tone-on, from the logistic weights. */
function logits(perH: Features, w: number[]): Float64Array {
  const n = Math.floor(perH[0].rise.length / STEP);
  const out = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let acc = 0;
    for (let i = j * STEP; i < (j + 1) * STEP; i++) {
      const r = row(perH, i);
      let z = w[0];
      for (let k = 0; k < r.length; k++) z += w[k + 1] * r[k];
      acc += z;
    }
    out[j] = acc / STEP;
  }
  return out;
}

/**
 * Most likely on/off path: on and off each a chain of `min` states (a minimum
 * duration) ending in a state that stays with probability `stay`. Evidence:
 * the frame's logit, scaled by `alpha` (frames are correlated, so each is
 * worth less than an independent observation), split between the two.
 */
function viterbi(llr: Float64Array, dit: number, alpha: number): Mark[] {
  const minOn = Math.max(2, Math.round((0.4 * dit * 1000) / STEP));
  const minOff = Math.max(2, Math.round((0.4 * dit * 1000) / STEP));
  const stayOn = 1 - 1 / Math.max(2, (1.2 * dit * 1000) / STEP);
  const stayOff = 1 - 1 / Math.max(2, (2.5 * dit * 1000) / STEP);
  const S = minOn + minOff;
  const n = llr.length;
  // States 0..minOn-1: on (last one loops); minOn..S-1: off (last one loops).
  let score = new Float64Array(S).fill(-Infinity);
  score[S - 1] = 0;
  const back = new Int16Array(n * S);
  const lsOn = Math.log(stayOn), lgOn = Math.log(1 - stayOn), lsOff = Math.log(stayOff), lgOff = Math.log(1 - stayOff);
  for (let t = 0; t < n; t++) {
    const next = new Float64Array(S).fill(-Infinity);
    const eOn = (alpha * llr[t]) / 2;
    const eOff = -eOn;
    const set = (to: number, from: number, v: number) => {
      if (v > next[to]) {
        next[to] = v;
        back[t * S + to] = from;
      }
    };
    for (let s = 0; s < S; s++) {
      const v = score[s];
      if (v === -Infinity) continue;
      if (s < minOn - 1) set(s + 1, s, v);
      else if (s === minOn - 1) {
        set(s, s, v + lsOn);
        set(minOn, s, v + lgOn);
      } else if (s < S - 1) set(s + 1, s, v);
      else {
        set(s, s, v + lsOff);
        set(0, s, v + lgOff);
      }
    }
    for (let s = 0; s < S; s++) if (next[s] > -Infinity) next[s] += s < minOn ? eOn : eOff;
    score = next;
  }
  let s = 0;
  for (let k = 1; k < S; k++) if (score[k] > score[s]) s = k;
  const on = new Uint8Array(n);
  for (let t = n - 1; t >= 0; t--) {
    on[t] = s < minOn ? 1 : 0;
    s = back[t * S + s];
  }
  const marks: Mark[] = [];
  let start = -1;
  for (let t = 0; t <= n; t++) {
    if (t < n && on[t] && start < 0) start = t;
    if ((t === n || !on[t]) && start >= 0) {
      marks.push({ start: (start * STEP) / 1000, end: (t * STEP) / 1000 });
      start = -1;
    }
  }
  return marks;
}

it('E3', () => {
  const fair = FISTS.find((f) => f.name.startsWith('straight'))!;
  const beginner = FISTS.find((f) => f.name === 'newbie, rushed letters')!;
  const keyings = [
    { text: 'CQ CQ DE K1ABC K', fist: fair, seed: 31 },
    { text: 'VVV TNX FER CALL', fist: beginner, seed: 32 },
  ];
  const all = beds();
  const train = all.filter((_, i) => i % 2 === 0).map((b) => b.name);
  type Scene = { bed: string; timbre: Timbre; snr: number; keying: (typeof keyings)[number]; x: Float32Array; marks: Mark[]; perH: Features };
  const scenes: Scene[] = [];
  for (const bed of all) {
    for (const timbre of ['sine', 'square'] as Timbre[]) {
      for (const snr of SNRS) {
        for (const [k, keying] of keyings.entries()) {
          const tone = renderTone(keying, { pitch: PITCH, timbre, amplitude: 0.05 });
          const x = mix(tone.samples, segment(bed.samples, 13 * k + 5, tone.samples.length), PITCH, 0.05, snr);
          scenes.push({ bed: bed.name, timbre, snr, keying, x, marks: tone.marks, perH: features(x) });
        }
      }
    }
  }
  // One model per timbre, from the training beds.
  const weights: Record<Timbre, number[]> = { sine: [], square: [], buzzer: [] };
  for (const timbre of ['sine', 'square'] as Timbre[]) {
    const rows: number[][] = [];
    const ys: number[] = [];
    for (const sc of scenes.filter((s) => train.includes(s.bed) && s.timbre === timbre)) {
      const y = labels(sc.marks, sc.perH[0].rise.length);
      for (let i = 0; i < y.length; i += 7) {
        if (y[i] < 0) continue;
        rows.push(row(sc.perH, i));
        ys.push(y[i]);
      }
    }
    weights[timbre] = trainLogistic(rows, ys);
  }
  // Evidence scale: chosen on the training beds by letter error.
  const dit = 1.2 / 15;
  const alphas = [0.05, 0.1, 0.2, 0.4];
  const trainErr = alphas.map((a) => {
    let e = 0;
    for (const sc of scenes.filter((s) => train.includes(s.bed))) e += letterError(decodeMarks(sc.marks), decodeMarks(viterbi(logits(sc.perH, weights[sc.timbre]), dit, a)));
    return e;
  });
  const alpha = alphas[trainErr.indexOf(Math.min(...trainErr))];
  // Test beds: HMM against today's detector.
  const agg: Record<string, { hmm: number[]; det: number[]; hr: number[]; hp: number[]; dr: number[]; dp: number[] }> = {};
  for (const sc of scenes.filter((s) => !train.includes(s.bed))) {
    const key = `${sc.timbre} ${String(sc.snr).padStart(3)} dB`;
    agg[key] ??= { hmm: [], det: [], hr: [], hp: [], dr: [], dp: [] };
    const ref = decodeMarks(sc.marks);
    const hm = viterbi(logits(sc.perH, weights[sc.timbre]), dit, alpha);
    const d = read((fs, o) => new Detector(fs, o), sc.x, FS, PITCH, 15);
    agg[key].hmm.push(letterError(ref, decodeMarks(hm)));
    agg[key].det.push(letterError(ref, d.text));
    const sh = scoreMarks(hm, sc.marks), sd = scoreMarks(d.marks, sc.marks);
    agg[key].hr.push(sh.recall);
    agg[key].hp.push(sh.precision);
    agg[key].dr.push(sd.recall);
    agg[key].dp.push(sd.precision);
  }
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const pc = (v: number[]) => (mean(v) * 100).toFixed(0).padStart(4);
  const lines = Object.entries(agg).map(([k, v]) => `${k.padEnd(14)} added letter error: detector ${pc(v.det)}  HMM ${pc(v.hmm)}  | recall ${pc(v.dr)} vs ${pc(v.hr)}  precision ${pc(v.dp)} vs ${pc(v.hp)}`);
  mkdirSync('bench/results', { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
  writeFileSync(`bench/results/e3-${stamp}.json`, JSON.stringify({ train, alpha, weights, agg }, null, 2));
  console.log(`\nE3 (alpha ${alpha}; trained on ${train.length} beds, tested on ${all.length - train.length})\n${lines.join('\n')}\n`);
}, 24 * 3600 * 1000);
