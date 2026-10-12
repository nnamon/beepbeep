// The scorer itself: which signal is which station, what counts as an error,
// and what counts as false text.

import { describe, expect, it } from 'vitest';
import { scoreBand } from './score';
import type { StationTruth } from './band';

/** A station's truth from its transmissions: [text, start, end]. */
function station(name: string, pitch: number, sends: [string, number, number][], range?: [number, number]): StationTruth {
  return {
    name,
    pitch,
    pitchRange: range ?? [pitch, pitch],
    wpm: 20,
    keying: 'machine',
    levelDb: 0,
    text: sends.map((s) => s[0]).join(' '),
    sends: sends.map(([text, start, end]) => ({ text, start, end })),
    marks: [],
  };
}

const A = station('A', 600, [['CQ CQ DE 9V1XX K', 1, 10]]);
const B = station('B', 750, [['TNX FER CALL', 2, 9]]);

describe('scoring band readings', () => {
  it('the truth read back is perfect', () => {
    const s = scoreBand([A, B], [{ pitch: 600, text: A.text }, { pitch: 750, text: B.text }]);
    expect(s.errors).toBe(0);
    expect(s.falseChars).toBe(0);
    expect(s.stations.map((x) => x.cer)).toEqual([0, 0]);
  });

  it('counts edits in Morse tokens: a prosign is one, a run of spaces is one', () => {
    const t = station('T', 600, [['73 <SK>', 0, 5]]);
    expect(scoreBand([t], [{ pitch: 600, text: '73   <SK>' }]).errors).toBe(0);
    // The same sound written as its punctuation alias.
    expect(scoreBand([station('U', 600, [['UR 599 <BT> NAME', 0, 5]])], [{ pitch: 600, text: 'UR 599 = NAME' }]).errors).toBe(0);
    expect(scoreBand([t], [{ pitch: 600, text: '73 SK' }]).errors).toBe(2);
    expect(scoreBand([t], [{ pitch: 600, text: '73<SK>' }]).errors).toBe(1);
    const one = scoreBand([A], [{ pitch: 600, text: 'CQ CQ DE 9V1XY K' }]);
    expect(one.stations[0].errors).toBe(1);
    expect(one.stations[0].cer).toBeCloseTo(1 / 16, 9);
  });

  it('a station nobody read is all errors', () => {
    const s = scoreBand([A, B], [{ pitch: 602, text: A.text }]);
    expect(s.stations[1]).toMatchObject({ name: 'B', errors: 12, cer: 1, signal: null });
    expect(s.cer).toBeCloseTo(12 / 28, 9);
  });

  it('a signal near no station is false text, spaces aside', () => {
    const s = scoreBand([A], [{ pitch: 600, text: A.text }, { pitch: 900, text: 'EE TT E' }]);
    expect(s.errors).toBe(0);
    expect(s.falseChars).toBe(5);
    expect(s.falseSignals).toEqual([1]);
  });

  it('a signal goes to the station nearest its pitch, within the tolerance', () => {
    // 15 Hz from A, 25 from C: it is A's, whatever it says.
    const C = station('C', 640, [['TNX FER CALL', 2, 9]]);
    const near = scoreBand([A, C], [{ pitch: 615, text: C.text }]);
    expect(near.stations[0].signal).toBe(0);
    expect(near.stations[1].signal).toBeNull();
    expect(scoreBand([A], [{ pitch: 631, text: A.text }]).falseChars).toBe(12);
    expect(scoreBand([A], [{ pitch: 631, text: A.text }], { tolHz: 40 }).errors).toBe(0);
  });

  it('a station shown twice: the better reading counts, the other is false text', () => {
    const s = scoreBand([A], [{ pitch: 598, text: 'CQ CQ' }, { pitch: 604, text: A.text }]);
    expect(s.stations[0]).toMatchObject({ errors: 0, signal: 1 });
    expect(s.falseChars).toBe(4);
  });

  it('a drifting station is found anywhere along its drift', () => {
    const d = station('D', 700, [['CQ DE 9V1XX', 0, 60]], [690, 700]);
    expect(scoreBand([d], [{ pitch: 665, text: d.text }]).errors).toBe(0);
    expect(scoreBand([d], [{ pitch: 655, text: d.text }]).falseChars).toBe(9);
  });

  it('with no station, everything read is false text', () => {
    const s = scoreBand([], [{ pitch: 600, text: 'E T E' }, { pitch: 800, text: 'I' }]);
    expect(s.falseChars).toBe(4);
    expect(s.cer).toBeNaN();
    expect(scoreBand([], []).falseChars).toBe(0);
  });
});

describe('a QSO on nearly one pitch', () => {
  // A calls, B answers 15 Hz away, A replies: taking turns, never at once.
  const qa = station('QA', 650, [['CQ DE JA1QRT K', 1, 8], ['UR 579 KN', 13, 17]]);
  const qb = station('QB', 665, [['JA1QRT DE BV2KD K', 9, 12]]);

  it('may come out as one signal with both sides in turn', () => {
    const s = scoreBand([qa, qb], [{ pitch: 657, text: 'CQ DE JA1QRT K JA1QRT DE BV2KD K UR 579 KN' }]);
    expect(s.errors).toBe(0);
    expect(s.falseChars).toBe(0);
    expect(s.stations.map((x) => x.joined)).toEqual(['QB', 'QA']);
    expect(s.length).toBe(42);
  });

  it('or as two signals, one for each side', () => {
    const s = scoreBand([qa, qb], [{ pitch: 650, text: qa.text }, { pitch: 665, text: qb.text }]);
    expect(s.errors).toBe(0);
    expect(s.stations.map((x) => x.joined)).toEqual([null, null]);
    expect(s.length).toBe(qa.text.length + qb.text.length);
  });

  it('one side missing is scored as missing, not hidden in a joined reading', () => {
    const s = scoreBand([qa, qb], [{ pitch: 650, text: qa.text }]);
    expect(s.stations.map((x) => x.joined)).toEqual([null, null]);
    expect(s.errors).toBe(qb.text.length);
  });

  it('stations sending at the same time are not a pair', () => {
    const ca = station('CA', 650, [['CQ DE JA1QRT K', 1, 8]]);
    const cb = station('CB', 665, [['TEST BV2KD', 2, 9]]);
    const s = scoreBand([ca, cb], [{ pitch: 657, text: 'CQ DE JA1QRT K TEST BV2KD' }]);
    expect(s.stations.map((x) => x.joined)).toEqual([null, null]);
    expect(s.errors).toBe(11 + 10);
  });
});
