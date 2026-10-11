// Per-frame evidence for the tone, shared by the E2 and E3 benchmarks: lock-in
// channels at the pitch's harmonics, each with its rise over a median floor,
// the rise of flanking channels (the room), and phase steadiness at the pitch.

import { LowPass } from '../../src/lib/dsp/biquad';
import { FS, erb, type Mark } from './scene';

export const PITCH = 600;
export const HARMONICS = [1, 2, 3, 4, 5];
const DEC = FS / 1000;

/** One lock-in channel over a whole signal: complex baseband at 1 kHz. */
export function lockIn(x: Float32Array, hz: number, cutoff = 50): { re: Float64Array; im: Float64Array } {
  const n = Math.floor(x.length / DEC);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const li = [new LowPass(FS, cutoff), new LowPass(FS, cutoff)];
  const w = (2 * Math.PI * hz) / FS;
  let c = 1;
  let s = 0;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  for (let i = 0; i < n * DEC; i++) {
    const nc = c * cw - s * sw;
    s = s * cw + c * sw;
    c = nc;
    if ((i & 1023) === 0) {
      const m = Math.hypot(c, s);
      c /= m;
      s /= m;
    }
    const a = li[0].step(x[i] * c);
    const b = li[1].step(x[i] * s);
    if (i % DEC === DEC - 1) {
      re[(i / DEC) | 0] = a;
      im[(i / DEC) | 0] = b;
    }
  }
  return { re, im };
}

const db = (re: number, im: number) => 20 * Math.log10(2 * Math.hypot(re, im) + 1e-9);

/** Median-tracking floor of a dB series (10 dB/s steps), causal. */
export function floorOf(v: Float64Array): Float64Array {
  const f = new Float64Array(v.length);
  let x = v.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
  for (let i = 0; i < v.length; i++) {
    x += v[i] > x ? 0.01 : -0.01;
    f[i] = x;
  }
  return f;
}

/** Per-frame features for one scene. */
export type Features = { rise: Float64Array; room: Float64Array; steady: Float64Array }[];

export function features(x: Float32Array, pitch = PITCH): Features {
  const perH = HARMONICS.map((h) => {
    const f = h * pitch;
    const off = Math.max(200, 1.5 * erb(f));
    const t = lockIn(x, f);
    const lo = lockIn(x, f - off);
    const hi = lockIn(x, f + off);
    const n = t.re.length;
    const level = new Float64Array(n);
    const flankA = new Float64Array(n);
    const flankB = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      level[i] = db(t.re[i], t.im[i]);
      flankA[i] = db(lo.re[i], lo.im[i]);
      flankB[i] = db(hi.re[i], hi.im[i]);
    }
    const fl = floorOf(level);
    const fa = floorOf(flankA);
    const fb = floorOf(flankB);
    const rise = new Float64Array(n);
    const room = new Float64Array(n);
    const steady = new Float64Array(n);
    // Phase steadiness: lag 4 ms, smoothed 4 ms; offset from the pitch should be ~0 (the tone is at the lock).
    let wr = 0;
    let wi = 0;
    let wm = 0;
    const a = 1 - Math.exp(-1 / 4);
    for (let i = 0; i < n; i++) {
      rise[i] = level[i] - fl[i];
      room[i] = Math.max(0, Math.min(flankA[i] - fa[i], flankB[i] - fb[i]));
      if (i >= 4) {
        const pr = t.re[i - 4];
        const pi = t.im[i - 4];
        wr += (t.re[i] * pr + t.im[i] * pi - wr) * a;
        wi += (t.im[i] * pr - t.re[i] * pi - wi) * a;
        wm += (Math.hypot(t.re[i], t.im[i]) * Math.hypot(pr, pi) - wm) * a;
      }
      const coh = Math.hypot(wr, wi) / (wm + 1e-30);
      const offset = Math.abs(Math.atan2(wi, wr) / (2 * Math.PI * 0.004)) / h;
      // 1 when steady at the pitch, falling off with incoherence and pitch error.
      steady[i] = Math.max(0, Math.min(1, (coh - 0.3) / 0.6)) * Math.max(0, 1 - offset / 20);
    }
    return { rise, room, steady };
  });
  return perH;
}

