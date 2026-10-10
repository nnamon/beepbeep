import { describe, expect, it } from 'vitest';
import { TRACKS, KOCH_ORDER, LICW_BC1, LICW_BC2 } from './courses';
import { callsign, items, fillPhrase } from './generate';
import { newStat, recordAnswer, pickNext, NEW_HEAT } from './srs';
import { compareCopy, recoveryLength, spacingIssues, oneNote } from './scoring';
import { analyseFist } from './fist';
import { Decoder, type DecoderOutput } from '../decoder/decoder';
import { buildSchedule, type FistOptions } from '../morse/schedule';
import { patternOf } from '../morse/code';
import { mulberry32 } from '../util/random';

describe('courses', () => {
  it('LICW carousel covers 44 characters, 18 in BC1', () => {
    expect(LICW_BC1.flat()).toHaveLength(18);
    expect(LICW_BC2.flat()).toHaveLength(26);
    const levels = TRACKS.licw.levels;
    expect(levels.at(-1)!.known).toHaveLength(44);
    expect(new Set(levels.at(-1)!.known).size).toBe(44);
    expect(levels[0]).toMatchObject({ name: 'BC1 · lesson 1', added: ['R', 'E', 'A'], charWpm: 12, effectiveWpm: 8 });
    expect(levels[6]).toMatchObject({ added: ['K', 'M', 'Y'], effectiveWpm: 10 });
  });
  it('every course character has a pattern', () => {
    for (const t of [...KOCH_ORDER, ...LICW_BC1.flat(), ...LICW_BC2.flat()]) expect(patternOf(t)).toBeTruthy();
  });
  it('Koch starts with K and M', () => {
    expect(TRACKS.koch.levels[0].known).toEqual(['K', 'M']);
    expect(TRACKS.koch.levels[1].added).toEqual(['R']);
  });
});

describe('generators', () => {
  it('makes plausible callsigns', () => {
    const rng = mulberry32(4);
    for (let i = 0; i < 200; i++) {
      expect(callsign(rng)).toMatch(/^[A-Z0-9]{1,3}\d[A-Z]{1,3}$/);
    }
  });
  it('respects known characters', () => {
    const rng = mulberry32(5);
    const known = new Set(['R', 'E', 'A', 'T', 'I', 'N', 'P', 'S', 'G']);
    for (const w of items(rng, 'words', known, 30)) for (const ch of w) expect(known.has(ch)).toBe(true);
    for (const w of items(rng, 'characters', known, 30)) expect(known.has(w)).toBe(true);
  });
  it('fills phrase templates', () => {
    expect(fillPhrase(mulberry32(1), 'NAME IS {NAME}', { name: 'BOB' })).toBe('NAME IS BOB');
  });
});

describe('spaced repetition', () => {
  it('heats misses and cools quick right answers', () => {
    let s = newStat('K');
    s = recordAnswer(s, false, 900, 1500);
    expect(s.heat).toBeGreaterThan(NEW_HEAT);
    const hot = s.heat;
    s = recordAnswer(s, true, 600, 1500);
    expect(s.heat).toBeLessThan(hot);
  });
  it('picks hot items more often and avoids immediate repeats', () => {
    const rng = mulberry32(9);
    const stats = new Map([['A', { ...newStat('A'), heat: 9 }], ['B', { ...newStat('B'), heat: 0.5 }], ['C', { ...newStat('C'), heat: 0.5 }]]);
    const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (let i = 0; i < 1000; i++) counts[pickNext(rng, ['A', 'B', 'C'], stats)]++;
    expect(counts.A).toBeGreaterThan(counts.B * 4);
    for (let i = 0; i < 100; i++) expect(pickNext(rng, ['A', 'B', 'C'], stats, ['A'])).not.toBe('A');
  });
});

describe('scoring', () => {
  it('scores copy and measures recovery after misses', () => {
    const r = compareCopy('THE QUICK FOX', 'THE QXXCK FOX');
    expect(r.total).toBe(11);
    expect(r.correct).toBe(9);
    expect(r.confusions).toEqual([{ want: 'U', got: 'X' }, { want: 'I', got: 'X' }]);
    expect(recoveryLength(r)).toBe(2);
  });
  it('finds merged words, merged letters and split letters', () => {
    expect(spacingIssues('TNX FER CALL ES 73', 'TNX FER CALLES 73').map((i) => i.kind)).toEqual(['merged-words']);
    expect(spacingIssues('ET', 'A').map((i) => i.kind)).toEqual(['merged-letters']);
    expect(spacingIssues('R', 'EN').map((i) => i.kind)).toEqual(['split-letter']);
    expect(oneNote(null, spacingIssues('CALL ES', 'CALLES'))).toMatch(/Word gaps ran short/);
  });
});

function decodeOutputs(text: string, wpm: number, fist?: FistOptions): DecoderOutput[] {
  const s = buildSchedule(text, { charWpm: wpm, fist });
  const d = new Decoder({ initialWpm: wpm });
  const out: DecoderOutput[] = [];
  for (const m of s.marks) {
    out.push(...d.keyDown(m.start));
    out.push(...d.keyUp(m.end));
  }
  out.push(...d.tick(s.duration + 5), ...d.flush(s.duration + 5));
  return out;
}

describe('fist analysis', () => {
  const TEXT = 'CQ CQ DE K1ABC K TNX FER CALL UR RST 579';
  it('measures standard timing as 1:3, 1/3/7', () => {
    const f = analyseFist(decodeOutputs(TEXT, 20))!;
    expect(f.wpm).toBeCloseTo(20, 0);
    expect(f.dahRatio).toBeCloseTo(3, 1);
    expect(f.elemGap).toBeCloseTo(1, 1);
    expect(f.charGap).toBeCloseTo(3, 1);
    expect(f.wordGap!).toBeCloseTo(7, 0);
    expect(f.weighting).toBeCloseTo(1, 1);
    expect(oneNote(f)).toBe('Clean, even sending.');
  });
  it('spots heavy weighting and short dahs', () => {
    expect(oneNote(analyseFist(decodeOutputs(TEXT, 18, { weight: 0.35 }))!)).toMatch(/Heavy weighting/);
    expect(oneNote(analyseFist(decodeOutputs(TEXT, 18, { dahRatio: 2.3 }))!)).toMatch(/Dahs ran short/);
  });
});
