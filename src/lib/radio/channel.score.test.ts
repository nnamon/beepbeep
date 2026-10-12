// The channel decoder's scorecard: every band scenario (scenarios.ts) read
// channel by channel from the truth of every mark (no audio), by today's way
// and by the channel decoder (channel.ts), and scored (score.ts).
//
// Today's way is the decoder for your own keying: a plain Decoder, glitches
// and held keys dropped, each over ended after 3 seconds without a mark and
// read again as a whole (as radio.test.ts runs it).
//
// Three sets of channels:
//  - clean: one channel per station, every mark exactly as sent;
//  - merged: the same, with the two stations of a QSO on one channel, as a
//    detector usually gives them (only the QSO scenarios differ);
//  - perturbed: merged, and each mark as a detector errs (perturb.ts): edges
//    moved by 5 to 15% of a dit, 1 to 5% of marks lost, 2% cut in two by a
//    fade, a false mark every 5 seconds; and a channel of noise alone for each
//    scenario without stations.
//
// The numbers are printed, not checked, except that the clean machine-sent
// stations must read nearly perfectly.
//
// It takes several minutes, so it runs only when asked: RADIO_CHANNEL=1 runs
// every scenario, RADIO=name,name only those whose names start with one of
// these. RADIO_SHOW=1 prints what each channel read. RADIO_LM=off reads
// without the language model and word evidence (settle.ts), for checking
// that they help on the air's text. RADIO_LONG=minutes runs one channel that
// long instead, printing the time per mark and the window every 10 minutes.
// RADIO_QSO=1 runs QSOs whose stations answer within a second, where only
// the speed shows the turnover.

import { afterAll, describe, expect, it } from 'vitest';
import { keySend, renderBand, type StationTruth } from './band';
import { SCENARIOS, type Scenario } from './scenarios';
import { scoreBand, type BandScore, type Signal } from './score';
import { channelsOf, feed, joinMarks, noiseChannel, perturb, qsoPairs, today, type DetectorErrors, type Mark, type TestChannel } from './perturb';
import { ChannelDecoder, channelTuning } from './channel';
import { tuning } from '../decoder/settle';
import { editDistance, textTokens } from '../util/text';
import { mulberry32 } from '../util/random';

const ERRORS: DetectorErrors[] = [0.05, 0.1, 0.15].map((jitter, i) => ({ jitter, drop: [0.01, 0.03, 0.05][(i + 1) % 3], split: 0.02, falsePerSec: 0.2 }));

function chosen(): Scenario[] {
  const want = process.env.RADIO;
  if (!want) return process.env.RADIO_CHANNEL ? SCENARIOS : [];
  const names = want.split(',').map((s) => s.trim().toLowerCase());
  return SCENARIOS.filter((s) => names.some((n) => s.name.toLowerCase().startsWith(n)));
}

if (process.env.RADIO_LM === 'off') Object.assign(tuning, { lmWeight: 0, wordBonus: 0, repeatBonus: 0, groups: 0 });

interface Total {
  errors: number;
  length: number;
  falseChars: number;
  good: number;
  stations: number;
}
const blank = (): Total => ({ errors: 0, length: 0, falseChars: 0, good: 0, stations: 0 });
function add(into: Total, s: BandScore) {
  into.errors += s.errors;
  into.length += s.length;
  into.falseChars += s.falseChars;
  into.good += s.stations.filter((x) => x.cer < 0.1).length;
  into.stations += s.stations.length;
}

const SETS = ['clean', 'merged', 'perturbed'] as const;
type SetName = (typeof SETS)[number];
const TOTAL = Object.fromEntries(SETS.flatMap((s) => [[`${s} today`, blank()], [`${s} channel`, blank()]])) as Record<string, Total>;
/** Clean machine-sent stations only (the common case on air). */
const MACHINE = { today: blank(), channel: blank() };
const ROWS: string[] = [];
const READ: string[] = [];
const TIME = { today: 0, channel: 0, marks: 0 };
/** How long after a word ends it is written (the newest word of each write): seconds summed, writes, and the longest. */
const LAG = { sum: 0, n: 0, most: 0 };

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'none');
const col = (s: string | number, w: number, right = false) => (right ? String(s).padStart(w) : String(s).padEnd(w));

