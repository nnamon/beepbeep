// The Radio's join (join.ts): the detector's events into one ChannelDecoder
// per channel, read as the screen gets them. Whole behaviours run the app's
// pipeline on rendered audio (listenApp in listen.ts: the worklet's batching
// and the real detector); the edge cases feed the join scripted events.

import { describe, expect, it } from 'vitest';
import { keySend, renderBand, type Band } from './band';
import { BATCH_SEC } from './batch';
import { ChannelDecoder } from './channel';
import type { RadioEvent } from './detector';
import { KEEP_ENDED, SAME_HZ, SignalJoin } from './join';
import { listenApp } from './listen';
import { feed } from './perturb';
import type { RadioSignal } from './source';

const FS = 48000;

/** The app's pipeline over a band; the screen's signals once listening stops. */
function hear(band: Band): RadioSignal[] {
  return listenApp(renderBand(band, FS).samples, FS).signals;
}

const shown = (s: RadioSignal) => s.text + s.pending;

describe('the app pipeline on rendered audio', () => {
  it('reads one station: its pitch, speed, strength and text', () => {
    const [s, ...rest] = hear({ stations: [{ name: 'A', pitch: 650, wpm: 20, sends: [{ text: 'CQ CQ DE 9V1NE 9V1NE K', at: 1 }] }], noise: { snrDb: 25 }, seed: 3 });
    expect(rest).toEqual([]);
    expect(s.text).toBe('CQ CQ DE 9V1NE 9V1NE K');
    expect(s.pending).toBe('');
    expect(s.keying).toBe(false);
    expect(Math.abs(s.pitch - 650)).toBeLessThan(10);
    expect(Math.abs(s.wpm! - 20)).toBeLessThan(2);
    expect(s.snr).toBeGreaterThan(20);
  });

  it('reads two stations sending at the same time, 150 Hz apart, each as its own signal', () => {
    const list = hear({
      stations: [
        { name: 'A', pitch: 600, wpm: 20, sends: [{ text: 'CQ CQ DE 9V1XX 9V1XX K', at: 0.5 }] },
        { name: 'B', pitch: 750, wpm: 16, levelDb: -6, sends: [{ text: 'VK2BHF DE JA1QRT UR 579 K', at: 1.2 }] },
      ],
      noise: { snrDb: 20 },
      seed: 5,
    });
    expect(list).toHaveLength(2);
    const low = list.find((s) => s.pitch < 675)!;
    const high = list.find((s) => s.pitch > 675)!;
    expect(Math.abs(low.pitch - 600)).toBeLessThan(10);
    expect(Math.abs(high.pitch - 750)).toBeLessThan(10);
    expect(shown(low)).toBe('CQ CQ DE 9V1XX 9V1XX K');
    expect(shown(high)).toBe('VK2BHF DE JA1QRT UR 579 K');
    expect(Math.abs(low.wpm! - 20)).toBeLessThan(2);
    expect(Math.abs(high.wpm! - 16)).toBeLessThan(2);
  });

  it('reads both sides of a QSO at their own pitches and speeds, newest activity first', () => {
    const list = hear({
      stations: [
        { name: 'A', pitch: 600, wpm: 16, sends: [{ text: 'CQ CQ CQ DE 9V1NE 9V1NE K', at: 0.5 }, { text: 'G4ABC DE 9V1NE R TNX FER CALL UR RST 579 579 K', at: 25 }] },
        { name: 'B', pitch: 780, wpm: 24, sends: [{ text: '9V1NE DE G4ABC G4ABC GM OM UR RST 599 599 K', at: 13 }] },
      ],
      noise: { snrDb: 25 },
      seed: 8,
    });
    expect(list).toHaveLength(2);
    const [first, second] = list;
    expect(Math.abs(first.pitch - 600)).toBeLessThan(10);
    expect(first.text).toBe('CQ CQ CQ DE 9V1NE 9V1NE K\nG4ABC DE 9V1NE R TNX FER CALL UR RST 579 579 K');
    expect(Math.abs(second.pitch - 780)).toBeLessThan(10);
    expect(second.text).toBe('9V1NE DE G4ABC G4ABC GM OM UR RST 599 599 K');
  });

  it('gives each decoder its marks as they were heard: it reads them as it would offline', () => {
    // Two stations at once and a QSO, under static.
    const band: Band = {
      stations: [
        { name: 'A', pitch: 560, wpm: 22, sends: [{ text: 'CQ TEST DE SM5RYC SM5RYC', at: 0.5 }, { text: 'DL4MKX 5NN 14', at: 14 }] },
        { name: 'B', pitch: 760, wpm: 17, levelDb: -4, sends: [{ text: 'VK2BHF DE JA1QRT = UR RST 579 579 = NAME KENJI KN', at: 2 }] },
      ],
      noise: { snrDb: 14 },
      qrn: { ratePerSec: 1, db: 6 },
      passband: [300, 2700],
      seed: 21,
    };
    const marks = new Map<ChannelDecoder, { start: number; end: number }[]>();
    const proto = ChannelDecoder.prototype;
    const { keyDown, keyUp } = proto;
    let down = 0;
    proto.keyDown = function (this: ChannelDecoder, t: number) {
      down = t;
      keyDown.call(this, t);
    };
    proto.keyUp = function (this: ChannelDecoder, t: number) {
      if (!marks.has(this)) marks.set(this, []);
      marks.get(this)!.push({ start: down, end: t });
      keyUp.call(this, t);
    };
    let signals: RadioSignal[];
    try {
      signals = listenApp(renderBand(band, FS).samples, FS).signals;
    } finally {
      proto.keyDown = keyDown;
      proto.keyUp = keyUp;
    }
    expect(signals).toHaveLength(2);
    expect(marks.size).toBe(2);
    const offline = [...marks.values()].map((m) => feed(new ChannelDecoder({ inPlace: true }), m)).sort();
    expect(signals.map(shown).sort()).toEqual(offline);
  });

  it('shows the words being read while the station sends, and writes them once it stops', () => {
    const band: Band = { stations: [{ name: 'A', pitch: 700, wpm: 20, sends: [{ text: 'CQ CQ DE JA1XYZ JA1XYZ K', at: 1 }] }], seconds: 20, noise: { snrDb: 25 }, seed: 4 };
    const audio = renderBand(band, FS);
    const end = audio.truth[0].marks.at(-1)!.end;
    const seen: { time: number; text: string; pending: string; keying: boolean }[] = [];
    const { signals } = listenApp(audio.samples, FS, {
      keepListening: true,
      onBatch: (join, time) => {
        const s = join.list()[0];
        if (s) seen.push({ time, text: s.text, pending: s.pending, keying: s.keying });
      },
    });
    // While it sends, the words show as being read, and the key light comes and goes.
    const sending = seen.filter((x) => x.time < end);
    expect(sending.some((x) => x.pending.includes('CQ CQ'))).toBe(true);
    expect(sending.some((x) => x.keying)).toBe(true);
    expect(sending.some((x) => !x.keying)).toBe(true);
    // A few seconds after it stops, every word is written.
    expect(signals[0].text).toBe('CQ CQ DE JA1XYZ JA1XYZ K');
    expect(signals[0].pending).toBe('');
    const written = seen.find((x) => x.text === 'CQ CQ DE JA1XYZ JA1XYZ K')!;
    expect(written.time - end).toBeLessThan(5);
  });
});

