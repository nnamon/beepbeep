// Finding the tone with nothing pinned (the default). A laptop microphone's
// room rumble is louder than the sidetone near the bottom of the search band;
// the search must take the keyed tone, at whatever pitch it is, not the rumble.

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Detector } from './detector';
import { rumble } from './roomnoise';
import { Decoder, isGlitch } from '../decoder/decoder';
import { applyEvents, outputsToText } from '../decoder/pipeline';
import { renderText } from '../morse/render';
import { readWav } from '../util/wav';
import { cer } from '../util/text';

/** Detector and decoder over a whole recording, as the app runs them. */
function decode(samples: Float32Array, fs: number, pinnedHz: number | null, wpm: number) {
  const det = new Detector(fs, { pinnedHz, dit: 1.2 / wpm });
  const dec = new Decoder({ initialWpm: wpm });
  const marks: { start: number; end: number }[] = [];
  let down: number | null = null;
  for (let i = 0; i < samples.length; i += 128) {
    const events = det.process(samples.subarray(i, Math.min(samples.length, i + 128)));
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
  return { text: marks.length ? outputsToText(Decoder.redecode(dec.model(), marks)) : '', pitch: det.pitch };
}

const FS = 48000;
const letters = (s: string) => s.replace(/ /g, '');

describe('pitch search with nothing pinned', () => {
  // Rumble rising below the band, or a broad hump in its lower part, at 10 dB
  // swells; tones from 400 to 1000 Hz keyed over it. Before: 0 of 40 found the
  // tone (all locked at 300 to 350 Hz).
  it('finds the keyed tone under room rumble at any pitch', () => {
    const TEXT = 'CQ CQ DE 9V1XX K';
    const wrong: string[] = [];
    for (const [shape, hz] of [['slope', 400], ['slope', 250], ['hump', 350], ['hump', 500]] as const) {
      for (const pitch of [400, 550, 700, 850, 1000]) {
        for (const seed of [1, 2]) {
          const { samples } = renderText(TEXT, { sampleRate: FS, pitch, amplitude: 0.1, charWpm: 14, seed });
          const x = new Float32Array(samples.length + FS);
          x.set(samples, FS / 2);
          const room = rumble(x.length / FS, FS, shape, hz, 0.1, seed + 7);
          for (let i = 0; i < x.length; i++) x[i] += room[i];
          const found = decode(x, FS, null, 14);
          // Where the rumble covers the tone's own pitch, a pin reads it no
          // better: the reading is compared only where the pin reads the over.
          const pinned = decode(x, FS, pitch, 14);
          const pinnedErr = cer(TEXT, pinned.text);
          const ok = found.pitch !== null && Math.abs(found.pitch - pitch) < 15 && (pinnedErr > 0.2 || cer(TEXT, found.text) <= pinnedErr + 0.15);
          if (!ok) wrong.push(`${shape} ${hz} Hz, tone ${pitch}, seed ${seed}: found ${found.pitch?.toFixed(0)} Hz "${found.text}", pinned "${pinned.text}"`);
        }
      }
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
  });

  // A pin set while keying (from Setup, or a lock that comes late) used to
  // measure its noise floor in the first 45 ms, inside a dah, and then heard
  // nothing until the floor had come down, seconds later.
  it('hears the keying straight after a pin set in the middle of a dah', () => {
    const TEXT = 'CQ CQ DE 9V1XX 9V1XX K';
    for (const pitch of [500, 750]) {
      const { samples, schedule } = renderText(TEXT, { sampleRate: FS, pitch, amplitude: 0.1, charWpm: 15, seed: 4, noise: { snrDb: 25 } });
      // Halfway through the first dah of the second CQ.
      const dah = schedule.marks[8];
      const at = Math.round(((dah.start + dah.end) / 2) * FS);
      const det = new Detector(FS, { dit: 0.08 });
      let downs = 0;
      for (let i = 0; i < samples.length; i += 128) {
        if (i <= at && at < i + 128) det.setPinned(pitch);
        for (const e of det.process(samples.subarray(i, i + 128))) if (e.type === 'key' && e.down && e.t > dah.end + 0.05) downs++;
      }
      // Every mark after that dah is heard.
      expect(downs, `${pitch} Hz`).toBe(schedule.marks.length - 9);
    }
  });

  it('locks onto nothing in rumble alone', () => {
    for (const [shape, hz] of [['slope', 400], ['hump', 350]] as const) {
      const r = decode(rumble(20, FS, shape, hz, 0.1, 3), FS, null, 14);
      expect(r.pitch, `${shape} ${hz}`).toBe(null);
      expect(r.text).toBe('');
    }
  });

  // The owner's recordings (samples/, not in the repository; skipped without
  // them). Every keying take that reads well with the pin used when it was
  // recorded must read about as well with nothing pinned. Before: none did
  // (CQ CQ DE as E, VVV VVV as nothing, locks at 287 to 350 Hz).
  const DIR = 'samples';
  const names = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.startsWith('20') && f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : [];
  if (!names.length) it.skip('recordings: none in samples/', () => {});
  else
    it('reads the recorded keying takes as well as with the pin', () => {
      const labels: Record<string, string | null> = existsSync(`${DIR}/labels.json`) ? JSON.parse(readFileSync(`${DIR}/labels.json`, 'utf8')) : {};
      const wrong: string[] = [];
      let checked = 0;
      let foundTotal = 0;
      let pinnedTotal = 0;
      for (const n of names) {
        const meta = JSON.parse(readFileSync(`${DIR}/${n}.json`, 'utf8'));
        const keyed = n in labels ? labels[n] : meta.keyed || null;
        if (meta.kind === 'noise' || !keyed || !meta.settings.pinnedHz) continue;
        const { samples, sampleRate } = readWav(readFileSync(`${DIR}/${n}.wav`));
        const wpm = meta.settings.sendWpm || 15;
        const pinned = decode(samples, sampleRate, meta.settings.pinnedHz, wpm);
        const pinnedErr = cer(letters(keyed), letters(pinned.text));
        if (pinnedErr > 0.2) continue;
        checked++;
        const found = decode(samples, sampleRate, null, wpm);
        const err = cer(letters(keyed), letters(found.text));
        foundTotal += err;
        pinnedTotal += pinnedErr;
        // One letter's slack in an over (CQ CQ DE has six).
        if (found.pitch === null || Math.abs(found.pitch - meta.settings.pinnedHz) > 15 || err > pinnedErr + 0.2) {
          wrong.push(`${n}: found ${found.pitch?.toFixed(0)} Hz "${found.text}" (${(err * 100).toFixed(0)}%), pinned "${pinned.text}" (${(pinnedErr * 100).toFixed(0)}%)`);
        }
      }
      expect(wrong, wrong.join('\n')).toEqual([]);
      expect(checked).toBeGreaterThan(0);
      expect(foundTotal, 'letter error summed over the takes').toBeLessThanOrEqual(pinnedTotal + 1e-9);
    });
});

// A pin set off the tone: a buzzer or oscillator tens of hertz from the
// pitch the user entered. Before: 30 Hz off or more, the lock-in heard
// nothing and nothing was decoded; 10 to 25 Hz off, the first letter was lost.
describe('a pin off the tone', () => {
  const letterErr = (want: string, got: string) => cer(letters(want), letters(got));

  it('moves to the keyed tone and reads the whole over', () => {
    const TEXT = 'CQ CQ DE 9V1XX K';
    const wrong: string[] = [];
    for (const pitch of [500, 700]) {
      const { samples } = renderText(TEXT, { sampleRate: FS, pitch, amplitude: 0.1, charWpm: 15, seed: 3, noise: { snrDb: 10 } });
      const x = new Float32Array(samples.length + FS);
      x.set(samples, FS / 2);
      for (const off of [-50, -40, -25, -15, 15, 25, 40, 50]) {
        const r = decode(x, FS, pitch + off, 15);
        const err = letterErr(TEXT, r.text);
        if (err > 0 || r.pitch === null || Math.abs(r.pitch - pitch) > 8) wrong.push(`tone ${pitch}, pin ${pitch + off}: "${r.text}" at ${r.pitch?.toFixed(0)} Hz`);
      }
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
  });

  // The owner's keying takes (pinned at 600 Hz when recorded, the tone near
  // it), pinned 25 to 50 Hz off instead. Before: every take read nothing at
  // 40 and 50 Hz off. Now (12 Oct 2026, 13 takes, 78 readings) every reading
  // has letters, the mean letter error is 8.4% against 4.1% with the right
  // pin, and 11 of the 13 takes read within a letter of the right pin at every
  // offset. The two that do not have typing over a quiet sidetone (67% and,
  // at one offset, 129%, against 14 to 17%).
  const DIR = 'samples';
  const names = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.startsWith('20') && f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : [];
  if (!names.length) it.skip('recordings: none in samples/', () => {});
  else
    it('reads the recorded keying takes with the pin 25 to 50 Hz off', () => {
      const labels: Record<string, string | null> = existsSync(`${DIR}/labels.json`) ? JSON.parse(readFileSync(`${DIR}/labels.json`, 'utf8')) : {};
      const silent: string[] = [];
      const behind: string[] = [];
      let takes = 0;
      let rightSum = 0;
      let offSum = 0;
      let readings = 0;
      for (const n of names) {
        const meta = JSON.parse(readFileSync(`${DIR}/${n}.json`, 'utf8'));
        const keyed = n in labels ? labels[n] : meta.keyed || null;
        if (meta.kind === 'noise' || !keyed || !meta.settings.pinnedHz) continue;
        const { samples, sampleRate } = readWav(readFileSync(`${DIR}/${n}.wav`));
        const wpm = meta.settings.sendWpm || 15;
        const right = letterErr(keyed, decode(samples, sampleRate, meta.settings.pinnedHz, wpm).text);
        if (right > 0.2) continue;
        takes++;
        rightSum += right;
        let worst = 0;
        for (const off of [-50, -40, -25, 25, 40, 50]) {
          const r = decode(samples, sampleRate, meta.settings.pinnedHz + off, wpm);
          const err = letterErr(keyed, r.text);
          readings++;
          offSum += err;
          worst = Math.max(worst, err);
          if (!letters(r.text)) silent.push(`${n}, pin ${meta.settings.pinnedHz + off}`);
        }
        // One letter's slack in an over.
        if (worst > right + 0.2) behind.push(`${n}: worst ${(worst * 100).toFixed(0)}%, right pin ${(right * 100).toFixed(0)}%`);
      }
      expect(takes).toBeGreaterThan(0);
      expect(silent, silent.join('\n')).toEqual([]);
      expect(offSum / readings, 'mean letter error, pin off').toBeLessThanOrEqual(rightSum / takes + 0.06);
      expect(behind.length, behind.join('\n')).toBeLessThanOrEqual(Math.floor(takes * 0.2));
    });
});
