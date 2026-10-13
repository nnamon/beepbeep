// The Radio tab's end-to-end scorecard: the app's own pipeline, as the screen
// gets it. Each scenario's audio (scenarios.ts) goes through the radio
// worklet's detector and batching (batch.ts) into the screen source's join
// (join.ts), one ChannelDecoder (channel.ts) per channel with its search run
// in place of the worker; at the end of the clip listening stops, and the
// screen's signals (`text + pending`) are scored (score.ts). Beside it, the
// same detector with a plain Decoder per channel (`listenPlain`, the
// detector's own scorecard in detector.test.ts).
//
// `npm test` runs the strong single stations and the clips with no station,
// and checks that every strong station reads with no error and that the
// clips with no station give no text. RADIO_APP=all runs all 26 scenarios,
// RADIO_APP=name,name only those whose names start with one of these. With
// RADIO_SEED=n every scenario is rendered with other noise, static, voice and
// fading (machine keying keeps its timing): clips the detector and decoders
// were not tuned on; then only the clips with no station are checked.
// RADIO_SHOW=1 prints what each signal read.

import { afterAll, describe, expect, it } from 'vitest';
import { renderBand, type StationTruth } from './band';
import { SCENARIOS, type Scenario } from './scenarios';
import { scoreBand, type BandScore } from './score';
import { listenApp, listenPlain, reseeded, type AppListening, type Listening } from './listen';

const FS = 48000;
const SEED = Number(process.env.RADIO_SEED ?? 0);
const QUICK = ['strong 15 wpm', 'strong 20 wpm', 'strong 25 wpm', 'strong 30 wpm', 'strong 35 wpm', 'noise only', 'noise and QRN only', 'noise and voice only'];

function chosen(): Scenario[] {
  const want = process.env.RADIO_APP;
  if (want === 'all') return SCENARIOS;
  const names = (want ? want.split(',') : QUICK).map((s) => s.trim().toLowerCase());
  return SCENARIOS.filter((s) => names.some((n) => s.name.toLowerCase().startsWith(n)));
}

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'none');
const col = (s: string | number, w: number, right = false) => (right ? String(s).padStart(w) : String(s).padEnd(w));

interface Total {
  errors: number;
  length: number;
  good: number;
  falseChars: number;
}
const blank = (): Total => ({ errors: 0, length: 0, good: 0, falseChars: 0 });
const TOTAL = { plain: blank(), app: blank(), stations: 0, scenarios: 0, seconds: 0, plainSec: 0, detectorSec: 0, joinSec: 0, marks: 0, withdrawn: 0, late: 0, dits: 0, mostLive: 0, mostEnded: 0 };
const ROWS: string[] = [];
const READ: string[] = [];

function add(t: Total, s: BandScore) {
  t.errors += s.errors;
  t.length += s.length;
  t.falseChars += s.falseChars;
  t.good += s.stations.filter((x) => x.cer < 0.1).length;
}

