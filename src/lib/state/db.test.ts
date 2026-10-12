// Export files are checked field by field before an import replaces
// anything, and the readers of stored progress cope with a bad value.

import { describe, expect, it } from 'vitest';
import { exportAll, getKv, importAll, readExport, sessions } from './db';
import { newStat, recordAnswer, windowStats, type ItemStat } from '../train/srs';

const DAMAGED = 'That export file is damaged. Nothing was changed.';
const now = Date.UTC(2026, 9, 12);
const fist = { chars: 30, wpm: 17.6, unit: 0.068, dahRatio: 2.6, elemGap: 1.1, charGap: 2.4, wordGap: 6.1, weighting: 1.08, drift: null, ditSpread: 0.12, clean: 27 };

/** A file as the app writes it: every kind of record, every optional field. */
function good() {
  return {
    app: 'beepbeep',
    version: 1,
    exportedAt: '2026-10-12T00:00:00.000Z',
    items: [
      { key: 'rx:K', heat: 1, seen: 10, correct: 8, avgMs: 900, recent: [1, 1, 0, 1], lastSeen: now, log: [[now, 1, 800], [now - 1000, 0, 0]] },
      { key: 'tx:K', heat: 3, seen: 0, correct: 0, avgMs: 0, recent: [], lastSeen: 0 },
    ],
    sessions: [
      { id: 1, at: now, mode: 'copy', track: 'koch', level: 'koch-5', seconds: 600, sending: false, items: 20, accuracy: 0.9, wpm: 20, effectiveWpm: 12 },
      { id: 2, at: now + 1, mode: 'send', seconds: 300, sending: true, items: 10, accuracy: 0.9, wpm: 15, sentWpm: 14.2, fist },
      { id: 3, at: now + 2, mode: 'live', seconds: 60, sending: true, items: 12, accuracy: null, wpm: 15, fist: null },
      { id: 4, at: now + 3, mode: 'ttr', seconds: 300, sending: false, items: 20, accuracy: 0.8, wpm: 18, ttrDelay: 1.1 },
      { id: 5, at: now + 4, mode: 'ifr', seconds: 90, sending: false, items: 60, accuracy: 0.85, wpm: 18, recovery: null, stretch: true },
    ],
    qsos: [{ id: 1, at: now, format: 'ragchew', opener: 'bot', call: 'JA1ABC', name: 'TARO', qth: 'TOKYO', state: '', rstSent: '599', rstRcvd: '579', seconds: 300, overs: 4, copyScore: 0.83, sendScore: 1, wpm: 18 }],
    confusions: [{ pair: 'H>5', want: 'H', got: '5', count: 4, last: now }],
    kv: [
      { key: 'texts', value: [{ id: 't1', name: 'Story', text: 'THE RIG IS ON', at: 1 }] },
      { key: 'pocket.custom', value: { chars: ['K', 'M'], words: ['TEST'] } },
      { key: 'recentSends', value: [{ at: now, text: 'CQ', marks: [{ start: 0, end: 0.2 }] }] },
      { key: 'sendSlips', value: { 'merged-words': 4, 'merged-letters': 3, 'split-letter': 2, 'split-word': 1, pairs: { 'ET as A': 2 } } },
      { key: 'today', value: { day: 20373, ids: ['copy'] } },
      { key: 'qsoLessons', value: { 'answer-cq': 2 } },
      { key: 'farnsworthSince', value: null },
      { key: 'somethingNewer', value: { kept: true } },
    ],
  };
}

