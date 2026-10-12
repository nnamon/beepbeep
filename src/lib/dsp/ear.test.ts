// The second ear: a buzzer or square-wave oscillator has a strong third
// harmonic, and once the detector has heard it on the sender's marks it
// listens there too. A voice covers the fundamental far more than the
// harmonic, so the second ear keeps the key readable under talking.

import { describe, expect, it } from 'vitest';
import { Detector } from './detector';
import { LowPass } from './biquad';
import { roomNoise } from './roomnoise';
import { Decoder, isGlitch, isHeld } from '../decoder/decoder';
import { applyEvents, outputsToText } from '../decoder/pipeline';
import { buildSchedule, type Schedule } from '../morse/schedule';
import { renderSchedule } from '../morse/render';
import { gaussian, mulberry32 } from '../util/random';
import { cer } from '../util/text';

const FS = 48000;
const dbfs = (x: number) => Math.pow(10, x / 20);
const TEXT = 'VVV CQ CQ DE 9V1XX 9V1XX K';

function decode(samples: Float32Array, pinnedHz: number | null): string {
  const det = new Detector(FS, { pinnedHz, dit: 0.08 });
  const dec = new Decoder({ initialWpm: 15 });
  const marks: { start: number; end: number }[] = [];
  let down: number | null = null;
  for (let i = 0; i < samples.length; i += 128) {
    const events = det.process(samples.subarray(i, i + 128));
    for (const e of events) {
      if (e.type !== 'key') continue;
      if (e.down) down = e.t;
      else if (down !== null) {
        if (!isGlitch(e.t - down, dec.ditEstimate) && !isHeld(e.t - down, dec.dahEstimate)) marks.push({ start: down, end: e.t });
        down = null;
      }
    }
    applyEvents(dec, events);
    dec.tick(det.time);
    det.setDit(dec.ditEstimate);
  }
  return marks.length ? outputsToText(Decoder.redecode(dec.model(), marks)) : '';
}

/** The keyed tone at `pitch` with its third harmonic 6 dB under it, as a buzzer has. */
function buzzer(s: Schedule, pitch: number): Float32Array {
  const x = renderSchedule(s, { sampleRate: FS, pitch, amplitude: dbfs(-20) });
  const h = renderSchedule(s, { sampleRate: FS, pitch: 3 * pitch, amplitude: dbfs(-26) });
  for (let i = 0; i < x.length; i++) x[i] += h[i];
  return x;
}

/**
 * VVV in a quiet room (the detector learns the tone and its harmonic), then
 * the rest keyed while someone talks near the microphone, 18 dB under the
 * tone. The voice is cut above 900 Hz: it covers the fundamental and leaves
 * the harmonic, which is what a talker does to a 600 Hz tone's 1800 Hz harmonic
 * in the owner's recordings.
 */
function underTalking(pitch: number, seed: number): Float32Array {
  const s = buildSchedule(TEXT, { charWpm: 15, fist: { jitter: 0.08, seed }, leadIn: 1, tail: 1 });
  const x = buzzer(s, pitch);
  const from = Math.floor(s.marks[9].start * FS);
  const voice = roomNoise('speech', s.duration, FS, dbfs(-18), seed + 30);
  const lp = [0.5412, 1.3066, 0.5412, 1.3066].map((q) => new LowPass(FS, 900, q));
  const rng = mulberry32(seed + 99);
  for (let i = 0; i < x.length; i++) {
    let v = voice[i];
    for (const f of lp) v = f.step(v);
    x[i] += (i >= from ? v : 0) + 1e-4 * gaussian(rng);
  }
  return x;
}

const letterError = (got: string) => cer(TEXT.replace(/ /g, ''), got.replace(/ /g, ''));
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const SEEDS = [1, 2, 3, 4];
/** Mean letter error under talking, pinned at 600 Hz, the tone at `pitch`. */
const errors = new Map<number, number>();
function talkingError(pitch: number): number {
  if (!errors.has(pitch)) errors.set(pitch, mean(SEEDS.map((seed) => letterError(decode(underTalking(pitch, seed), 600)))));
  return errors.get(pitch)!;
}

