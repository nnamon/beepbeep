// The band generator: the truth matches what was keyed, levels and SNR are
// what was asked for, and every scenario is a usable clip.

import { describe, expect, it } from 'vitest';
import { REF_AMP, keyedText, qso, renderBand, type Band } from './band';
import { SCENARIOS } from './scenarios';
import { patternOf, tokenize } from '../morse/code';
import { FFT, hann } from '../dsp/fft';

const FS = 48000;

/** Mean power per bin (periodogram, Hann window) of `x`, frames of `size`. */
function spectrum(x: Float32Array, size = 4096): Float64Array {
  const fft = new FFT(size);
  const w = hann(size);
  const p = new Float64Array(size / 2);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let frames = 0;
  for (let a = 0; a + size <= x.length; a += size) {
    for (let i = 0; i < size; i++) {
      re[i] = x[a + i] * w[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    for (let k = 0; k < size / 2; k++) p[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  // Scale so the bins sum to the signal's power (Parseval, with the window's power).
  let ww = 0;
  for (const v of w) ww += v * v;
  for (let k = 0; k < p.length; k++) p[k] = (2 * p[k]) / (frames * size * ww);
  return p;
}

/** Power of `x` between lo and hi Hz. */
function bandPower(x: Float32Array, lo: number, hi: number): number {
  const p = spectrum(x);
  const binHz = FS / 4096;
  let sum = 0;
  for (let k = Math.ceil(lo / binHz); k <= Math.floor(hi / binHz); k++) sum += p[k];
  return sum;
}

describe('band audio', () => {
  it('keys the truth: one mark per element, in order, from the text as sent', () => {
    const band: Band = {
      stations: [
        { name: 'A', pitch: 600, wpm: 20, sends: [{ text: 'cq de 9v1xx = k', at: 0.5 }] },
        { name: 'B', pitch: 900, wpm: 14, keying: 'straight', sends: [{ text: 'TNX FER CALL', at: 1 }, { text: '73 <SK>', at: 14 }] },
        { name: 'C', pitch: 1100, wpm: 24, keying: 'bug', sends: [{ text: 'UR RST 579', at: 2 }] },
      ],
      seed: 3,
    };
    const { truth, seconds } = renderBand(band, FS);
    expect(truth.map((t) => t.text)).toEqual(['CQ DE 9V1XX <BT> K', 'TNX FER CALL 73 <SK>', 'UR RST 579']);
    for (const t of truth) {
      const elements = tokenize(t.text).filter((x) => x !== ' ').reduce((n, x) => n + patternOf(x)!.length, 0);
      expect(t.marks.length).toBe(elements);
      t.marks.forEach((m, i) => {
        expect(m.end).toBeGreaterThan(m.start);
        if (i) expect(m.start).toBeGreaterThan(t.marks[i - 1].end);
      });
      expect(t.sends[0].start).toBe(t.marks[0].start);
      expect(t.sends[t.sends.length - 1].end).toBe(t.marks[t.marks.length - 1].end);
    }
    expect(truth[0].marks[0].start).toBeCloseTo(0.5, 9);
    expect(truth[1].sends[1].start).toBeCloseTo(14, 9);
    expect(seconds).toBeCloseTo(Math.max(...truth.map((t) => t.marks[t.marks.length - 1].end)) + 1.5, 9);
  });

  it('machine keying is exact: dits of 60 ms at 20 wpm, dahs three times as long', () => {
    const { truth } = renderBand({ stations: [{ name: 'A', pitch: 600, wpm: 20, sends: [{ text: 'K', at: 1 }] }] }, FS);
    const lengths = truth[0].marks.map((m) => m.end - m.start);
    expect(lengths[0]).toBeCloseTo(0.18, 9);
    expect(lengths[1]).toBeCloseTo(0.06, 9);
    expect(lengths[2]).toBeCloseTo(0.18, 9);
  });

  it('a bug times its dits by machine and its dahs by hand; a straight key times both by hand', () => {
    const text = 'PARIS SEES THE TEST PATTERN ON THE OLD MOTOR';
    const spread = (v: number[]) => {
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) / mean;
    };
    const lengths = (keying: 'bug' | 'straight') => {
      const { truth } = renderBand({ stations: [{ name: 'A', pitch: 600, wpm: 20, keying, sends: [{ text, at: 0.5 }] }], seed: 4 }, FS);
      const all = truth[0].marks.map((m) => m.end - m.start);
      // Dits and dahs apart: the boundary between them sits at twice a dit.
      return { dits: all.filter((d) => d < 0.12), dahs: all.filter((d) => d >= 0.12) };
    };
    const bug = lengths('bug');
    expect(spread(bug.dits)).toBeLessThan(0.03);
    expect(spread(bug.dahs)).toBeGreaterThan(0.03);
    const hand = lengths('straight');
    expect(spread(hand.dits)).toBeGreaterThan(0.05);
    expect(() => renderBand({ stations: [{ name: 'A', pitch: 600, wpm: 18, overallWpm: 10, keying: 'straight', sends: [{ text, at: 0.5 }] }] }, FS)).toThrow();
  });

  it('a drifting station gives the range of pitches it sends on', () => {
    const { truth } = renderBand({ stations: [{ name: 'A', pitch: 700, wpm: 20, driftHzPerMin: -6, sends: [{ text: 'CQ CQ DE EI7HDK K', at: 30 }] }] }, FS);
    const [first, last] = [truth[0].marks[0].start, truth[0].marks[truth[0].marks.length - 1].end];
    expect(truth[0].pitchRange[0]).toBeCloseTo(700 - (6 * last) / 60, 9);
    expect(truth[0].pitchRange[1]).toBeCloseTo(700 - (6 * first) / 60, 9);
  });

  it('is the same on every run', () => {
    const band = SCENARIOS.find((s) => s.name === 'heavy QRN')!.band;
    const a = renderBand(band, FS).samples;
    const b = renderBand(band, FS).samples;
    expect(a.length).toBe(b.length);
    expect(a.every((x, i) => x === b[i])).toBe(true);
  });

  it('sets the level and the noise SNR in 500 Hz against the reference station', () => {
    const stations = [
      { name: 'loud', pitch: 600, wpm: 20, sends: [{ text: 'TTTTT', at: 0.5 }] },
      { name: 'ref', pitch: 1000, wpm: 20, levelDb: -12, sends: [{ text: 'TTTTT', at: 0.5 }] },
    ];
    const clean = renderBand({ stations, seconds: 8 }, FS).samples;
    let peak = 0;
    for (const x of clean) peak = Math.max(peak, Math.abs(x));
    // Both stations' peaks add at most.
    expect(peak).toBeLessThanOrEqual(REF_AMP * (1 + Math.pow(10, -12 / 20)) + 1e-6);
    for (const snrDb of [0, 10]) {
      const noisy = renderBand({ stations, seconds: 8, ref: 'ref', noise: { snrDb } }, FS).samples;
      const noise = noisy.map((x, i) => x - clean[i]);
      const ps = Math.pow(REF_AMP * Math.pow(10, -12 / 20), 2) / 2;
      const pn = bandPower(noise, 1000 - 250, 1000 + 250);
      expect(10 * Math.log10(ps / pn)).toBeCloseTo(snrDb, 0);
    }
  });

  it('the receiver filter passes its band and cuts outside it', () => {
    const band = { stations: [], seconds: 6, noise: { snrDb: 0 }, passband: [400, 900] as [number, number] };
    const x = renderBand(band, FS).samples;
    const inside = bandPower(x, 550, 750) / 200;
    expect(10 * Math.log10(bandPower(x, 1800, 2000) / 200 / inside)).toBeLessThan(-20);
    expect(10 * Math.log10(bandPower(x, 150, 200) / 50 / inside)).toBeLessThan(-20);
  });

  it('a QSO takes turns, each answer 0.5 to 2 seconds after the last over', () => {
    const [a, b] = qso({ name: 'A', pitch: 700, wpm: 18 }, { name: 'B', pitch: 720, wpm: 26, levelDb: -15 }, ['CQ DE A K', 'A DE B K', 'B DE A 5NN K', 'A DE B 5NN TU'], 1, 5);
    const { truth } = renderBand({ stations: [a, b] }, FS);
    const overs = [...truth[0].sends, ...truth[1].sends].sort((x, y) => x.start - y.start);
    expect(overs.map((o) => o.text)).toEqual(['CQ DE A K', 'A DE B K', 'B DE A 5NN K', 'A DE B 5NN TU']);
    for (let i = 1; i < overs.length; i++) {
      const pause = overs[i].start - overs[i - 1].end;
      expect(pause).toBeGreaterThanOrEqual(0.5);
      expect(pause).toBeLessThanOrEqual(2);
    }
  });
});

describe('scenarios', () => {
  const rows: string[] = [];
  it('are 20 to 90 seconds, inside 300 to 1200 Hz, with no clipping and at least 15 of them', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(SCENARIOS.map((s) => s.name)).size).toBe(SCENARIOS.length);
    const rendered = SCENARIOS.map((s) => ({ s, r: renderBand(s.band, FS) }));
    for (const { s, r } of rendered) {
      rows.push(`${s.name.padEnd(22)} ${r.seconds.toFixed(1).padStart(5)} s  ${r.truth.map((t) => `${t.name} ${t.pitch} Hz ${t.wpm} wpm ${t.text.length} chars`).join(', ')}`);
    }
    console.log(`\nRadio scenarios\n${rows.join('\n')}\n`);
    for (const { s, r } of rendered) {
      expect(r.seconds, s.name).toBeGreaterThanOrEqual(20);
      expect(r.seconds, s.name).toBeLessThanOrEqual(90);
      expect(r.clipped, s.name).toBe(0);
      for (const t of r.truth) {
        expect(t.pitchRange[0]).toBeGreaterThanOrEqual(300);
        expect(t.pitchRange[1]).toBeLessThanOrEqual(1200);
        expect(t.text).toBe(keyedText(t.text));
      }
    }
  });
});