/** The channel decoder over one channel, measuring on clean channels how soon words are written. */
function channelText(marks: Mark[], lag: boolean): string {
  const dec = new ChannelDecoder({ inPlace: true });
  let last = -Infinity;
  return feed(dec, marks, {
    onTick: (t) => {
      const to = dec.footprint.writtenTo;
      if (!lag || to === last) return;
      last = to;
      LAG.sum += t - to;
      LAG.n++;
      LAG.most = Math.max(LAG.most, t - to);
    },
  });
}

function read(chs: TestChannel[], f: (m: Mark[]) => string, label: string): Signal[] {
  return chs.map((c) => {
    const t0 = performance.now();
    const text = f(c.marks);
    TIME[label as 'today' | 'channel'] += performance.now() - t0;
    if (label === 'channel') TIME.marks += c.marks.length;
    return { pitch: c.pitch, text };
  });
}

describe('radio scorecard: channel decoder against today', () => {
  const scenarios = chosen();
  if (!scenarios.length) it.skip('runs with RADIO_CHANNEL=1 or RADIO=name', () => {});
  scenarios.forEach((sc) => {
    const index = SCENARIOS.indexOf(sc);
    it(sc.name, () => {
      // Only the truth is used; a low sample rate renders it quickly.
      const band = renderBand(sc.band, 8000);
      const truth: StationTruth[] = band.truth;
      const paired = qsoPairs(truth, 40).length > 0;
      const sets: Record<SetName, TestChannel[]> = {
        clean: channelsOf(truth),
        merged: channelsOf(truth, { merge: true }),
        perturbed: channelsOf(truth, { merge: true, errors: ERRORS[index % 3], seed: 1000 + index }),
      };
      if (!truth.length) sets.perturbed.push({ pitch: 700, stations: [], marks: noiseChannel(band.seconds, 0.5, 2000 + index) });
      const scores: Record<string, BandScore> = {};
      for (const set of SETS) {
        if (set === 'merged' && !paired) {
          scores['merged today'] = scores['clean today'];
          scores['merged channel'] = scores['clean channel'];
        } else {
          const a = read(sets[set], today, 'today');
          const b = read(sets[set], (m) => channelText(m, set === 'clean'), 'channel');
          scores[`${set} today`] = scoreBand(truth, a);
          scores[`${set} channel`] = scoreBand(truth, b);
          if (process.env.RADIO_SHOW) {
            sets[set].forEach((c, i) => READ.push(`${sc.name} [${set}] ${c.stations.join('+') || 'noise'}\n  today:   ${a[i].text}\n  channel: ${b[i].text}`));
          }
        }
        add(TOTAL[`${set} today`], scores[`${set} today`]);
        add(TOTAL[`${set} channel`], scores[`${set} channel`]);
      }
      truth.forEach((t, i) => {
        if (t.keying !== 'machine') return;
        for (const k of ['today', 'channel'] as const) {
          const s = scores[`clean ${k}`].stations[i];
          MACHINE[k].errors += s.errors;
          MACHINE[k].length += s.length;
          MACHINE[k].stations++;
          if (s.cer < 0.1) MACHINE[k].good++;
        }
      });
      const cells = (i: number) => SETS.flatMap((set) => [scores[`${set} today`], scores[`${set} channel`]].map((s) => col(pct(s.stations[i].cer) + (s.stations[i].joined ? 'j' : ' '), 8, true)));
      if (!truth.length) {
        const f = SETS.flatMap((set) => [scores[`${set} today`], scores[`${set} channel`]].map((s) => col(`${s.falseChars}f `, 8, true)));
        ROWS.push(`${col(sc.name, 20)} ${col('none', 7)} ${col('', 5)} ${col('', 8)} ${f.join(' ')}`);
      } else {
        truth.forEach((t, i) => {
          const wpm = t.overallWpm ? `${t.wpm}/${t.overallWpm}` : String(t.wpm);
          ROWS.push(`${col(i ? '' : sc.name, 20)} ${col(t.name, 7)} ${col(wpm, 5, true)} ${col(t.keying, 8)} ${cells(i).join(' ')}`);
        });
        const falses = SETS.flatMap((set) => [scores[`${set} today`], scores[`${set} channel`]].map((s) => col(s.falseChars ? `${s.falseChars}f ` : '', 8, true)));
        if (falses.some((x) => x.trim())) ROWS.push(`${col('', 20)} ${col('false', 7)} ${col('', 5)} ${col('', 8)} ${falses.join(' ')}`);
      }
      // The common case on air must stay right: clean machine-sent text, one station to a channel.
      truth.forEach((t, i) => {
        if (t.keying === 'machine') expect(scores['clean channel'].stations[i].cer, `${sc.name} ${t.name}`).toBeLessThan(0.03);
      });
    }, 600_000);
  });

  afterAll(() => {
    if (!ROWS.length) return;
    const head = `${col('scenario', 20)} ${col('station', 7)} ${col('wpm', 5, true)} ${col('key', 8)} ${SETS.flatMap((s) => [col(`${s.slice(0, 5)} now`, 8, true), col(`${s.slice(0, 5)} chan`, 8, true)]).join(' ')}`;
    const tot = (x: Total) => `CER ${pct(x.errors / x.length)} (${x.errors} in ${x.length}), ${x.good} of ${x.stations} under 10%, ${x.falseChars} false`;
    console.log(
      `\nChannel decoder scorecard (${ROWS.length} rows): character error rate per station; "now": today's way, "chan": the channel decoder.\n` +
        `j: a QSO pair on one channel, scored against both sides in turn. f: false characters (text no station sent).\n\n` +
        `${head}\n${ROWS.join('\n')}\n\n` +
        SETS.map((s) => `${col(s, 9)} today:   ${tot(TOTAL[`${s} today`])}\n${col('', 9)} channel: ${tot(TOTAL[`${s} channel`])}`).join('\n') +
        `\nclean machine-sent stations: today ${pct(MACHINE.today.errors / MACHINE.today.length)}, channel ${pct(MACHINE.channel.errors / MACHINE.channel.length)} (${MACHINE.channel.stations} stations)\n` +
        `time: today ${(TIME.today / 1000).toFixed(1)} s, channel ${(TIME.channel / 1000).toFixed(1)} s (${((TIME.channel / Math.max(1, TIME.marks)) * 1000).toFixed(0)} µs a mark)\n` +
        `words are written (clean; the newest word of each write) ${(LAG.sum / Math.max(1, LAG.n)).toFixed(1)} s after they end on average, at most ${LAG.most.toFixed(1)} s\n` +
        (READ.length ? `\n${READ.join('\n')}\n` : ''),
    );
  });
});

