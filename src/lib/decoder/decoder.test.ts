import { describe, expect, it } from 'vitest';
import { Decoder } from './decoder';
import { outputsToText } from './pipeline';
import { buildSchedule, type FistOptions } from '../morse/schedule';
import { cer } from '../util/text';

/** Feeds a schedule's marks straight into the decoder (no audio). */
function decodeSchedule(text: string, charWpm: number, effectiveWpm?: number, fist?: FistOptions, initialWpm?: number) {
  const s = buildSchedule(text, { charWpm, effectiveWpm, fist });
  const d = new Decoder({ initialWpm: initialWpm ?? 15 });
  const out = [];
  for (const m of s.marks) {
    out.push(...d.keyDown(m.start));
    out.push(...d.keyUp(m.end));
  }
  out.push(...d.tick(s.duration + 5));
  out.push(...d.flush(s.duration + 5));
  return { text: outputsToText(out), decoder: d };
}

const TEXT = 'CQ CQ DE K1ABC K = TNX FER CALL UR RST 579 579 NAME BOB QTH BOSTON MA HW? <BK>';

describe('decoder on clean timing', () => {
  for (const wpm of [5, 12, 20, 30, 40]) {
    it(`decodes ${wpm} wpm from a 15 wpm start`, () => {
      const { text, decoder } = decodeSchedule(TEXT, wpm);
      expect(cer(TEXT, text)).toBeLessThan(0.03);
      expect(decoder.wpm).toBeGreaterThan(wpm * 0.85);
      expect(decoder.wpm).toBeLessThan(wpm * 1.15);
    });
  }

  it('decodes Farnsworth 12/8 and 18/10', () => {
    expect(cer(TEXT, decodeSchedule(TEXT, 12, 8, undefined, 12).text)).toBeLessThan(0.02);
    expect(cer(TEXT, decodeSchedule(TEXT, 18, 10, undefined, 18).text)).toBeLessThan(0.02);
  });

  it('reports unknown patterns rather than guessing', () => {
    const d = new Decoder({ initialWpm: 20 });
    // Seven dits in a row is not a character.
    let t = 0;
    for (let i = 0; i < 7; i++) {
      d.keyDown(t);
      d.keyUp(t + 0.06);
      t += 0.12;
    }
    const out = d.flush(t + 1);
    expect(out[0].kind === 'char' && out[0].char.token).toBe(null);
  });
});

describe('decoder on human fists', () => {
  it('handles 15% jitter', () => {
    const { text } = decodeSchedule(TEXT, 20, undefined, { jitter: 0.15, seed: 3 }, 20);
    expect(cer(TEXT, text)).toBeLessThan(0.03);
  });
  it('handles heavy and light weighting', () => {
    expect(cer(TEXT, decodeSchedule(TEXT, 18, undefined, { weight: 0.3, jitter: 0.05 }, 18).text)).toBeLessThan(0.03);
    expect(cer(TEXT, decodeSchedule(TEXT, 18, undefined, { weight: -0.2, jitter: 0.05 }, 18).text)).toBeLessThan(0.03);
  });
  it('follows a speed change from 15 to 28 wpm', () => {
    const long = `${TEXT} ${TEXT}`;
    expect(cer(long, decodeSchedule(long, 15, undefined, { drift: 0.85, jitter: 0.05 }, 15).text)).toBeLessThan(0.04);
  });
  it('handles a bug fist', () => {
    expect(cer(TEXT, decodeSchedule(TEXT, 22, undefined, { bug: true, jitter: 0.1 }, 22).text)).toBeLessThan(0.04);
  });
  it('handles short word gaps typical of hand sending', () => {
    expect(cer(TEXT, decodeSchedule(TEXT, 18, undefined, { wordGapScale: 0.75, jitter: 0.08 }, 18).text)).toBeLessThan(0.04);
  });
});
