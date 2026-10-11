// End-to-end accuracy: synthetic audio through the same detector and decoder
// the browser runs. The table printed at the end is the decoder's scorecard.

import { afterAll, describe, expect, it } from 'vitest';
import { renderText, type Conditions } from '../morse/render';
import type { FistOptions } from '../morse/schedule';
import { decodeSamples } from './pipeline';
import { cer } from '../util/text';

const FS = 48000;
const TEXT = 'CQ CQ DE K1ABC K = TNX FER CALL UR RST 579 579 NAME BOB QTH BOSTON MA HW? <BK>';
const ROWS: string[] = [];

interface Case {
  name: string;
  wpm: number;
  eff?: number;
  pitch?: number;
  fist?: FistOptions;
  cond?: Conditions;
  max: number;
  start?: number;
}

const CASES: Case[] = [
  { name: 'clean 12 wpm', wpm: 12, max: 0.01 },
  { name: 'clean 20 wpm', wpm: 20, max: 0.01 },
  { name: 'clean 30 wpm', wpm: 30, max: 0.02 },
  { name: 'clean 40 wpm', wpm: 40, max: 0.03 },
  { name: 'clean 6 wpm', wpm: 6, max: 0.03 },
  { name: 'Farnsworth 12/8', wpm: 12, eff: 8, max: 0.02 },
  { name: 'Farnsworth 18/10', wpm: 18, eff: 10, max: 0.02 },
  { name: '20 wpm, 10% jitter, 10 dB SNR', wpm: 20, fist: { jitter: 0.1, seed: 5 }, cond: { noise: { snrDb: 10 } }, max: 0.02 },
  { name: '20 wpm, 15% jitter, 6 dB SNR', wpm: 20, fist: { jitter: 0.15, seed: 6 }, cond: { noise: { snrDb: 6 } }, max: 0.06 },
  { name: '25 wpm, QSB 60%', wpm: 25, cond: { qsb: { depth: 0.6, rateHz: 0.4 }, noise: { snrDb: 20 } }, max: 0.03 },
  { name: '18 wpm, room echo', wpm: 18, fist: { jitter: 0.05 }, cond: { reverb: { decay: 0.3, mix: 0.35 }, noise: { snrDb: 25 } }, max: 0.03 },
  { name: '30 wpm, room echo', wpm: 30, cond: { reverb: { decay: 0.25, mix: 0.3 }, noise: { snrDb: 25 } }, max: 0.05 },
  // A sidetone is made locally and holds its pitch; a slight chirp is the most
  // a cheap oscillator shows. (Each mark's pitch is checked against the
  // sender's, which is what turns away voices and radios near the tone.)
  { name: '16 wpm, slight chirp + drift', wpm: 16, cond: { chirp: { hz: 6, tau: 0.03 }, drift: { hzPerSec: 1.5 }, noise: { snrDb: 15 } }, max: 0.02 },
  { name: '20 wpm, QRM -6 dB at +250 Hz', wpm: 20, cond: { qrm: { text: 'TEST TEST DE W9XYZ W9XYZ TEST', offsetHz: 250, relativeDb: -6, wpm: 24 }, noise: { snrDb: 15 } }, max: 0.05 },
  { name: '20 wpm, static crashes', wpm: 20, cond: { qrn: { ratePerSec: 1.5, level: 1.5 }, noise: { snrDb: 15 } }, max: 0.06 },
  { name: 'bug fist 22 wpm', wpm: 22, fist: { bug: true, jitter: 0.1, seed: 9 }, cond: { noise: { snrDb: 15 } }, max: 0.04 },
  { name: 'speed change 15 to 28 wpm', wpm: 15, fist: { drift: 0.85, jitter: 0.05 }, cond: { noise: { snrDb: 20 } }, max: 0.04 },
  { name: 'low pitch 400 Hz, 15 wpm', wpm: 15, pitch: 400, cond: { noise: { snrDb: 12 } }, max: 0.02 },
  { name: 'high pitch 1000 Hz, 25 wpm', wpm: 25, pitch: 1000, cond: { noise: { snrDb: 12 } }, max: 0.02 },
];

describe('decoder accuracy on synthetic audio', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const { samples } = renderText(TEXT, {
        sampleRate: FS,
        pitch: c.pitch ?? 650,
        amplitude: 0.4,
        charWpm: c.wpm,
        effectiveWpm: c.eff,
        fist: c.fist,
        seed: 11,
        ...c.cond,
      });
      const r = decodeSamples(samples, FS, { initialWpm: c.start ?? 15 });
      const e = cer(TEXT, r.text);
      ROWS.push(`${c.name.padEnd(34)} CER ${(e * 100).toFixed(1).padStart(5)}%  pitch ${r.pitch?.toFixed(0)}  wpm ${r.wpm.toFixed(1)}  ${e > c.max ? 'FAIL' : 'ok'}\n    got: ${r.text}`);
      expect(e).toBeLessThanOrEqual(c.max);
    });
  }

  afterAll(() => {
    console.log(`\nDecoder scorecard\n${ROWS.join('\n')}\n`);
  });
});
