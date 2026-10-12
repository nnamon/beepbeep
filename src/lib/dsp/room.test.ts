// A laptop microphone in a room: typing, a fan and talking around the key.
// Room sounds alone must key nothing (or, for speech, little); a tone keyed
// over them must still decode.

import { describe, expect, it } from 'vitest';
import { Detector } from './detector';
import { roomNoise, mix, type RoomSound } from './roomnoise';
import { Decoder, isGlitch } from '../decoder/decoder';
import { applyEvents, outputsToText } from '../decoder/pipeline';
import { renderText } from '../morse/render';
import { cer } from '../util/text';

const FS = 48000;
const dbfs = (x: number) => Math.pow(10, x / 20);

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
        if (!isGlitch(e.t - down, dec.ditEstimate)) marks.push({ start: down, end: e.t });
        down = null;
      }
    }
    applyEvents(dec, events);
    dec.tick(det.time);
    det.setDit(dec.ditEstimate);
  }
  return marks.length ? outputsToText(Decoder.redecode(dec.model(), marks)) : '';
}

const letters = (s: string) => s.replace(/ /g, '').length;

// Letters keyed by 80 s of each sound (two takes, searching and pinned), measured
// on 11 Oct 2026, with what the detector keyed before it watched the room.
describe('room sounds alone', () => {
  const keyed = (kind: RoomSound) => {
    let n = 0;
    for (const seed of [1, 2]) for (const pinned of [null, 600]) n += letters(decode(roomNoise(kind, 20, FS, dbfs(-30), seed), pinned));
    return n;
  };
  // Before: 30. Now none.
  it('a fan keys nothing', () => expect(keyed('fan')).toBe(0));
  // Before: none. Now none.
  it('typing keys nothing', () => expect(keyed('typing')).toBe(0));
  // Voiced speech puts harmonics on the tone itself, the hardest room sound:
  // pitch steadiness and each mark's pitch catch most of it. Before: 58. Now 5.
  it('speech keys a few stray letters at most', () => expect(keyed('speech')).toBeLessThanOrEqual(8));
});

describe('a tone over room sounds', () => {
  const TEXT = 'CQ CQ DE 9V1XX 9V1XX K';
  for (const kind of ['typing', 'fan', 'speech'] as RoomSound[]) {
    it(kind, () => {
      let err = 0;
      for (const seed of [1, 2]) {
        const { samples } = renderText(TEXT, { sampleRate: FS, pitch: 600, amplitude: dbfs(-20), charWpm: 15, seed });
        const tone = new Float32Array(samples.length + 2 * FS);
        tone.set(samples, FS);
        err += cer(TEXT, decode(mix(tone, roomNoise(kind, tone.length / FS, FS, dbfs(-40), seed + 10)), null));
      }
      expect(err / 2).toBeLessThanOrEqual(kind === 'speech' ? 0.1 : 0.03);
    });
  }
});

// Talking near the microphone while keying, or while not keying at all. The
// keyed CQ under speech 20 and 13 dB below it, at two pitches, six takes each;
// and two minutes of speech alone at two levels, searching and pinned.
describe('speech near the microphone', () => {
  // Before (12 Oct 2026): 0 of 24 exact, mean letter error 9.1%. Now 17 of
  // 24, 4.4%: the search waits for a pitch that holds, the first marks must
  // hold their pitch from one half to the other, and one blip from the room
  // no longer seeds the dit.
  it('reads a tone keyed under speech', () => {
    const TEXT = 'CQ CQ DE 9V1XX 9V1XX K';
    let exact = 0;
    let err = 0;
    for (const roomDb of [-40, -33]) {
      for (const pitch of [600, 800]) {
        for (const seed of [1, 2, 3, 4, 5, 6]) {
          const { samples } = renderText(TEXT, { sampleRate: FS, pitch, amplitude: dbfs(-20), charWpm: 15, seed });
          const tone = new Float32Array(samples.length + 2 * FS);
          tone.set(samples, FS);
          const got = decode(mix(tone, roomNoise('speech', tone.length / FS, FS, dbfs(roomDb), seed + 10)), null);
          exact += got === TEXT ? 1 : 0;
          err += cer(TEXT, got);
        }
      }
    }
    expect(exact).toBeGreaterThanOrEqual(15);
    expect(err / 24).toBeLessThanOrEqual(0.055);
  });

  // Before: 40 letters in 8 minutes. Now 30.
  it('keys fewer stray letters from speech alone', () => {
    let n = 0;
    for (const level of [-30, -20]) {
      for (const pinned of [null, 600]) {
        for (const seed of [1, 2, 3, 4, 5, 6]) n += letters(decode(roomNoise('speech', 20, FS, dbfs(level), seed), pinned));
      }
    }
    expect(n).toBeLessThanOrEqual(33);
  });
});