describe('the second ear', () => {
  // The fundamental withdraws a mark when a voice pulls its pitch or level off;
  // the harmonic heard the same mark cleanly. Before (12 Oct 2026), the second
  // ear was ignored whenever the fundamental was deciding, and such marks were
  // lost: 58.8% letter error over the four takes. Now its mark stands: 28.7%.
  it('keeps a mark the fundamental withdrew when the harmonic heard it', () => {
    expect(talkingError(600)).toBeLessThanOrEqual(0.4);
  }, 120_000);

  // The offset the detector learns is the lock minus the tone. The second ear
  // started at three times the lock plus the offset, 6 offsets from the
  // harmonic: 30 Hz off for a tone 5 Hz off the pin, where it heard nothing.
  // Before (with the change above): 73.8% (595 Hz) and 77.5% (605 Hz) letter
  // error, against 28.7% with the tone at the pin. Now 32.5% and 37.5%.
  it('listens at the tone’s harmonic when the tone is a few hertz off the pin', () => {
    for (const pitch of [595, 605]) expect(talkingError(pitch), `tone at ${pitch} Hz, pinned at 600`).toBeLessThanOrEqual(talkingError(600) + 0.15);
  }, 120_000);

  // Silence at the fundamental means nothing covers it, whatever the bands
  // beside it hear. The second ear counted wherever the room was loud, or the
  // fundamental's own noise rose 6 dB for a moment (in a 50 Hz band it swings
  // about 8 dB around its floor), so a beep at the harmonic's pitch with a hum
  // on either side of the tone and nothing on it keyed a letter in the gaps.
  // A key's release thump did the same in a quiet room (154311: the
  // fundamental 1.5 to 4.5 dB over its floor, the room 6 to 8 dB). Before: 12
  // of 12 beeps keyed a letter. Now none.
  it('ignores a beep at the harmonic while the fundamental hears nothing', () => {
    const want = 'CQ CQ DE 9V1XX K';
    let beeps = 0;
    let keyed = 0;
    for (const seed of [1, 2, 3]) {
      const s = buildSchedule(want, { charWpm: 15, fist: { jitter: 0.08, seed }, leadIn: 1, tail: 1 });
      const x = buzzer(s, 600);
      // In every gap between words: a hum at 400 and 800 Hz for 0.3 s, and a 100 ms beep at 1800 Hz in it.
      for (let k = 1; k < s.marks.length; k++) {
        if (s.marks[k].start - s.marks[k - 1].end < 0.4) continue;
        const mid = (s.marks[k - 1].end + s.marks[k].start) / 2;
        const a = Math.floor((mid - 0.15) * FS);
        for (let i = 0; i < 0.3 * FS; i++) {
          const t = (a + i) / FS;
          x[a + i] += dbfs(-64) * Math.sin((Math.PI * i) / (0.3 * FS)) * (Math.sin(2 * Math.PI * 400 * t) + Math.sin(2 * Math.PI * 800 * t));
          const fromMid = Math.abs(t - mid);
          if (fromMid < 0.05) x[a + i] += dbfs(-26) * Math.min(1, (0.05 - fromMid) / 0.005) * Math.sin(2 * Math.PI * 1800 * t);
        }
        beeps++;
      }
      // A laptop's room noise, 40 dB under the tone.
      const rng = mulberry32(seed + 5);
      for (let i = 0; i < x.length; i++) x[i] += 1e-3 * gaussian(rng);
      keyed += decode(x, 600).replace(/ /g, '').length - want.replace(/ /g, '').length;
    }
    expect(beeps).toBe(12);
    expect(keyed).toBe(0);
  }, 60_000);

  // In a quiet room the harmonic's band is quieter than the fundamental's and
  // can ring on after key-up, 10 to 14 dB down for 50 to 90 ms (the owner's
  // oscillator on a laptop, take 154311). The second ear ended its mark there
  // and started a new one on the ringing: on its own, 94 extra marks for 126
  // keyed (12 dB down for 50 ms). Joined with the fundamental, one became a dit
  // after a dah (CQ CQ DE read as CQ CQ BE). Now none, and no mark lost.
  it('does not start a mark on the harmonic ringing on after key-up', () => {
    let extra = 0;
    let lost = 0;
    for (const seed of [1, 2, 3]) {
      const s = buildSchedule('CQ CQ DE 9V1XX', { charWpm: 15, fist: { jitter: 0.08, seed }, leadIn: 1, tail: 1 });
      const amp = dbfs(-26);
      const x = renderSchedule(s, { sampleRate: FS, pitch: 1800, amplitude: amp });
      for (const m of s.marks) {
        const a = Math.floor(m.end * FS);
        for (let i = 0; i < Math.floor(0.08 * FS) && a + i < x.length; i++) {
          const t = i / FS;
          const g = Math.min(1, t / 0.004) * (t < 0.05 ? 1 : Math.exp(-(t - 0.05) / 0.008));
          x[a + i] += amp * dbfs(-12) * g * Math.sin((2 * Math.PI * 1800 * (a + i)) / FS);
        }
      }
      const rng = mulberry32(seed);
      for (let i = 0; i < x.length; i++) x[i] += dbfs(-85) * gaussian(rng);
      // The second ear on its own: pinned at the harmonic, no search.
      const ear = new Detector(FS, { pinnedHz: 1800, dit: 0.08, overtone: true });
      const got: { start: number; end: number }[] = [];
      let down: number | null = null;
      for (let i = 0; i < x.length; i += 128) {
        for (const e of ear.process(x.subarray(i, i + 128))) {
          if (e.type !== 'key') continue;
          if (e.down) down = e.t;
          else if (down !== null) {
            if (e.t - down > 0.02) got.push({ start: down, end: e.t });
            down = null;
          }
        }
      }
      const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) => Math.min(a.end, b.end) - Math.max(a.start, b.start);
      lost += s.marks.filter((m) => !got.some((g) => overlap(g, m) > 0.5 * (m.end - m.start))).length;
      extra += got.filter((g) => !s.marks.some((m) => overlap(g, m) > 0.5 * (g.end - g.start))).length;
    }
    expect({ extra, lost }).toEqual({ extra: 0, lost: 0 });
  }, 60_000);
});