// RADIO_LONG=minutes: one channel listening that long to the scenarios' stations
// one after another (QSOs, contests, a broadcast), each transmission 1 to 3
// seconds after the last, to show that time per mark and memory stay flat.
describe('radio long run: the channel decoder over many minutes', () => {
  const minutes = Number(process.env.RADIO_LONG ?? 0);
  if (!minutes) it.skip('runs with RADIO_LONG=minutes', () => {});
  else
    it(`${minutes} minutes`, () => {
      const sends: Mark[][] = [];
      for (const sc of SCENARIOS) for (const t of renderBand(sc.band, 8000).truth) for (const s of t.sends) sends.push(t.marks.filter((m) => m.start >= s.start && m.end <= s.end));
      const marks: Mark[] = [];
      let at = 1;
      for (let k = 0; at < minutes * 60; k++) {
        const s = sends[k % sends.length];
        for (const m of s) marks.push({ start: m.start - s[0].start + at, end: m.end - s[0].start + at });
        at = marks[marks.length - 1].end + 1 + 2 * ((k * 0.618) % 1);
      }
      const dec = new ChannelDecoder({ inPlace: true });
      const blocks: string[] = [];
      let t0 = performance.now();
      let n0 = 0;
      let most = 0;
      let block = 1;
      feed(dec, marks, {
        onMark: (n) => {
          most = Math.max(most, dec.footprint.marks);
          if (marks[n - 1].end < block * 600) return;
          const f = dec.footprint;
          blocks.push(`minutes ${(block - 1) * 10} to ${block * 10}: ${n - n0} marks, ${(((performance.now() - t0) / (n - n0)) * 1000).toFixed(0)} µs a mark, window at most ${most} marks, ${f.lines} lines, ${f.chars} characters`);
          t0 = performance.now();
          n0 = n;
          most = 0;
          block++;
        },
      });
      console.log(`\nLong run, ${minutes} minutes, ${marks.length} marks\n${blocks.join('\n')}\n`);
      expect(dec.text.length).toBeLessThanOrEqual(20000);
    }, 24 * 3600_000);
});

