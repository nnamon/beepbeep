// The Radio tab's multi-signal detector (detector.ts), scored on the band
// scenarios (scenarios.ts) at two levels.
//
// Marks: each station's truth marks against the marks of the channel nearest
// its pitch, matched by overlap. Found, missed, false (a channel's marks that
// match no station it holds), and the edge timing error of the marks found.
//
// Text: each channel's key events go into a plain Decoder of its own, as the
// app's single-signal pipeline runs it (radio.test.ts; `listenPlain` in
// listen.ts): glitches and held keys dropped, an over ending after 3 seconds
// without a mark and read again as a whole. Scored with score.ts, beside
// the single-signal pipeline Radio used until 0.4.0 (`TODAY`, from
// radio.test.ts on the commit this detector started from). The app reads
// each channel with its own decoder for the radio instead (join.ts,
// channel.ts): multi.score.test.ts scores that, the whole pipeline the
// screen gets, beside this.
//
// By default the scorecard runs a few scenarios that cover the detector's
// parts (`QUICK`) and checks they stay read: every station under 10%, and no
// text at all from the clips with no station. The whole set takes minutes
// (the decoder's reading of each over, not the detector, takes most of it):
// RADIO=all runs it, and RADIO=name,name only the scenarios whose names start
// with one of these. RADIO_LIVE=1 prints the live readings too. RADIO_SEED=n
// renders every scenario with other noise, static, voice and fading (machine
// keying keeps its timing): clips the detector was not tuned on. Today's
// column then still shows the clips as they are, and nothing is checked
// beyond the clips with no station.

import { afterAll, describe, expect, it } from 'vitest';
import { renderBand, type Band, type StationTruth } from './band';
import { SCENARIOS, type Scenario } from './scenarios';
import { scoreBand, type BandScore, type Signal } from './score';
import { RadioDetector, lifeTuning } from './detector';
import { BLOCK, listenPlain as listen, reseeded, type Heard, type Listening } from './listen';
import { gaussian, mulberry32 } from '../util/random';

const FS = 48000;

/**
 * Today's single-signal pipeline on each scenario, settled (radio.test.ts at
 * 45dacf2): edits and length per station; a QSO pair read as one signal
 * counts once, with both sides' length.
 */
const TODAY: Record<string, [string, number, number][]> = {
  'strong 15 wpm': [['VK2BHF', 0, 77]],
  'strong 20 wpm': [['DL4MKX', 0, 121]],
  'strong 25 wpm': [['PY2WQS', 0, 152]],
  'strong 30 wpm': [['OH6BVK', 0, 153]],
  'strong 35 wpm': [['ZS6WBK', 0, 208]],
  'weak 10 dB': [['9M2SKA', 0, 97]],
  'weak 6 dB': [['HL5FUA', 0, 87]],
  'weak 3 dB': [['ZL1RTE', 59, 92]],
  'weak 0 dB': [['5Z4LGT', 83, 88]],
  'deep QSB': [['YB1QRX', 34, 127]],
  'heavy QRN': [['VU2PTK', 6, 107]],
  'two at 80 Hz': [['F5NLJ', 33, 124], ['EA4GHT', 91, 91]],
  'two at 150 Hz': [['I2XQW', 7, 116], ['SP9LKV', 90, 90]],
  'two at 300 Hz': [['CE3FNP', 0, 97], ['XE1ROJ', 142, 142]],
  'QSO 12 Hz apart': [['JA1QRT', 14, 154], ['BV2KD', 14, 154]],
  'QSO 35 Hz apart': [['HS0ZDY', 22, 133], ['9V1XX', 22, 133]],
  'busy band': [['UA9CDT', 67, 67], ['OZ1JHM', 85, 129], ['SM5RYC', 89, 89], ['W2ZUV', 74, 74], ['VE3KQR', 87, 87]],
  'straight key 13 wpm': [['LU5DXK', 2, 79]],
  'bug 22 wpm': [['VE3KQR', 0, 120]],
  'broadcast 18/10': [['G4PRC', 0, 76]],
  drift: [['EI7HDK', 0, 146]],
  chirp: [['LZ1KDP', 27, 86]],
  'voice nearby': [['CT1EHK', 68, 107]],
  'noise only': [],
  'noise and QRN only': [],
  'noise and voice only': [],
};
const TODAY_JOINED = new Set(['QSO 12 Hz apart', 'QSO 35 Hz apart']);

