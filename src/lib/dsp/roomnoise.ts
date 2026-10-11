// Synthetic room sounds for detector tests: what a laptop microphone hears
// besides the key. Typing (sharp broadband clicks), speech (voiced syllables
// with a moving pitch and their harmonics) and a fan (broadband rumble with
// mains hum).

import { gaussian, mulberry32 } from '../util/random';

export type RoomSound = 'typing' | 'speech' | 'fan';

/** `level` is the RMS of the sound while it is present, relative to full scale. */
export function roomNoise(kind: RoomSound, seconds: number, fs: number, level: number, seed = 1): Float32Array {
  const rng = mulberry32(seed);
  const n = Math.round(seconds * fs);
  const out = new Float32Array(n);
  if (kind === 'typing') {
    // Key presses 80-350 ms apart, each a click and a short body resonance.
    for (let t = 0.05 + rng() * 0.2; t < seconds; t += 0.08 + rng() * 0.27) {
      const at = Math.floor(t * fs);
      const len = Math.floor((0.004 + rng() * 0.012) * fs);
      const f = 1500 + rng() * 2500;
      const amp = level * 4 * (0.4 + rng());
      for (let i = 0; i < len && at + i < n; i++) {
        const e = Math.exp((-6 * i) / len);
        out[at + i] += amp * e * (0.6 * gaussian(rng) + 0.4 * Math.sin((2 * Math.PI * f * i) / fs));
      }
    }
  } else if (kind === 'speech') {
    // Syllables of 120-320 ms, with pauses; pitch glides; harmonics shaped by two formants.
    let t = rng() * 0.3;
    while (t < seconds) {
      const dur = 0.12 + rng() * 0.2;
      const f0a = 95 + rng() * 130;
      const f0b = f0a * (0.85 + rng() * 0.3);
      const f1 = 300 + rng() * 600;
      const f2 = 900 + rng() * 1500;
      const a = Math.floor(t * fs);
      const len = Math.floor(dur * fs);
      let phase = 0;
      for (let i = 0; i < len && a + i < n; i++) {
        const u = i / len;
        const f0 = f0a + (f0b - f0a) * u;
        phase += (2 * Math.PI * f0) / fs;
        const env = Math.sin(Math.PI * u) ** 0.6;
        let s = 0;
        for (let h = 1; h * f0 < 3500; h++) {
          const fh = h * f0;
          const g = 1 / (1 + ((fh - f1) / 120) ** 2) + 0.6 / (1 + ((fh - f2) / 200) ** 2) + 0.05;
          s += g * Math.sin(h * phase);
        }
        out[a + i] += level * 0.9 * env * s;
      }
      t += dur + (rng() < 0.3 ? 0.25 + rng() * 0.5 : 0.02 + rng() * 0.08);
    }
  } else {
    // Brownish rumble, hum at 50 Hz and its harmonics, a little hiss.
    let b = 0;
    for (let i = 0; i < n; i++) {
      b = 0.995 * b + 0.1 * gaussian(rng);
      const hum = Math.sin((2 * Math.PI * 50 * i) / fs) + 0.5 * Math.sin((2 * Math.PI * 100 * i) / fs) + 0.25 * Math.sin((2 * Math.PI * 150 * i) / fs);
      out[i] = level * (0.8 * b + 0.5 * hum + 0.3 * gaussian(rng));
    }
  }
  // Scale so the RMS over the parts where the sound is present is `level`.
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (out[i] !== 0) {
      sum += out[i] * out[i];
      count++;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, count));
  if (rms > 0) for (let i = 0; i < n; i++) out[i] *= level / rms;
  return out;
}

export function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, (a[i] ?? 0) + (b[i] ?? 0)));
  return out;
}