// RADIO_QSO=1: QSOs on one channel whose stations answer within a second (0.5,
// 0.6 or 0.8 s: shorter than an over's end, so only the speed shows the
// turnover), at six pairs of speeds, with and without the hand-over words,
// clean and with a detector's errors. Today's way, the channel decoder, and
// the channel decoder without the check for a change of speed.
describe('radio turnovers: two stations answering quickly on one channel', () => {
  if (!process.env.RADIO_QSO) it.skip('runs with RADIO_QSO=1', () => {});
  else
    it('six pairs of speeds', () => {
      const overs = [
        'CQ CQ DE JA1QRT JA1QRT K',
        'JA1QRT DE BV2KD BV2KD K',
        'BV2KD DE JA1QRT GM UR RST 579 579 NAME KENJI QTH TOKYO HW? KN',
        'R TNX KENJI UR 599 599 NAME WEI QTH TAIPEI RIG IC7300 73 KN',
        'TNX WEI FB QSO 73 <SK>',
        '73 TU EE',
      ];
      const plain = ['UR RST 579 579 NAME KENJI QTH TOKYO', 'R TNX KENJI UR 599 NAME WEI QTH TAIPEI', 'FB WEI RIG HR IC7300 ES DIPOLE', 'FB KENJI RIG HR FTDX10 ES YAGI WX SUNNY'];
      const keyedQso = (a: number, b: number, texts: string[], seed: number, errors: boolean): Mark[] => {
        const rng = mulberry32(seed);
        const out: Mark[] = [];
        let t = 0.6;
        texts.forEach((text, i) => {
          const wpm = i % 2 ? b : a;
          let ms = keySend({ name: 'X', pitch: 700, wpm, sends: [] }, text, i).map((m) => ({ start: m.start + t, end: m.end + t }));
          if (errors) ms = perturb(ms, 1.2 / wpm, { jitter: 0.1, drop: 0.03, split: 0.02, falsePerSec: 0.2 }, rng);
          out.push(...ms);
          t = ms[ms.length - 1].end + [0.5, 0.6, 0.8][i % 3];
        });
        return joinMarks(out);
      };
      const ways = ['today', 'channel', 'no split'] as const;
      const sum: Record<string, { e: number; n: number }> = {};
      const rows: string[] = [];
      for (const [a, b] of [
        [18, 26],
        [15, 30],
        [12, 28],
        [20, 24],
        [25, 25],
        [30, 16],
      ]) {
        for (const [kind, texts] of [
          ['QSO', overs],
          ['plain', plain],
        ] as const) {
          for (const errors of [false, true]) {
            for (const seed of errors ? [1, 2] : [1]) {
              const marks = keyedQso(a, b, texts, seed * 7 + a, errors);
              const want = textTokens(texts.join(' '));
              const cells = ways.map((way) => {
                const saved = channelTuning.change;
                if (way === 'no split') channelTuning.change = Infinity;
                const got = way === 'today' ? today(marks) : feed(new ChannelDecoder({ inPlace: true }), marks);
                channelTuning.change = saved;
                const e = editDistance(want, textTokens(got));
                const k = `${errors ? 'perturbed' : 'clean'} ${way}`;
                sum[k] = { e: (sum[k]?.e ?? 0) + e, n: (sum[k]?.n ?? 0) + want.length };
                return col(pct(e / want.length), 9, true);
              });
              rows.push(`${col(`${a}/${b}`, 6)} ${col(kind, 6)} ${col(errors ? `perturbed ${seed}` : 'clean', 12)} ${cells.join(' ')}`);
            }
          }
        }
      }
      console.log(
        `\nTurnovers within a second, character error rate (wpm of the station that starts / the other)\n${col('wpm', 6)} ${col('text', 6)} ${col('marks', 12)} ${ways.map((w) => col(w, 9, true)).join(' ')}\n${rows.join('\n')}\n\n` +
          Object.entries(sum)
            .map(([k, v]) => `${col(k, 20)} ${pct(v.e / v.n)} (${v.e} in ${v.n})`)
            .join('\n') +
          '\n',
      );
    }, 24 * 3600_000);
});