interface StationMarks {
  name: string;
  /** The channel it was matched to, or null if none is within 30 Hz. */
  channel: number | null;
  truth: number;
  found: number;
  missed: number;
  /** Edge errors of the marks found, ms: mean and 90th percentile of |error|, and the mean signed error. */
  mean: number;
  p90: number;
  bias: number;
}

/** Truth marks against the marks of the channel nearest each station's pitch. */
function scoreMarks(truth: StationTruth[], channels: Heard[]): { stations: StationMarks[]; falseMarks: number[] } {
  const away = (hz: number, [lo, hi]: [number, number]) => (hz < lo ? lo - hz : hz > hi ? hz - hi : 0);
  const owner = truth.map((t) => {
    let best = -1;
    let near = 30;
    channels.forEach((c, i) => {
      const d = away(c.hz, t.pitchRange);
      if (d <= near) {
        best = i;
        near = d;
      }
    });
    return best;
  });
  const falseMarks = channels.map(() => 0);
  const stats: StationMarks[] = truth.map((t, i) => ({ name: t.name, channel: owner[i] < 0 ? null : channels[owner[i]].ch, truth: t.marks.length, found: 0, missed: t.marks.length, mean: NaN, p90: NaN, bias: NaN }));
  channels.forEach((c, ci) => {
    const mine = truth.map((_, i) => i).filter((i) => owner[i] === ci);
    const want = mine.flatMap((i) => truth[i].marks.map((m) => ({ ...m, station: i }))).sort((a, b) => a.start - b.start);
    const used = new Uint8Array(want.length);
    const errs = new Map<number, number[]>();
    const signed = new Map<number, number[]>();
    let j0 = 0;
    for (const m of c.marks) {
      while (j0 < want.length && want[j0].end < m.start) j0++;
      let best = -1;
      let most = 0;
      for (let j = j0; j < want.length && want[j].start < m.end; j++) {
        const overlap = Math.min(m.end, want[j].end) - Math.max(m.start, want[j].start);
        if (!used[j] && overlap > most) {
          most = overlap;
          best = j;
        }
      }
      if (best < 0) {
        falseMarks[ci]++;
        continue;
      }
      used[best] = 1;
      const w = want[best];
      const s = stats[w.station];
      s.found++;
      s.missed--;
      for (const e of [m.start - w.start, m.end - w.end]) {
        if (!errs.has(w.station)) {
          errs.set(w.station, []);
          signed.set(w.station, []);
        }
        errs.get(w.station)!.push(Math.abs(e) * 1000);
        signed.get(w.station)!.push(e * 1000);
      }
    }
    for (const [i, v] of errs) {
      v.sort((a, b) => a - b);
      stats[i].mean = v.reduce((a, b) => a + b, 0) / v.length;
      stats[i].p90 = v[Math.floor(0.9 * (v.length - 1))];
      const sv = signed.get(i)!;
      stats[i].bias = sv.reduce((a, b) => a + b, 0) / sv.length;
    }
  });
  return { stations: stats, falseMarks };
}

/** The scenario's band, or with other random sounds (RADIO_SEED). */
function bandOf(sc: Scenario): Band {
  return reseeded(sc.band, Number(process.env.RADIO_SEED ?? 0));
}

/** The scenarios `npm test` runs: strong, weak, static, two stations close together, a QSO, chirp, and two of the clips with no station. */
const QUICK = ['strong 25 wpm', 'weak 3 dB', 'heavy QRN', 'two at 80 Hz', 'QSO 35 Hz apart', 'chirp', 'noise and QRN only', 'noise and voice only'];

function chosen(): Scenario[] {
  const want = process.env.RADIO;
  if (want === 'all') return SCENARIOS;
  const names = (want ? want.split(',') : QUICK).map((s) => s.trim().toLowerCase());
  return SCENARIOS.filter((s) => names.some((n) => s.name.toLowerCase().startsWith(n)));
}

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'none');
const col = (s: string | number, w: number, right = false) => (right ? String(s).padStart(w) : String(s).padEnd(w));

