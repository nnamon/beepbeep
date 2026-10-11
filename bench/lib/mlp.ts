// A small multilayer perceptron for the evidence model: standardised inputs,
// one tanh hidden layer, a logit out. Trained by Adam on logistic loss.
// Inference lives in src/lib/dsp/evidence.ts (mlpLogit).

import { mulberry32 } from '../../src/lib/util/random';
import type { Mlp } from '../../src/lib/dsp/evidence';

export function trainMlp(rows: number[][], ys: number[], hidden = 12, epochs = 12, seed = 1): Mlp {
  const d = rows[0].length;
  const mu = new Array(d).fill(0);
  const sd = new Array(d).fill(0);
  for (const r of rows) r.forEach((v, j) => (mu[j] += v / rows.length));
  for (const r of rows) r.forEach((v, j) => (sd[j] += (v - mu[j]) ** 2 / rows.length));
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const rng = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rng() + 1e-12)) * Math.cos(2 * Math.PI * rng());
  const w1 = Array.from({ length: hidden }, () => Array.from({ length: d }, () => gauss() / Math.sqrt(d)));
  const b1 = new Array(hidden).fill(0);
  const w2 = Array.from({ length: hidden }, () => gauss() / Math.sqrt(hidden));
  let b2 = 0;
  // Adam state.
  const m = { w1: w1.map((r) => r.map(() => 0)), b1: b1.map(() => 0), w2: w2.map(() => 0), b2: 0 };
  const v = { w1: w1.map((r) => r.map(() => 0)), b1: b1.map(() => 0), w2: w2.map(() => 0), b2: 0 };
  const lr = 0.003;
  const B1 = 0.9;
  const B2 = 0.999;
  let step = 0;
  const order = rows.map((_, i) => i);
  const batch = 256;
  const x = new Array(d).fill(0);
  const h = new Array(hidden).fill(0);
  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let s = 0; s < order.length; s += batch) {
      const g = { w1: w1.map((r) => r.map(() => 0)), b1: b1.map(() => 0), w2: w2.map(() => 0), b2: 0 };
      const end = Math.min(order.length, s + batch);
      for (let k = s; k < end; k++) {
        const r = rows[order[k]];
        for (let j = 0; j < d; j++) x[j] = (r[j] - mu[j]) / sd[j];
        let z = b2;
        for (let u = 0; u < hidden; u++) {
          let a = b1[u];
          for (let j = 0; j < d; j++) a += w1[u][j] * x[j];
          h[u] = Math.tanh(a);
          z += w2[u] * h[u];
        }
        const e = 1 / (1 + Math.exp(-z)) - ys[order[k]];
        g.b2 += e;
        for (let u = 0; u < hidden; u++) {
          g.w2[u] += e * h[u];
          const dh = e * w2[u] * (1 - h[u] * h[u]);
          g.b1[u] += dh;
          for (let j = 0; j < d; j++) g.w1[u][j] += dh * x[j];
        }
      }
      const n = end - s;
      step++;
      const upd = (val: number, grad: number, mm: number, vv: number): [number, number, number] => {
        const gg = grad / n;
        const m2 = B1 * mm + (1 - B1) * gg;
        const v2 = B2 * vv + (1 - B2) * gg * gg;
        const mh = m2 / (1 - Math.pow(B1, step));
        const vh = v2 / (1 - Math.pow(B2, step));
        return [val - (lr * mh) / (Math.sqrt(vh) + 1e-8), m2, v2];
      };
      for (let u = 0; u < hidden; u++) {
        for (let j = 0; j < d; j++) [w1[u][j], m.w1[u][j], v.w1[u][j]] = upd(w1[u][j], g.w1[u][j], m.w1[u][j], v.w1[u][j]);
        [b1[u], m.b1[u], v.b1[u]] = upd(b1[u], g.b1[u], m.b1[u], v.b1[u]);
        [w2[u], m.w2[u], v.w2[u]] = upd(w2[u], g.w2[u], m.w2[u], v.w2[u]);
      }
      [b2, m.b2, v.b2] = upd(b2, g.b2, m.b2, v.b2);
    }
  }
  const round = (x: number) => Math.round(x * 1e5) / 1e5;
  return { mu: mu.map(round), sd: sd.map(round), w1: w1.map((r) => r.map(round)), b1: b1.map(round), w2: w2.map(round), b2: round(b2) };
}