/** Events as a detector would give them, each with the detector time it comes out at. */
type Out = { e: RadioEvent; out: number };

/**
 * A station on channel `ch`: its signal event and its marks, each key-up
 * coming out `late` seconds after its time (at most the lag). As from the
 * detector, a channel's events come out in order.
 */
function station(ch: number, hz: number, text: string, wpm: number, at: number, late = 0.3, withdrawn: number[] = []): Out[] {
  const marks = keySend({ name: 'X', pitch: hz, wpm, sends: [] }, text, 0).map((m) => ({ start: m.start + at, end: m.end + at }));
  // A sound taken for a mark, then withdrawn: its key-up comes at its own start.
  for (const t of withdrawn) marks.push({ start: t, end: t });
  marks.sort((a, b) => a.start - b.start);
  let out = at + 0.2;
  const evs: Out[] = [{ e: { type: 'signal', ch, hz, snr: 30, t: out }, out }];
  for (const m of marks) {
    out = Math.max(out, m.start + 0.05);
    evs.push({ e: { type: 'key', ch, down: true, t: m.start }, out });
    out = Math.max(out, m.end + late);
    evs.push({ e: { type: 'key', ch, down: false, t: m.end }, out });
  }
  return evs;
}

const LAG = 0.35;

/** Feeds the events to the join in batches up to `until`, as the worklet posts them; the page clock runs 5 seconds ahead of the detector's. */
function run(join: SignalJoin, events: Out[], from: number, until: number) {
  const evs = [...events].sort((a, b) => a.out - b.out);
  let i = 0;
  while (i < evs.length && evs[i].out <= from) i++;
  for (let time = from + BATCH_SEC; time <= until + 1e-9; time += BATCH_SEC) {
    const batch: RadioEvent[] = [];
    while (i < evs.length && evs[i].out <= time) batch.push(evs[i++].e);
    join.feed(batch, time, LAG, time * 1000 + 5000);
  }
}

