// Saved or imported settings are made whole: only the choices the app offers,
// and numbers within the ranges Settings allows.

import { describe, expect, it } from 'vitest';
import { applySettings, settings } from './settings.svelte';

const VALID = {
  theme: 'paper',
  track: 'licw',
  input: 'iambicB',
  voice: 'off',
  sendTolerance: 'loose',
  qsoHelp: 'none',
  qsoInput: 'type',
  stationMix: 'europe',
  licwClass: 'int2',
  charWpm: 25,
  effectiveWpm: 10,
  sendWpm: 18,
  sessionMinutes: 20,
  comfortWpm: 16,
  stretchWpm: 22,
  pitch: 700,
  volume: 0.55,
  noise: 2,
  qsb: 1,
  qrm: 2,
  qrn: 3,
  overTimeout: 2.5,
  ttrDelay: 0.85,
  pinnedHz: 612,
  squelchDb: 14,
};

describe('settings from a file or a hand edit', () => {
  it('keeps every value Settings can set', () => {
    applySettings(VALID);
    expect(settings).toMatchObject(VALID);
    applySettings({ ...VALID, pinnedHz: null, squelchDb: null });
    expect(settings).toMatchObject({ pinnedHz: null, squelchDb: null });
  });

  // Before: unknown words were kept (track "morse", input "keyboard").
  it('keeps only the choices the app offers', () => {
    applySettings({ theme: 'neon', track: 'morse', input: 'keyboard', voice: 'robot', sendTolerance: 'exact', qsoHelp: 'all', qsoInput: 'sing', stationMix: 'mars', licwClass: 'bc9' });
    expect(settings).toMatchObject({ theme: 'system', track: 'koch', input: 'mic', voice: 'builtin', sendTolerance: 'normal', qsoHelp: 'text', qsoInput: 'key', stationMix: 'auto', licwClass: 'bc1' });
  });

  // Before: charWpm 0 and the like were kept, and the Copy drill, TTR, Pocket and Head copy threw when they played.
  it('keeps numbers within the ranges Settings allows', () => {
    applySettings({ charWpm: 0, effectiveWpm: 99, sendWpm: 1000, sessionMinutes: 0, comfortWpm: -5, stretchWpm: 99, pitch: 5, volume: 7, noise: 9, qsb: -1, qrm: 5, qrn: 2.6, overTimeout: 0, ttrDelay: 50, pinnedHz: 50, squelchDb: 400 });
    expect(settings).toMatchObject({ charWpm: 5, effectiveWpm: 5, sendWpm: 45, sessionMinutes: 5, comfortWpm: 5, stretchWpm: 50, pitch: 400, volume: 1, noise: 3, qsb: 0, qrm: 2, qrn: 3, overTimeout: 1.5, ttrDelay: 3, pinnedHz: 300, squelchDb: 20 });
    applySettings({ charWpm: 22.4, effectiveWpm: 2, sessionMinutes: 17, pitch: 655 });
    expect(settings).toMatchObject({ charWpm: 22, effectiveWpm: 3, sessionMinutes: 15, pitch: 660 });
  });

  it('uses the default for a number that is not a number', () => {
    applySettings(JSON.parse('{"charWpm": 1e999, "effectiveWpm": "8", "pitch": null, "volume": true}'));
    expect(settings).toMatchObject({ charWpm: 20, effectiveWpm: 12, pitch: 650, volume: 0.7 });
  });
});