describe('radio detector', () => {
  it('gives two stations 150 Hz apart a channel each, at their pitches', () => {
    const band: Band = {
      stations: [
        { name: 'A', pitch: 600, wpm: 20, sends: [{ text: 'CQ CQ DE 9V1XX 9V1XX K', at: 0.5 }] },
        { name: 'B', pitch: 750, wpm: 16, levelDb: -6, sends: [{ text: 'VK2BHF DE JA1QRT UR 579 K', at: 1.2 }] },
      ],
      noise: { snrDb: 20 },
      seed: 5,
    };
    const { samples, truth } = renderBand(band, FS);
    const heard = listen(samples, FS);
    expect(heard.channels.length).toBe(2);
    const marks = scoreMarks(truth, heard.channels);
    for (const s of marks.stations) {
      expect(s.channel).not.toBeNull();
      expect(s.found / s.truth).toBeGreaterThan(0.97);
      expect(s.mean).toBeLessThan(5);
    }
    expect(marks.falseMarks.every((n) => n === 0)).toBe(true);
    const score = scoreBand(truth, heard.channels.map((c) => ({ pitch: c.hz, text: c.settled })));
    expect(score.errors).toBe(0);
  });

  it('finds nothing in noise alone', () => {
    const { samples } = renderBand({ stations: [], seconds: 15, noise: { snrDb: 6 }, passband: [300, 2700], seed: 9 }, FS);
    const heard = listen(samples, FS);
    expect(heard.events.filter((e) => e.type === 'signal')).toEqual([]);
  });

  it('gives a steady carrier no channel, and still finds a station beside it', () => {
    // Someone tuning up: an unkeyed carrier at 600 Hz for 20 seconds, as loud as the station at 900 Hz.
    const { samples } = renderBand({ stations: [{ name: 'A', pitch: 900, wpm: 20, sends: [{ text: 'CQ CQ DE 9V1XX K', at: 4 }] }], seconds: 22, noise: { snrDb: 15 }, passband: [300, 2700], seed: 44 }, FS);
    for (let i = 0; i < 20 * FS; i++) samples[i] += 0.03 * Math.sin((2 * Math.PI * 600 * i) / FS);
    const heard = listen(samples, FS);
    expect(heard.channels.map((c) => [Math.round(c.hz / 10) * 10, c.settled])).toEqual([[900, 'CQ CQ DE 9V1XX K']]);
  });

  it('hears stations after digital silence: the first moments of a microphone stream, and a muted input', () => {
    // In the browser a microphone stream begins with exact zeros (about 20 ms in Chrome); a muted input gives seconds of them.
    const band: Band = { stations: [{ name: 'A', pitch: 650, wpm: 20, sends: [{ text: 'CQ CQ DE 9V1NE K', at: 1 }, { text: 'TEST K', at: 16 }] }], noise: { snrDb: 20 }, passband: [300, 2700], seed: 12 };
    const { samples, truth } = renderBand(band, FS);
    // Muted for 3 seconds between the two sends.
    const muted = truth[0].sends[0].end + 1;
    expect(truth[0].sends[1].start).toBeGreaterThan(muted + 4);
    for (let i = 0; i < 0.025 * FS; i++) samples[i] = 0;
    for (let i = Math.round(muted * FS); i < (muted + 3) * FS; i++) samples[i] = 0;
    const heard = listen(samples, FS);
    expect(heard.channels.map((c) => c.settled)).toEqual(['CQ CQ DE 9V1NE K TEST K']);
    // Passed on within 2 seconds of its first mark.
    expect(heard.liveAt.get(heard.channels[0].ch)! - truth[0].marks[0].start).toBeLessThan(2);
  });

  it('hears stations at once when the input gets much louder: the volume turned up after Start', () => {
    // 10 seconds of a quiet input (-100 dBFS of hiss), then the radio's audio.
    const band: Band = { stations: [{ name: 'A', pitch: 650, wpm: 20, sends: [{ text: 'CQ CQ DE 9V1NE K', at: 1 }, { text: 'TEST K', at: 12 }] }], noise: { snrDb: 20 }, passband: [300, 2700], seed: 12 };
    const { samples, truth } = renderBand(band, FS);
    const rng = mulberry32(3);
    const lead = 10 * FS;
    const all = new Float32Array(lead + samples.length);
    for (let i = 0; i < lead; i++) all[i] = 1e-5 * gaussian(rng);
    all.set(samples, lead);
    const heard = listen(all, FS);
    expect(heard.channels.map((c) => c.settled)).toEqual(['CQ CQ DE 9V1NE K TEST K']);
    expect(heard.liveAt.get(heard.channels[0].ch)! - (10 + truth[0].marks[0].start)).toBeLessThan(2);
  });

  it('drops a channel that has been silent long enough, and only then', () => {
    const was = lifeTuning.gone;
    lifeTuning.gone = 6;
    try {
      const band: Band = { stations: [{ name: 'A', pitch: 700, wpm: 20, sends: [{ text: 'CQ DE 9M2SKA K', at: 0.5 }, { text: 'TEST K', at: 11 }] }], seconds: 25, noise: { snrDb: 20 }, seed: 6 };
      const { samples, truth } = renderBand(band, FS);
      const heard = listen(samples, FS);
      const gone = heard.events.filter((e) => e.type === 'gone');
      // A pause of about 5 seconds keeps the channel; 6 seconds after the last mark it goes.
      expect(gone.length).toBe(1);
      const last = truth[0].marks[truth[0].marks.length - 1].end;
      expect(gone[0].t).toBeGreaterThan(last + 6);
      expect(gone[0].t).toBeLessThan(last + 7);
      expect(heard.channels.map((c) => c.settled)).toEqual(['CQ DE 9M2SKA K TEST K']);
    } finally {
      lifeTuning.gone = was;
    }
  });

  it('reads at 44.1 kHz as at 48 kHz', () => {
    const band: Band = {
      stations: [
        { name: 'A', pitch: 640, wpm: 22, sends: [{ text: 'CQ CQ DE ZL1RTE K', at: 0.5 }] },
        { name: 'B', pitch: 820, wpm: 18, levelDb: -6, sends: [{ text: 'TNX FER CALL 73', at: 1 }] },
      ],
      noise: { snrDb: 12 },
      passband: [300, 2700],
      seed: 8,
    };
    const { samples, truth } = renderBand(band, 44100);
    const heard = listen(samples, 44100);
    const score = scoreBand(truth, heard.channels.map((c) => ({ pitch: c.hz, text: c.settled })));
    expect(score.stations.map((x) => x.cer)).toEqual([0, 0]);
    expect(score.falseChars).toBe(0);
  });

  it('runs well inside real time with five stations', () => {
    // The busy band: five stations, the best of three runs. A phone is
    // several times slower than this machine, so a tenth of a core here is
    // the most to allow. It is this process's CPU time, not the clock's:
    // other tests running on the machine take the clock, not this process's
    // CPU. In an AudioWorklet each call has 2.7 ms (128 samples at 48 kHz):
    // the clock's time per call is printed too, from the last run (a new
    // channel hears the buffered audio over many calls, not in one).
    const { samples, seconds } = renderBand(SCENARIOS.find((s) => s.name === 'busy band')!.band, FS);
    const cpu = () => {
      const u = process.cpuUsage();
      return (u.user + u.system) / 1e6;
    };
    let best = Infinity;
    let calls: number[] = [];
    for (let run = 0; run < 3; run++) {
      const live = new Set<number>();
      const det = new RadioDetector(FS, { onChannel: (c) => c.what === 'live' && live.add(c.ch) });
      calls = [];
      const c0 = cpu();
      for (let i = 0; i < samples.length; i += BLOCK) {
        const t1 = performance.now();
        det.process(samples.subarray(i, i + BLOCK));
        calls.push(performance.now() - t1);
      }
      best = Math.min(best, cpu() - c0);
      expect(live.size).toBe(5);
    }
    calls.sort((a, b) => a - b);
    const q = (p: number) => calls[Math.floor(p * (calls.length - 1))].toFixed(2);
    console.log(`Real time: ${(best / seconds).toFixed(4)} s of CPU per second of 48 kHz audio with five stations; a call of 128 samples took ${q(0.5)} ms (median), ${q(0.99)} ms (99th percentile) by the clock`);
    expect(best / seconds).toBeLessThan(0.1);
  }, 120_000);

  it('shows the spectrum over the band', () => {
    const det = new RadioDetector(FS);
    det.process(new Float32Array(FS));
    const { hz, db } = det.spectrum();
    expect(hz.length).toBe(db.length);
    expect(hz[0]).toBeLessThanOrEqual(220);
    expect(hz[hz.length - 1]).toBeGreaterThanOrEqual(2980);
  });
});

