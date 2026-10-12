// The Radio tab's scorecard: every band scenario (scenarios.ts) decoded and
// scored (score.ts). For now it holds the "before": today's single-signal
// pipeline, the one that reads your own keying through the microphone, run
// as the app runs it (the detector in 128-sample blocks, key events into the
// decoder as live.ts passes them, glitches and held keys dropped). It locks
// to one pitch, so on a band it gives one signal, put at the median of the
// pitches it was locked to as its marks ended. Its overs end, as in the
// app's strict mode, after 3 seconds without a mark, and each is read again
// as a whole (settle.ts); the live reading is scored too.
//
// The numbers are printed, not checked: they are what later work is measured
// against. The test fails only if something breaks, or if the truth itself
// does not score as perfect.
//
// All scenarios take about 30 seconds on an idle machine. RADIO=name,name
// runs only those whose names start with one of these, for working on one
// kind of band.

import { afterAll, describe, expect, it } from 'vitest';
import { renderBand, type StationTruth } from './band';
import { SCENARIOS, type Scenario } from './scenarios';
import { scoreBand, type BandScore, type Signal } from './score';
import { Detector } from '../dsp/detector';
import { Decoder, isGlitch, isHeld, type DecoderOutput } from '../decoder/decoder';
import { outputsToText } from '../decoder/pipeline';

const FS = 48000;
/** Seconds without a mark that end an over (the app's default, settings.overTimeout). */
const OVER_END = 3;
/** The speed it starts from: the app's default sending speed (settings.sendWpm). */
const START_WPM = 15;

function chosen(): Scenario[] {
  const want = process.env.RADIO;
  if (!want) return SCENARIOS;
  const names = want.split(',').map((s) => s.trim().toLowerCase());
  return SCENARIOS.filter((s) => names.some((n) => s.name.toLowerCase().startsWith(n)));
}

interface Reading {
  /** Each over read again as a whole, and the live reading: one signal each, or none without a lock. */
  settled: Signal[];
  live: Signal[];
  /** The median of the pitches it was locked to as its marks ended (its last lock, with no marks). */
  pitch: number | null;
  /** Times the detector moved its lock to another pitch. */
  relocks: number;
}

/** Today's pipeline over a whole clip, as the AudioWorklet and live.ts run it. */
function today(samples: Float32Array, fs: number): Reading {
  const detector = new Detector(fs, { dit: 1.2 / START_WPM });
  const decoder = new Decoder({ initialWpm: START_WPM });
  const live: DecoderOutput[] = [];
  const settled: string[] = [];
  const pitches: number[] = [];
  let over: { start: number; end: number }[] = [];
  let downAt = 0;
  let down = false;
  let locks = 0;
  let lastDit = decoder.ditEstimate;
  const settle = () => {
    if (over.length) settled.push(outputsToText(Decoder.redecode(decoder.model(), over)));
    over = [];
  };
  for (let i = 0; i < samples.length; i += 128) {
    const events = detector.process(samples.subarray(i, Math.min(samples.length, i + 128)));
    for (const e of events) {
      if (e.type === 'lock') locks++;
      else if (e.type === 'status') live.push(...decoder.tick(e.t));
      else if (e.down) {
        down = true;
        downAt = e.t;
        live.push(...decoder.keyDown(e.t));
      } else {
        // As live.ts does: glitches and a key held down are dropped once, here.
        const d = e.t - downAt;
        if (!isGlitch(d, decoder.ditEstimate) && !isHeld(d, decoder.dahEstimate)) {
          over.push({ start: downAt, end: e.t });
          if (detector.pitch !== null) pitches.push(detector.pitch);
        }
        down = false;
        live.push(...decoder.keyUp(e.t));
      }
    }
    live.push(...decoder.tick(detector.time));
    // live.ts sends the speed to the worklet when it moves by more than 8%.
    const dit = decoder.ditEstimate;
    if (Math.abs(dit - lastDit) / dit > 0.08) {
      lastDit = dit;
      detector.setDit(dit);
    }
    if (!down && over.length && detector.time - over[over.length - 1].end >= OVER_END) settle();
  }
  live.push(...decoder.flush(detector.time + 10));
  settle();
  const sorted = [...pitches].sort((a, b) => a - b);
  const pitch = sorted.length ? sorted[sorted.length >> 1] : detector.pitch;
  return {
    settled: pitch === null ? [] : [{ pitch, text: settled.join(' ') }],
    live: pitch === null ? [] : [{ pitch, text: outputsToText(live) }],
    pitch,
    relocks: Math.max(0, locks - 1),
  };
}

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'none');

interface Total {
  errors: number;
  length: number;
  falseChars: number;
  /** Stations read with under 10% error, of all stations. */
  good: number;
  stations: number;
}