describe('readExport', () => {
  it('takes a whole file as the app writes it unchanged', () => {
    const f = good();
    expect(readExport(f)).toEqual(f);
  });

  // Before: rows passed if they only had their key field, and the wrong types
  // broke Progress, Pocket and the Pocket round after the import.
  it('refuses a record the app could not use', () => {
    const cases: [string, unknown][] = [
      ['an item whose numbers are text', { items: [{ key: 'rx:K', heat: 'hot', seen: 'x', correct: null, avgMs: 0, recent: 'abc', log: 5, lastSeen: 'yesterday' }] }],
      ['an item with no answers list', { items: [{ key: 'rx:K', heat: 1, seen: 1, correct: 1, avgMs: 0, lastSeen: 0 }] }],
      ['a session dated with words', { sessions: [{ at: 'yesterday', mode: 'copy', seconds: 1, sending: false, items: 1, accuracy: 1, wpm: 12 }] }],
      ['a session dated past what a date can hold', { sessions: [{ at: 1e20, mode: 'copy', seconds: 1, sending: false, items: 1, accuracy: 1, wpm: 12 }] }],
      ['a session whose mode is a number', { sessions: [{ at: now, mode: 5, seconds: 1, sending: false, items: 1, accuracy: 1, wpm: 12 }] }],
      ['a session whose accuracy is text', { sessions: [{ at: now, mode: 'copy', seconds: 1, sending: false, items: 1, accuracy: 'high', wpm: 12 }] }],
      ['a QSO whose call is a number', { qsos: [{ ...good().qsos[0], call: 5 }] }],
      ['a QSO with no time', { qsos: [{ ...good().qsos[0], at: undefined }] }],
      ['a confusion with nothing heard', { confusions: [{ pair: 'H>5', want: 'H', got: null, count: 1, last: now }] }],
      ['a confusion counted in words', { confusions: [{ pair: 'H>5', want: 'H', got: '5', count: 'many', last: now }] }],
      ['a kv row with no key', { kv: [{ value: 1 }] }],
    ];
    for (const [what, part] of cases) expect(() => readExport({ app: 'beepbeep', ...(part as object) }), what).toThrow(DAMAGED);
  });

  it('leaves out bad optional fields and keeps the record', () => {
    const v = readExport({
      app: 'beepbeep',
      items: [{ key: 'rx:K', heat: 1, seen: 1, correct: 1, avgMs: 0, recent: [1], lastSeen: now, log: 5 }, { key: 'rx:M', heat: 1, seen: 1, correct: 1, avgMs: 0, recent: [1], lastSeen: now, log: [['x', 1, 2], [now, 1, 700], 'y'] }],
      sessions: [
        { id: 'a', at: now, mode: 'send', seconds: 60, sending: true, items: 1, accuracy: 1, wpm: 15, sentWpm: 'quick', fist: { chars: 'x', wpm: 'y' }, ttrDelay: 'x', track: 5 },
        { at: now, mode: 'live', seconds: 60, sending: true, items: 1, wpm: 15, fist: 'bad', recovery: 'x' },
      ],
    });
    expect(v.items[0]).not.toHaveProperty('log');
    expect(v.items[1].log).toEqual([[now, 1, 700]]);
    expect(v.sessions[0]).toEqual({ at: now, mode: 'send', seconds: 60, sending: true, items: 1, accuracy: 1, wpm: 15 });
    expect(v.sessions[1]).toEqual({ at: now, mode: 'live', seconds: 60, sending: true, items: 1, accuracy: null, wpm: 15 });
  });

  it('reads a number that went wrong (null in the file) as 0', () => {
    const v = readExport({ app: 'beepbeep', sessions: [{ at: now, mode: 'copy', seconds: null, sending: false, items: 20, accuracy: 0.9, wpm: null }] });
    expect(v.sessions[0]).toMatchObject({ seconds: 0, wpm: 0 });
  });

  it('mends or leaves out stored values of the wrong shape', () => {
    const kv = (rows: { key: string; value: unknown }[]) => readExport({ app: 'beepbeep', kv: rows }).kv;
    expect(
      kv([
        { key: 'texts', value: 'not a list' },
        { key: 'pocket.custom', value: 5 },
        { key: 'recentSends', value: {} },
        { key: 'sendSlips', value: 'x' },
        { key: 'today', value: 'x' },
        { key: 'farnsworthSince', value: 'x' },
        { key: 'qsoLessons', value: 'x' },
      ]),
    ).toEqual([]);
    expect(
      kv([
        { key: 'texts', value: [{ id: 1, name: null, text: 5 }, null, 'x', { id: 't2', name: 'Words', text: 'CQ' }] },
        { key: 'pocket.custom', value: { chars: 'KM', words: null } },
        { key: 'recentSends', value: [{ at: 1, text: 5, marks: 'x' }] },
        { key: 'sendSlips', value: { 'merged-words': 'x', 'split-word': 2, pairs: { 'ET as A': 'x', 'R as EN': 1 } } },
      ]),
    ).toEqual([
      { key: 'texts', value: [{ id: 't2', name: 'Words', text: 'CQ', at: 0 }] },
      { key: 'pocket.custom', value: { chars: [], words: [] } },
      { key: 'recentSends', value: [] },
      { key: 'sendSlips', value: { 'merged-words': 0, 'merged-letters': 0, 'split-letter': 0, 'split-word': 2, pairs: { 'R as EN': 1 } } },
    ]);
  });
});

describe('importAll', () => {
  it('stores the mended records, and a refused file changes nothing', async () => {
    await importAll(good());
    const before = await exportAll();
    await expect(importAll({ app: 'beepbeep', sessions: [{ at: 'yesterday', mode: 'copy' }] })).rejects.toThrow(DAMAGED);
    expect(await exportAll()).toMatchObject({ items: before.items, sessions: before.sessions, kv: before.kv });
    await importAll({ app: 'beepbeep', sessions: [{ at: now, mode: 'live', seconds: 60, sending: true, items: 3, wpm: 15, fist: 'bad', sentWpm: 'quick' }], kv: [{ key: 'pocket.custom', value: 5 }] });
    const s = await sessions();
    expect(s).toHaveLength(1);
    expect(s[0]).not.toHaveProperty('fist');
    expect(s[0]).not.toHaveProperty('sentWpm');
    expect(await getKv('pocket.custom', 'none')).toBe('none');
  });
});

describe('item stats with a damaged stored log', () => {
  // Before: a log that wasn't a list threw on Progress and when the next answer was recorded.
  const bad = { ...newStat('rx:K'), log: 5, recent: 'abc' } as unknown as ItemStat;

  it('count as no answers on Progress', () => {
    expect(windowStats(bad, 0)).toBeNull();
    expect(windowStats({ ...newStat('rx:K'), log: [['x', 1, 2], [now, 1, 700]] } as unknown as ItemStat, 0)).toEqual({ n: 1, accuracy: 1, value: 700 });
  });

  it('start again with the next answer', () => {
    const s = recordAnswer(bad, true, 500, 1500, now);
    expect(s.log).toEqual([[now, 1, 500]]);
    expect(s.recent).toEqual([1]);
  });
});