const ROWS: string[] = [];
const MARK_ROWS: string[] = [];
const READ: string[] = [];
const TOTAL = { before: { errors: 0, length: 0, good: 0 }, after: { errors: 0, length: 0, good: 0, falseChars: 0 }, live: { errors: 0, length: 0 }, stations: 0, scenarios: 0, seconds: 0, detectorSec: 0, lags: [] as number[] };

describe('radio scorecard: the multi-signal detector', () => {
  for (const sc of chosen()) {
    it(sc.name, () => {
      const band = renderBand(bandOf(sc), FS);
      const heard = listen(band.samples, FS);
      const settled: Signal[] = heard.channels.map((c) => ({ pitch: c.hz, text: c.settled }));
      const s = scoreBand(band.truth, settled);
      const l = scoreBand(band.truth, heard.channels.map((c) => ({ pitch: c.hz, text: c.live })));
      const marks = scoreMarks(band.truth, heard.channels);
      TOTAL.scenarios++;
      TOTAL.seconds += band.seconds;
      TOTAL.detectorSec += heard.detectorSec;
      TOTAL.lags.push(...heard.lags);
      record(sc, band.seconds, band.truth, s, l, marks, heard);
      if (!band.truth.length) expect(s.falseChars).toBe(0);
      // The scenarios `npm test` runs stay read.
      if (!process.env.RADIO_SEED && QUICK.includes(sc.name)) for (const x of s.stations) expect(x.cer).toBeLessThan(0.1);
    }, 300_000);
  }

  afterAll(() => {
    if (!TOTAL.scenarios) return;
    const b = TOTAL.before;
    const a = TOTAL.after;
    console.log(
      `\nRadio scorecard: the multi-signal detector, ${TOTAL.scenarios} scenarios, ${TOTAL.seconds.toFixed(0)} s of audio${process.env.RADIO_SEED ? `, other sounds (RADIO_SEED=${process.env.RADIO_SEED})` : ''}.\n` +
        `Character error rate per station, settled: the single-signal pipeline (today: Radio until 0.4.0), then this detector with a plain decoder per channel; live after it.\n` +
        `j: a QSO pair read as one signal. false: characters in signals that are no station's. ch: channels passed on.\n\n` +
        `${HEAD}\n${ROWS.join('\n')}\n\n` +
        `Total, today:  CER ${pct(b.errors / b.length)} (${b.errors} edits in ${b.length}), ${b.good} of ${TOTAL.stations} stations under 10%, 0 false characters\n` +
        `Total, after:  CER ${pct(a.errors / a.length)} (${a.errors} edits in ${a.length}), ${a.good} of ${TOTAL.stations} stations under 10%, ${a.falseChars} false characters\n` +
        `Total, live:   CER ${pct(TOTAL.live.errors / TOTAL.live.length)}\n` +
        `Detector: ${TOTAL.detectorSec.toFixed(1)} s for ${TOTAL.seconds.toFixed(0)} s of 48 kHz audio (${(TOTAL.detectorSec / TOTAL.seconds).toFixed(4)} s per second)\n` +
        `Key events of channels already passed on came out behind the input they time by ${lagText(TOTAL.lags)}\n\n` +
        `Marks per station: found of all, missed, false (the channel's marks matching none of its stations), edge error of the marks found (ms): mean, 90th percentile, mean signed;\n` +
        `found: seconds from the station's first mark until its channel was passed on (its marks so far come with it).\n` +
        `${MARK_HEAD}\n${MARK_ROWS.join('\n')}\n\n` +
        `What it read (settled), per channel\n${READ.join('\n')}\n`,
    );
  });
});