const inPlace = { channel: { inPlace: true } };

describe('the join, on scripted events', () => {
  it('drops a mark the detector withdrew, without moving the gaps around it', () => {
    const plain = new SignalJoin(inPlace);
    const withdrawn = new SignalJoin(inPlace);
    const events = station(0, 700, 'PARIS PARIS', 20, 1);
    // A sound just after the fourth mark (in the gap after the A of PARIS).
    const ups = events.filter((x) => x.e.type === 'key' && !x.e.down);
    const t = (ups[3].e as { t: number }).t + 0.03;
    run(plain, events, 0, 12);
    run(withdrawn, station(0, 700, 'PARIS PARIS', 20, 1, 0.3, [t]), 0, 12);
    expect(withdrawn.counts.withdrawn).toBe(1);
    expect(withdrawn.counts.marks).toBe(plain.counts.marks);
    expect(withdrawn.list()[0].text).toBe('PARIS PARIS');
    expect(withdrawn.list()[0].text).toBe(plain.list()[0].text);
    expect(withdrawn.list()[0].wpm).toBe(plain.list()[0].wpm);
  });

  it("never tells a decoder of silence past a key-down still waiting for its key-up, so late key-ups read the same", () => {
    const soon = new SignalJoin(inPlace);
    const late = new SignalJoin(inPlace);
    run(soon, station(0, 700, 'CQ CQ DE 9V1NE K', 18, 1, 0.01), 0, 15);
    run(late, station(0, 700, 'CQ CQ DE 9V1NE K', 18, 1, LAG), 0, 15);
    expect(late.counts.late).toBe(0);
    expect(late.list()[0].text).toBe('CQ CQ DE 9V1NE K');
    expect(late.list()[0].text).toBe(soon.list()[0].text);
  });

  it('times lastHeard on the page clock from the end of the last mark', () => {
    const join = new SignalJoin(inPlace);
    const events = station(0, 700, 'TEST', 20, 1);
    run(join, events, 0, 4);
    const last = Math.max(...events.map((x) => (x.e.type === 'key' ? x.e.t : 0)));
    expect(join.list()[0].lastHeard).toBeCloseTo(last * 1000 + 5000, 6);
  });

  it('sends a channel its decoder’s dit when it changes by more than 8%', () => {
    const sent: [number, number][] = [];
    const join = new SignalJoin({ ...inPlace, onDit: (ch, dit) => sent.push([ch, dit]) });
    run(join, station(3, 700, 'CQ CQ DE 9V1NE 9V1NE K', 30, 1), 0, 10);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.length).toBeLessThan(6);
    expect(sent.every(([ch]) => ch === 3)).toBe(true);
    expect(sent.at(-1)![1]).toBeCloseTo(1.2 / 30, 2);
    for (let i = 1; i < sent.length; i++) expect(Math.abs(sent[i][1] - sent[i - 1][1]) / sent[i][1]).toBeGreaterThan(0.08);
  });

  it('keeps the text of a channel the detector dropped, and goes on with it when a station comes back near its pitch', () => {
    const join = new SignalJoin(inPlace);
    const a = station(0, 700, 'CQ DE 9V1NE K', 20, 1);
    const end = Math.max(...a.map((x) => x.out));
    run(join, [...a, { e: { type: 'gone', ch: 0, t: end + 45 }, out: end + 45 }], 0, end + 46);
    const [s] = join.list();
    expect(join.size).toEqual({ live: 0, ended: 1 });
    expect(s.text).toBe('CQ DE 9V1NE K');
    expect(s.keying).toBe(false);
    // Back 10 Hz higher on a new channel: the same signal, on a new line.
    run(join, station(4, 710, 'TEST K', 20, end + 60), end + 46, end + 70);
    // A station 100 Hz away is another signal.
    run(join, station(5, 810, 'QRL?', 20, end + 71), end + 70, end + 80);
    const list = join.list();
    expect(list).toHaveLength(2);
    const back = list.find((x) => x.id === s.id)!;
    expect(back.text).toBe('CQ DE 9V1NE K\nTEST K');
    expect(back.pitch).toBe(710);
    expect(list.find((x) => x.id !== s.id)!.text).toBe('QRL?');
    expect(SAME_HZ).toBeLessThan(100);
  });

  it(`keeps the ${KEEP_ENDED} most recently heard of the signals that ended`, () => {
    const join = new SignalJoin(inPlace);
    let t = 1;
    for (let k = 0; k < 30; k++) {
      // Each its own pitch, each dropped 45 seconds after its last mark.
      const s = station(k, 400 + 40 * k, `CQ DE ${k}A K`, 22, t);
      const end = Math.max(...s.map((x) => x.out));
      run(join, [...s, { e: { type: 'gone', ch: k, t: end + 1 }, out: end + 1 }], t - 0.5, end + 1.5);
      t = end + 2;
    }
    const list = join.list();
    expect(list).toHaveLength(KEEP_ENDED);
    expect(list.map((s) => s.text)).toEqual(Array.from({ length: KEEP_ENDED }, (_, i) => `CQ DE ${29 - i}A K`));
  });

  it('on Clear forgets every text and lists a station again when it next sends', () => {
    const join = new SignalJoin(inPlace);
    run(join, [...station(0, 600, 'CQ DE 9V1NE K', 20, 1), ...station(1, 900, 'QRZ? K', 20, 1.5)], 0, 12);
    run(join, [{ e: { type: 'gone', ch: 1, t: 12.1 }, out: 12.1 }], 12, 12.2);
    expect(join.list().map((s) => s.text)).toEqual(['CQ DE 9V1NE K', 'QRZ? K']);
    join.clear();
    expect(join.list()).toEqual([]);
    run(join, station(0, 600, 'TEST K', 20, 14), 12.2, 22);
    const list = join.list();
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe('TEST K');
  });

  it('on Stop writes the over each signal was reading; after Start, a station at the same pitch goes on with it', () => {
    const join = new SignalJoin(inPlace);
    const s = station(0, 650, 'CQ CQ DE G4ABC G4ABC K', 20, 1);
    // Stopped soon after the last mark, before the over has ended.
    const end = Math.max(...s.map((x) => x.out));
    run(join, s, 0, end + 0.2);
    expect(join.list()[0].pending).not.toBe('');
    join.stop();
    const [stopped] = join.list();
    expect(stopped.text).toBe('CQ CQ DE G4ABC G4ABC K');
    expect(stopped.pending).toBe('');
    expect(join.size.live).toBe(0);
    // Started again: a new detector, whose time and channels start again from 0.
    run(join, station(0, 655, 'R R TU', 20, 1), 0, 8);
    const list = join.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(stopped.id);
    expect(list[0].text).toBe('CQ CQ DE G4ABC G4ABC K\nR R TU');
  });

  it('holds no more signals as stations come and go for over an hour', () => {
    const join = new SignalJoin(inPlace);
    let most = 0;
    let t = 1;
    for (let k = 0; k < 50; k++) {
      // Stations on 40 pitches 30 Hz apart, each sending once, dropped 45 seconds later, the next starting 25 seconds after that.
      const s = station(k, 400 + 30 * (k % 40), `CQ DE ${k}B K`, 25, t);
      const end = Math.max(...s.map((x) => x.out));
      run(join, [...s, { e: { type: 'gone', ch: k, t: end + 45 }, out: end + 45 }], t - 0.5, end + 45.5);
      most = Math.max(most, join.size.live + join.size.ended);
      t = end + 70;
    }
    expect(t).toBeGreaterThan(3600);
    expect(most).toBeLessThanOrEqual(KEEP_ENDED + 1);
    // A pitch comes back after 39 others: by then its signal is no longer kept, so each station is a signal of its own.
    expect(join.list().map((s) => s.text)).toEqual(Array.from({ length: KEEP_ENDED }, (_, i) => `CQ DE ${49 - i}B K`));
  }, 120_000);
});