const ROWS: string[] = [];
const READ: string[] = [];
const TOTAL = { settled: blank(), live: blank(), seconds: 0, scenarios: 0, ms: 0 };

function blank(): Total {
  return { errors: 0, length: 0, falseChars: 0, good: 0, stations: 0 };
}

function add(into: Total, s: BandScore) {
  into.errors += s.errors;
  into.length += s.length;
  into.falseChars += s.falseChars;
  into.good += s.stations.filter((x) => x.cer < 0.1).length;
  into.stations += s.stations.length;
}

const col = (s: string | number, w: number, right = false) => (right ? String(s).padStart(w) : String(s).padEnd(w));
type Station = [call: string, hz: string, wpm: string, key: string, db: string, settled: string, joined: string, live: string];

/** One row of the table: the scenario (blank after its first station), a station, and the scenario's false text and lock. */
function row(scenario: [string, string], station: Station, after: [string, string]): string {
  const [name, seconds] = scenario;
  const [call, hz, wpm, key, db, settled, joined, live] = station;
  return (
    `${col(name, 20)} ${col(seconds, 3, true)}  ${col(call, 7)} ${col(hz, 5, true)} ${col(wpm, 5, true)} ${col(key, 8)} ${col(db, 4, true)}  ` +
    `${col(settled, 7, true)}${col(joined, 2, true)} ${col(live, 7, true)}  ${col(after[0], 5, true)}  ${after[1]}`
  ).trimEnd();
}

const HEAD = row(['scenario', 's'], ['station', 'Hz', 'wpm', 'key', 'dB', 'settled', '', 'live'], ['false', 'lock']);

function rows(sc: Scenario, seconds: number, truth: StationTruth[], s: BandScore, l: BandScore, r: Reading): string[] {
  const lock = r.pitch === null ? 'none' : `${r.pitch.toFixed(0)} Hz${r.relocks ? `, ${r.relocks} relocks` : ''}`;
  const scenario: [string, string] = [sc.name, seconds.toFixed(0)];
  const after: [string, string] = [String(s.falseChars), lock];
  if (!truth.length) return [row(scenario, ['none', '', '', '', '', '', '', ''], after)];
  return truth.map((t, i) => {
    const wpm = t.overallWpm ? `${t.wpm}/${t.overallWpm}` : String(t.wpm);
    const station: Station = [t.name, String(t.pitch), wpm, t.keying, String(t.levelDb), pct(s.stations[i].cer), s.stations[i].joined ? 'j' : '', pct(l.stations[i].cer)];
    return i ? row(['', ''], station, ['', '']) : row(scenario, station, after);
  });
}

describe("radio scorecard: today's single-signal pipeline", () => {
  for (const sc of chosen()) {
    it(sc.name, () => {
      const t0 = performance.now();
      const band = renderBand(sc.band, FS);
      // The truth read back scores as perfect: the scorer's own check.
      const perfect = scoreBand(band.truth, band.truth.map((t) => ({ pitch: t.pitch, text: t.text })));
      expect(perfect.errors).toBe(0);
      expect(perfect.falseChars).toBe(0);
      expect(perfect.stations.every((x) => x.cer === 0)).toBe(true);

      const r = today(band.samples, FS);
      for (const x of [...r.settled, ...r.live]) expect(Number.isFinite(x.pitch)).toBe(true);
      const s = scoreBand(band.truth, r.settled);
      const l = scoreBand(band.truth, r.live);
      add(TOTAL.settled, s);
      add(TOTAL.live, l);
      TOTAL.seconds += band.seconds;
      TOTAL.scenarios++;
      TOTAL.ms += performance.now() - t0;
      ROWS.push(...rows(sc, band.seconds, band.truth, s, l, r));
      READ.push(`${sc.name}: ${r.settled[0]?.text || '(nothing)'}`);
    }, 300_000);
  }

  afterAll(() => {
    if (!TOTAL.scenarios) return;
    const tot = (x: Total) =>
      `CER ${pct(x.errors / x.length)} (${x.errors} edits in ${x.length} characters), ${x.good} of ${x.stations} stations under 10%, ${x.falseChars} false characters`;
    console.log(
      `\nRadio scorecard: today's single-signal pipeline, ${TOTAL.scenarios} scenarios, ${TOTAL.seconds.toFixed(0)} s of audio, ${(TOTAL.ms / 1000).toFixed(1)} s to render and decode\n` +
        `Character error rate per station, settled (each over read again) and live; j: a QSO pair read as one signal, scored against both sides in turn.\n` +
        `false: characters in signals that are no station's.\n\n` +
        `${HEAD}\n${ROWS.join('\n')}\n\n` +
        `Total, settled: ${tot(TOTAL.settled)}\nTotal, live:    ${tot(TOTAL.live)}\n\n` +
        `What it read (settled)\n${READ.join('\n')}\n`,
    );
  });
});