function lagText(lags: number[]): string {
  const v = [...lags].sort((a, b) => a - b);
  const q = (p: number) => `${(1000 * v[Math.floor(p * (v.length - 1))]).toFixed(0)} ms`;
  return v.length ? `${q(0.5)} (median), ${q(0.99)} (99th percentile), ${q(1)} at most, over ${v.length} events` : 'nothing (no events)';
}

const HEAD = `${col('scenario', 20)} ${col('station', 7)} ${col('Hz', 5, true)} ${col('wpm', 5, true)} ${col('key', 8)} ${col('dB', 4, true)}  ${col('today', 7, true)} ${col('after', 7, true)}${col('', 2)} ${col('live', 7, true)}  ${col('false', 5, true)} ${col('ch', 3, true)}`;
const MARK_HEAD = `${col('scenario', 20)} ${col('station', 7)} ${col('found', 9, true)} ${col('missed', 6, true)} ${col('false', 5, true)} ${col('mean', 6, true)} ${col('p90', 6, true)} ${col('bias', 6, true)} ${col('found', 6, true)}`;

function record(sc: Scenario, seconds: number, truth: StationTruth[], s: BandScore, l: BandScore, marks: ReturnType<typeof scoreMarks>, heard: Listening) {
  const before = TODAY[sc.name] ?? [];
  const a = TOTAL.after;
  a.errors += s.errors;
  a.length += s.length;
  a.falseChars += s.falseChars;
  TOTAL.live.errors += l.errors;
  TOTAL.live.length += l.length;
  // Today: a joined pair counted once.
  const joinedToday = TODAY_JOINED.has(sc.name);
  before.forEach(([, e, n], i) => {
    if (joinedToday && i === 1) return;
    TOTAL.before.errors += e;
    TOTAL.before.length += n;
  });
  before.forEach(([, e, n]) => {
    if (e / n < 0.1) TOTAL.before.good++;
  });
  a.good += s.stations.filter((x) => x.cer < 0.1).length;
  TOTAL.stations += truth.length;
  const live = heard.channels.length;
  if (!truth.length) ROWS.push(`${col(sc.name, 20)} ${col('none', 7)} ${' '.repeat(52)}${col(s.falseChars, 5, true)} ${col(live, 3, true)}`);
  truth.forEach((t, i) => {
    const wpm = t.overallWpm ? `${t.wpm}/${t.overallWpm}` : String(t.wpm);
    const bt = before[i] ? before[i][1] / before[i][2] : NaN;
    const x = s.stations[i];
    ROWS.push(
      `${col(i ? '' : sc.name, 20)} ${col(t.name, 7)} ${col(t.pitch, 5, true)} ${col(wpm, 5, true)} ${col(t.keying, 8)} ${col(t.levelDb, 4, true)}  ${col(pct(bt), 7, true)} ${col(pct(x.cer), 7, true)}${col(x.joined ? ' j' : '', 2)} ${col(pct(l.stations[i].cer), 7, true)}  ${col(i ? '' : s.falseChars, 5, true)} ${col(i ? '' : live, 3, true)}`,
    );
  });
  const chanFalse = new Map<number, number>();
  heard.channels.forEach((c, i) => chanFalse.set(c.ch, marks.falseMarks[i]));
  marks.stations.forEach((m, i) => {
    const f = m.channel === null ? '' : String(chanFalse.get(m.channel) ?? 0);
    if (m.channel !== null) chanFalse.delete(m.channel);
    const ms = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : 'none');
    const at = m.channel === null ? undefined : heard.liveAt.get(m.channel);
    const after = at === undefined ? 'never' : Math.max(0, at - truth[i].marks[0].start).toFixed(1);
    MARK_ROWS.push(`${col(i ? '' : sc.name, 20)} ${col(m.name, 7)} ${col(`${m.found}/${m.truth}`, 9, true)} ${col(m.missed, 6, true)} ${col(f, 5, true)} ${col(ms(m.mean), 6, true)} ${col(ms(m.p90), 6, true)} ${col(ms(m.bias), 6, true)} ${col(after, 6, true)}`);
  });
  // Channels that hold no station.
  for (const [ch, n] of chanFalse) {
    const c = heard.channels.find((x) => x.ch === ch)!;
    MARK_ROWS.push(`${col(truth.length ? '' : sc.name, 20)} ${col(`${c.hz.toFixed(0)} Hz`, 7)} ${col('', 9)} ${col('', 6)} ${col(n, 5, true)}   (a channel at no station)`);
  }
  for (const c of heard.channels) {
    READ.push(`${sc.name} @${c.hz.toFixed(0)}: ${c.settled || '(nothing)'}`);
    if (process.env.RADIO_LIVE) READ.push(`${sc.name} @${c.hz.toFixed(0)} live: ${c.live || '(nothing)'}`);
  }
  if (!heard.channels.length) READ.push(`${sc.name}: (no channel)`);
}