describe('radio scorecard: the app pipeline, end to end', () => {
  for (const sc of chosen()) {
    it(sc.name, () => {
      const band = renderBand(reseeded(sc.band, SEED), FS);
      const t0 = performance.now();
      const plain = listenPlain(band.samples, FS);
      TOTAL.plainSec += (performance.now() - t0) / 1000;
      const app = listenApp(band.samples, FS);
      const p = scoreBand(band.truth, plain.channels.map((c) => ({ pitch: c.hz, text: c.settled })));
      const a = scoreBand(band.truth, app.signals.map((s) => ({ pitch: s.pitch, text: s.text + s.pending })));
      record(sc, band.seconds, band.truth, p, a, plain, app);
      // The clips with no station give no text at all.
      if (!band.truth.length) {
        expect(a.falseChars).toBe(0);
        expect(app.signals.filter((s) => (s.text + s.pending).trim())).toEqual([]);
      }
      // A strong station on its own reads with no error, as one signal.
      if (!SEED && sc.name.startsWith('strong')) {
        for (const x of a.stations) expect(x.cer, `${sc.name} ${x.name}`).toBe(0);
        expect(a.falseChars).toBe(0);
      }
      // A key-down never comes out after its decoder's time has passed it.
      expect(app.counts.late).toBe(0);
    }, 600_000);
  }

  afterAll(() => {
    if (!TOTAL.scenarios) return;
    const line = (t: Total) => `CER ${pct(t.errors / t.length)} (${t.errors} edits in ${t.length}), ${t.good} of ${TOTAL.stations} stations under 10%, ${t.falseChars} false characters`;
    const per = (x: number) => (x / TOTAL.seconds).toFixed(4);
    console.log(
      `\nRadio scorecard, end to end: ${TOTAL.scenarios} scenarios, ${TOTAL.seconds.toFixed(0)} s of 48 kHz audio${SEED ? `, other sounds (RADIO_SEED=${SEED})` : ''}.\n` +
        `Character error rate per station. plain: the detector with a plain decoder per channel (detector.test.ts).\n` +
        `app: the app's pipeline (worklet batches, one channel decoder per channel), the screen's text when listening stops.\n` +
        `j: a QSO pair read as one signal. false: characters in signals that are no station's (plain/app). sig: channels or signals (plain/app).\n\n` +
        `${HEAD}\n${ROWS.join('\n')}\n\n` +
        `Total, plain: ${line(TOTAL.plain)}\n` +
        `Total, app:   ${line(TOTAL.app)}\n` +
        `Time: the app's detector and batching ${per(TOTAL.detectorSec)} s per second of audio, its join and decoders ${per(TOTAL.joinSec)} s per second; the plain pipeline ${per(TOTAL.plainSec)} s per second in all\n` +
        `Marks decoded ${TOTAL.marks}, withdrawn by the detector ${TOTAL.withdrawn}, key-downs late for their decoder ${TOTAL.late}; dits sent back ${TOTAL.dits}; at most ${TOTAL.mostLive} live and ${TOTAL.mostEnded} ended signals at once\n` +
        (READ.length ? `\nWhat the app read, per signal\n${READ.join('\n')}\n` : ''),
    );
  });
});

const HEAD = `${col('scenario', 20)} ${col('station', 7)} ${col('Hz', 5, true)} ${col('wpm', 5, true)} ${col('key', 8)} ${col('dB', 4, true)}  ${col('plain', 7, true)} ${col('app', 7, true)}${col('', 2)}  ${col('false', 7, true)} ${col('sig', 5, true)}`;

function record(sc: Scenario, seconds: number, truth: StationTruth[], p: BandScore, a: BandScore, plain: Listening, app: AppListening) {
  TOTAL.scenarios++;
  TOTAL.seconds += seconds;
  TOTAL.stations += truth.length;
  TOTAL.detectorSec += app.detectorSec;
  TOTAL.joinSec += app.joinSec;
  TOTAL.marks += app.counts.marks;
  TOTAL.withdrawn += app.counts.withdrawn;
  TOTAL.late += app.counts.late;
  TOTAL.dits += app.dits;
  TOTAL.mostLive = Math.max(TOTAL.mostLive, app.most.live);
  TOTAL.mostEnded = Math.max(TOTAL.mostEnded, app.most.ended);
  add(TOTAL.plain, p);
  add(TOTAL.app, a);
  const falses = `${p.falseChars}/${a.falseChars}`;
  const sigs = `${plain.channels.length}/${app.signals.length}`;
  if (!truth.length) ROWS.push(`${col(sc.name, 20)} ${col('none', 7)} ${' '.repeat(52)}${col(falses, 7, true)} ${col(sigs, 5, true)}`);
  truth.forEach((t, i) => {
    const wpm = t.overallWpm ? `${t.wpm}/${t.overallWpm}` : String(t.wpm);
    const x = a.stations[i];
    ROWS.push(
      `${col(i ? '' : sc.name, 20)} ${col(t.name, 7)} ${col(t.pitch, 5, true)} ${col(wpm, 5, true)} ${col(t.keying, 8)} ${col(t.levelDb, 4, true)}  ${col(pct(p.stations[i].cer), 7, true)} ${col(pct(x.cer), 7, true)}${col(x.joined ? ' j' : '', 2)}  ${col(i ? '' : falses, 7, true)} ${col(i ? '' : sigs, 5, true)}`,
    );
  });
  if (process.env.RADIO_SHOW) {
    for (const s of app.signals) READ.push(`${sc.name} @${s.pitch.toFixed(0)} (${s.wpm ? `${s.wpm.toFixed(0)} wpm` : 'speed not known'}):\n  ${(s.text + s.pending).replaceAll('\n', '\n  ') || '(nothing)'}`);
    if (!app.signals.length) READ.push(`${sc.name}: (no signal)`);
  }
}
