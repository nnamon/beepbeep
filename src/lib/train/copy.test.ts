import { describe, expect, it } from 'vitest';
import { compareCopy, compareRound } from './scoring';
import { newStat, pickNext, type ItemStat } from './srs';
import { mulberry32 } from '../util/random';

describe('copy scoring', () => {
  it('counts characters typed that were not sent', () => {
    expect(compareCopy('KM', 'KM').accuracy).toBe(1);
    const r = compareCopy('KM', 'KKKKKKM');
    expect(r.extra).toBe(5);
    expect(r.accuracy).toBeCloseTo(2 / 7);
    // Spaces are not characters.
    expect(compareCopy('KM', 'K M').accuracy).toBe(1);
  });

  it('scores a round answer by answer, not as one joined string', () => {
    // Joined, "KMR" against "KM R" lines up better than the answers did.
    const log = [
      { want: 'KM', got: 'K' },
      { want: 'R', got: 'MR' },
    ];
    const r = compareRound(log);
    expect(r.total).toBe(3);
    expect(r.correct).toBe(2);
    expect(r.extra).toBe(1);
    expect(r.accuracy).toBeCloseTo(2 / 4);
  });

  it('typing extra characters cannot pass a lesson', () => {
    const log = Array.from({ length: 20 }, () => ({ want: 'KM', got: 'KKMMKM' }));
    expect(compareRound(log).accuracy).toBeLessThan(0.9);
  });
});

describe('picking the next character', () => {
  const run = (keys: string[], stats = new Map<string, ItemStat>(), n = 400) => {
    const rng = mulberry32(7);
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(pickNext(rng, keys, stats, out));
    return out;
  };

  for (const keys of [['K', 'M'], ['K', 'M', 'R'], ['K', 'M', 'R', 'S']]) {
    it(`is not a fixed cycle with ${keys.length} characters`, () => {
      const seq = run(keys).join('');
      const n = Math.floor(seq.length / keys.length);
      expect(seq.slice(0, n * keys.length)).not.toBe(seq.slice(0, keys.length).repeat(n));
    });
  }

  it('gives a weak character more turns with only three characters', () => {
    const stats = new Map([
      ['K', { ...newStat('K'), heat: 0.3 }],
      ['M', { ...newStat('M'), heat: 0.3 }],
      ['R', { ...newStat('R'), heat: 9 }],
    ]);
    const seq = run(['K', 'M', 'R'], stats, 600);
    expect(seq.filter((c) => c === 'R').length / seq.length).toBeGreaterThan(0.42);
  });

  it('still holds back the last few when there are many', () => {
    const keys = 'KMRSUAPTLO'.split('');
    const seq = run(keys);
    for (let i = 3; i < seq.length; i++) expect(seq.slice(i - 3, i)).not.toContain(seq[i]);
  });
});
