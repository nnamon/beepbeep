import { describe, expect, it } from 'vitest';
import { KOCH_LEVELS, KOCH_ORDER, LICW_BC1, LICW_BC2, licwLevels, migrateLevelId } from './courses';
import { callsign, items, fillPhrase, stationLine } from './generate';
import { newStat, recordAnswer, pickNext, NEW_HEAT } from './srs';
import { compareCopy, recoveryLength, spacingIssues, oneNote } from './scoring';
import { analyseFist } from './fist';
import { Decoder, type DecoderOutput } from '../decoder/decoder';
import { buildSchedule, type FistOptions } from '../morse/schedule';
import { patternOf } from '../morse/code';
import { mulberry32 } from '../util/random';

describe('courses', () => {
  it('LICW carousel covers 43 characters, 18 in BC1, and BK as a letter pair', () => {
    expect(LICW_BC1.flat()).toHaveLength(18);
    expect(LICW_BC2.flat()).toHaveLength(25);
    const levels = licwLevels();
    expect(levels.at(-1)!.known).toHaveLength(43);
    expect(new Set(levels.at(-1)!.known).size).toBe(43);
    expect(levels.at(-1)!.known).not.toContain('<BK>');
    expect(levels[0]).toMatchObject({ id: 'licw-bc1-REA', name: 'BC1 · REA', added: ['R', 'E', 'A'], charWpm: 12, effectiveWpm: 8 });
    expect(levels[6]).toMatchObject({ id: 'licw-bc2-KMY', added: ['K', 'M', 'Y'], effectiveWpm: 10 });
    const bk = levels.find((l) => l.id === 'licw-bc2-28BK')!;
    expect(bk).toMatchObject({ name: 'BC2 · 2 8 BK', added: ['2', '8'], words: ['BK'] });
    expect(levels.find((l) => l.id === 'licw-bc2-40')!.words).toEqual(['BK']);
  });
  it('the carousel starts at the group you joined', () => {
    const levels = licwLevels({ bc1: 'TIN', bc2: 'QXV' });
    expect(levels.slice(0, 6).map((l) => l.id)).toEqual(['licw-bc1-TIN', 'licw-bc1-PSG', 'licw-bc1-LCD', 'licw-bc1-HOF', 'licw-bc1-UWB', 'licw-bc1-REA']);
    expect(levels[0].known).toEqual(['T', 'I', 'N']);
    expect(levels[5].known).toHaveLength(18);
    // BC2 starts with all of BC1 known.
    expect(levels[6].id).toBe('licw-bc2-QXV');
    expect(levels[6].known).toEqual([...LICW_BC1.flat().slice(3), 'R', 'E', 'A', 'Q', 'X', 'V']);
    expect(levels.at(-1)!.id).toBe('licw-bc2-59,');
  });
  it('maps lesson numbers saved before the carousel to groups', () => {
    expect(migrateLevelId('licw-bc1-2')).toBe('licw-bc1-TIN');
    expect(migrateLevelId('licw-bc2-8')).toBe('licw-bc2-28BK');
    expect(migrateLevelId('licw-bc2-5')).toBe('licw-bc2-ARSKBT');
    expect(migrateLevelId('licw-bc1-TIN')).toBe('licw-bc1-TIN');
    expect(migrateLevelId('koch-3')).toBe('koch-3');
  });
  it('every course character has a pattern', () => {
    for (const t of [...KOCH_ORDER, ...LICW_BC1.flat(), ...LICW_BC2.flat()]) expect(patternOf(t)).toBeTruthy();
  });
  it('Koch starts with K and M', () => {
    expect(KOCH_LEVELS[0].known).toEqual(['K', 'M']);
    expect(KOCH_LEVELS[1].added).toEqual(['R']);
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
    expect(spacingIssues('SET TO', 'SA TO').map((i) => i.detail)).toEqual(['ET as A']);
    expect(spacingIssues('CAR', 'CAEN').map((i) => i.detail)).toEqual(['R as EN']);
    expect(oneNote(null, spacingIssues('CALL ES', 'CALLES'))).toMatch(/Word gap too short/);
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
    expect(oneNote(f)).toBe('Timing within range.');
  });
  it('spots heavy weighting and short dahs', () => {
    expect(oneNote(analyseFist(decodeOutputs(TEXT, 18, { weight: 0.35 }))!)).toMatch(/Heavy weighting/);
    expect(oneNote(analyseFist(decodeOutputs(TEXT, 18, { dahRatio: 2.3 }))!)).toMatch(/Dahs short/);
  });
});

describe('lesson advance', () => {
  it('opens the next lesson at 90% on Koch and 80% on LICW', async () => {
    const { settings } = await import('../state/settings.svelte');
    const { lessonOpenedBy, advanceThreshold } = await import('./session');
    settings.track = 'koch';
    settings.level.koch = 'koch-1';
    expect(advanceThreshold()).toBe(0.9);
    expect(lessonOpenedBy(0.85)).toBeNull();
    expect(lessonOpenedBy(0.9)?.id).toBe('koch-2');
    settings.track = 'licw';
    settings.level.licw = 'licw-bc1-REA';
    expect(lessonOpenedBy(0.8)?.id).toBe('licw-bc1-TIN');
    settings.level.licw = licwLevels().at(-1)!.id;
    expect(lessonOpenedBy(1)).toBeNull();
    // A carousel start only counts in a class.
    const { trackLevels } = await import('./session');
    settings.carousel = { bc1: 'TIN', bc2: 'QXV' };
    settings.licwEnrolled = false;
    expect(trackLevels('licw')[0].id).toBe('licw-bc1-REA');
    settings.licwEnrolled = true;
    expect(trackLevels('licw')[0].id).toBe('licw-bc1-TIN');
    expect(trackLevels('licw')[6].id).toBe('licw-bc2-QXV');
  });
});

describe('my station lines', () => {
  it('builds sending practice from your own details', () => {
    const rng = mulberry32(9);
    const you = { call: '9v1ab', name: 'jose', qth: 'tampines', state: 'singapore', skcc: '' };
    const lines = new Set(Array.from({ length: 300 }, () => stationLine(rng, you)!));
    expect([...lines].every((l) => l.includes('9V1AB') || l.includes('JOSE') || l.includes('TAMPINES') || l.includes('SINGAPORE'))).toBe(true);
    expect(lines).toContain('CQ CQ CQ DE 9V1AB 9V1AB K');
    expect(lines).toContain('QTH TAMPINES SINGAPORE');
    expect(stationLine(rng, { ...you, call: ' ' })).toBeNull();
  });
});
