import { describe, expect, it } from 'vitest';
import { patternOf, tokenOf, tokenize, unitsOf, displayToken, ALL_TOKENS } from './code';
import { spacing, ditSeconds } from './timing';
import { buildSchedule } from './schedule';
import { renderSchedule } from './render';

describe('code table', () => {
  it('round-trips every token through its pattern', () => {
    for (const t of ALL_TOKENS) {
      const p = patternOf(t)!;
      // Aliased punctuation decodes to its prosign, which is fine.
      expect(patternOf(tokenOf(p)!)).toBe(p);
    }
  });

  it('prefers prosigns for shared patterns', () => {
    expect(tokenOf('.-.-.')).toBe('<AR>');
    expect(tokenOf('-...-')).toBe('<BT>');
    expect(tokenOf('-.--.')).toBe('<KN>');
  });

  it('tokenizes text with prosigns and aliases', () => {
    expect(tokenize('cq de k1abc <ar>')).toEqual(['C', 'Q', ' ', 'D', 'E', ' ', 'K', '1', 'A', 'B', 'C', ' ', '<AR>']);
    expect(tokenize('a = b')).toEqual(['A', ' ', '<BT>', ' ', 'B']);
    expect(tokenize('  hi   there  ')).toEqual(['H', 'I', ' ', 'T', 'H', 'E', 'R', 'E']);
    expect(displayToken('<SK>')).toBe('SK');
  });

  it('counts PARIS as 50 units with its spacing', () => {
    const word = ['P', 'A', 'R', 'I', 'S'].map((c) => unitsOf(patternOf(c)!));
    const total = word.reduce((a, b) => a + b, 0) + 4 * 3 + 7;
    expect(total).toBe(50);
  });
});

describe('timing', () => {
  it('uses 1.2/wpm dits', () => {
    expect(ditSeconds(20)).toBeCloseTo(0.06);
  });

  it('applies ARRL Farnsworth spacing', () => {
    const s = spacing(18, 10);
    // PARIS at 18 char wpm has 31 units of characters; with gaps the word lasts 6 s at 10 wpm.
    const word = 31 * s.dit + 4 * s.charGap + s.wordGap;
    expect(word).toBeCloseTo(60 / 10, 1);
    expect(spacing(20, 20).charGap).toBeCloseTo(3 * ditSeconds(20));
  });
});

describe('schedule and render', () => {
  it('builds exact PARIS timing at 20 wpm', () => {
    const s = buildSchedule('PARIS PARIS', { charWpm: 20, leadIn: 0, tail: 0 });
    const dit = 0.06;
    const firstWord = s.chars.filter((c) => c.token !== ' ').slice(0, 5);
    expect(firstWord[0].start).toBeCloseTo(0);
    // Second word starts after 50 units.
    const second = s.chars.filter((c) => c.token !== ' ')[5];
    expect(second.start).toBeCloseTo(50 * dit, 6);
  });

  it('renders the tone where the schedule says, quiet elsewhere', () => {
    const fs = 8000;
    const s = buildSchedule('T', { charWpm: 20, leadIn: 0.1, tail: 0.1 });
    const x = renderSchedule(s, { sampleRate: fs, pitch: 600, amplitude: 0.5 });
    const rms = (a: number, b: number) => {
      let acc = 0;
      for (let i = Math.floor(a * fs); i < Math.floor(b * fs); i++) acc += x[i] * x[i];
      return Math.sqrt(acc / ((b - a) * fs));
    };
    expect(rms(0, 0.09)).toBeLessThan(1e-6);
    expect(rms(0.12, 0.25)).toBeGreaterThan(0.3);
  });
});