export function scores(perH: Features, weights: number[] | null) {
  const n = perH[0].rise.length;
  const s1 = new Float64Array(n);
  const s2 = new Float64Array(n);
  const s3 = new Float64Array(n);
  const s4 = new Float64Array(n);
  const s5 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const f0 = perH[0];
    s1[i] = f0.rise[i];
    s2[i] = f0.rise[i] - f0.room[i];
    s3[i] = s2[i] - 20 * (1 - f0.steady[i]);
    let best = -Infinity;
    for (const p of perH) best = Math.max(best, p.rise[i] - p.room[i] - 20 * (1 - p.steady[i]));
    s4[i] = best;
    if (weights) {
      let z = weights[0];
      perH.forEach((p, h) => {
        z += weights[1 + 3 * h] * p.rise[i] + weights[2 + 3 * h] * p.room[i] + weights[3 + 3 * h] * p.steady[i];
      });
      s5[i] = z;
    }
  }
  return { s1, s2, s3, s4, s5 };
}

/** Frame labels: 1 inside a mark, 0 in a gap, -1 near an edge (10 ms) or at the scene's ends. */
export function labels(marks: Mark[], n: number): Int8Array {
  const y = new Int8Array(n).fill(0);
  for (const m of marks) for (let i = Math.max(0, Math.floor((m.start - 0.01) * 1000)); i < Math.min(n, Math.ceil((m.end + 0.01) * 1000)); i++) y[i] = -1;
  for (const m of marks) for (let i = Math.ceil((m.start + 0.01) * 1000); i < Math.floor((m.end - 0.01) * 1000); i++) y[i] = 1;
  for (let i = 0; i < Math.min(n, 300); i++) y[i] = -1;
  return y;
}

/** ROC area by ranks (Mann-Whitney). */
export function auc(score: Float64Array, y: Int8Array): number {
  const idx: number[] = [];
  for (let i = 0; i < y.length; i++) if (y[i] >= 0) idx.push(i);
  idx.sort((a, b) => score[a] - score[b]);
  let rankSum = 0;
  let pos = 0;
  idx.forEach((i, r) => {
    if (y[i] === 1) {
      rankSum += r + 1;
      pos++;
    }
  });
  const neg = idx.length - pos;
  return pos && neg ? (rankSum - (pos * (pos + 1)) / 2) / (pos * neg) : NaN;
}

/** Logistic regression by plain gradient descent on standardised features. */
export function trainLogistic(rows: number[][], y: number[]): number[] {
  const d = rows[0].length;
  const mu = new Array(d).fill(0);
  const sd = new Array(d).fill(0);
  for (const r of rows) r.forEach((v, j) => (mu[j] += v / rows.length));
  for (const r of rows) r.forEach((v, j) => (sd[j] += (v - mu[j]) ** 2 / rows.length));
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const w = new Array(d + 1).fill(0);
  for (let epoch = 0; epoch < 300; epoch++) {
    const g = new Array(d + 1).fill(0);
    rows.forEach((r, k) => {
      let z = w[0];
      for (let j = 0; j < d; j++) z += w[j + 1] * ((r[j] - mu[j]) / sd[j]);
      const e = 1 / (1 + Math.exp(-z)) - y[k];
      g[0] += e;
      for (let j = 0; j < d; j++) g[j + 1] += e * ((r[j] - mu[j]) / sd[j]);
    });
    for (let j = 0; j <= d; j++) w[j] -= (0.5 * g[j]) / rows.length;
  }
  // Fold the standardisation into the weights.
  const out = [w[0]];
  for (let j = 0; j < d; j++) {
    out[0] -= (w[j + 1] * mu[j]) / sd[j];
    out.push(w[j + 1] / sd[j]);
  }
  return out;
}

