// Band audio for testing the Radio tab: what a receiver's speaker or line-out
// gives when several CW stations are on at once, with the exact truth of what
// each one sent.
//
// Each station has its own pitch, speed, keying (machine, bug or straight
// key), level and start, and may fade (QSB), drift or chirp. Stations can take
// turns, as in a QSO (`qso`). The band adds receiver noise at an SNR measured
// in a stated bandwidth, static crashes (QRN), a talking voice nearby (the
// room-noise speech, standing in for SSB splatter) and, if asked, the
// receiver's audio filter. Tones come from the renderer the app plays its own
// audio with (render.ts); hand keying from the decoder tests' fists (fists.ts).
//
// Levels are in dB against a station at 0 dB (`REF_AMP`). The noise, the
// crashes and the voice are set against one station, `ref`.

import { addTone } from '../morse/render';
import { buildSchedule } from '../morse/schedule';
import { tokenize } from '../morse/code';
import { FISTS, keyText } from '../decoder/fists';
import { roomNoise } from '../dsp/roomnoise';
import { HighPass, LowPass } from '../dsp/biquad';
import { gaussian, mulberry32 } from '../util/random';

/** Peak amplitude of a station at 0 dB: about -30 dBFS, leaving room for louder stations, noise and crashes. */
export const REF_AMP = 0.03;

export type Keying = 'machine' | 'bug' | 'straight';

export interface Station {
  /** Callsign or other label, for the scorecard. */
  name: string;
  /** Tone pitch at the start of the clip, Hz. */
  pitch: number;
  /** Character speed, wpm. */
  wpm: number;
  /** Overall speed if slower (extra space between characters and words), wpm. Not for a straight key. */
  overallWpm?: number;
  /**
   * machine: exact timing (a keyboard or a memory keyer). bug: machine dits,
   * hand-timed dahs and gaps. straight: hand timing from one of the decoder
   * tests' fists, at this station's speed.
   */
  keying?: Keying;
  /** Straight key: the fist's name in fists.ts (default 'straight key, fair'). */
  fist?: string;
  /** Bug: spread of the hand-timed parts, as a fraction of a dit (default 0.1). */
  jitter?: number;
  /** Level against a station at 0 dB. */
  levelDb?: number;
  /** Fading: the level dips by up to `depth` (0 to 1) of its amplitude, about `rateHz` times a second. */
  qsb?: { depth: number; rateHz: number };
  /** Slow pitch drift, Hz per minute. */
  driftHzPerMin?: number;
  /** A pitch jump at each key-down that settles with time constant `tau` seconds. */
  chirp?: { hz: number; tau: number };
  /** Each transmission: its text and when its first mark starts, seconds from the start of the clip. */
  sends: { text: string; at: number }[];
  seed?: number;
}

export interface Band {
  stations: Station[];
  /** Clip length, seconds; by default 1.5 seconds after the last mark. */
  seconds?: number;
  /** The station the noise, crashes and voice are set against (default the first; 0 dB without stations). */
  ref?: string;
  /** Receiver noise: its power in `bandwidthHz` (default 500) is `snrDb` below the reference station's while it sends. */
  noise?: { snrDb: number; bandwidthHz?: number };
  /**
   * Static crashes, `ratePerSec` a second on average. At its peak a crash's
   * power in the noise bandwidth is up to `db` over the reference station's.
   */
  qrn?: { ratePerSec: number; db: number };
  /** A voice talking nearby: its RMS while talking against the reference station's while it sends, dB, before the receiver's filter. */
  voice?: { db: number };
  /** The receiver's audio filter, Hz: about 300 to 2700 for SSB, 400 to 900 for CW. */
  passband?: [number, number];
  seed?: number;
}

export interface Send {
  text: string;
  start: number;
  end: number;
}

export interface StationTruth {
  name: string;
  /** The pitch set, and the lowest and highest pitch while it sends (drift). */
  pitch: number;
  pitchRange: [number, number];
  wpm: number;
  overallWpm?: number;
  keying: Keying;
  levelDb: number;
  /** Everything it sent, transmissions joined by a space, as Morse tokens (prosigns as <XX>). */
  text: string;
  sends: Send[];
  /** Key-down and key-up of every mark, seconds from the start of the clip. */
  marks: { start: number; end: number }[];
}

export interface BandAudio {
  samples: Float32Array;
  sampleRate: number;
  seconds: number;
  truth: StationTruth[];
  /** Samples clipped at full scale (should be none). */
  clipped: number;
}

/** Text as it is keyed: canonical tokens, one space between words. */
export function keyedText(text: string): string {
  return tokenize(text).join('');
}

/** The marks of one transmission, the first starting at 0. `k` is its index among the station's sends. */
export function keySend(s: Station, text: string, k: number): { start: number; end: number }[] {
  const seed = (s.seed ?? 1) * 1000 + k;
  const keying = s.keying ?? 'machine';
  let marks: { start: number; end: number }[];
  if (keying === 'straight') {
    // The fists time their own gaps; an overall speed would be ignored without a word.
    if (s.overallWpm !== undefined) throw new Error(`${s.name}: an overall speed needs machine or bug keying`);
    const name = s.fist ?? 'straight key, fair';
    const fist = FISTS.find((f) => f.name === name);
    if (!fist) throw new Error(`no fist named ${name}`);
    marks = keyText(text, { ...fist, wpm: s.wpm }, seed);
  } else {
    const fist = keying === 'bug' ? { bug: true, jitter: s.jitter ?? 0.1, seed } : undefined;
    marks = buildSchedule(text, { charWpm: s.wpm, effectiveWpm: s.overallWpm, fist, leadIn: 0, tail: 0 }).marks;
  }
  const t0 = marks[0]?.start ?? 0;
  return marks.map((m) => ({ start: m.start - t0, end: m.end - t0 }));
}

/**
 * Two stations taking turns, as in a QSO: `overs` alternate between them,
 * starting with `a` at `start`, each answered 0.5 to 2 seconds after the last
 * one ends. Without seeds, the stations get `seed` and `seed + 1`.
 */
export function qso(a: Omit<Station, 'sends'>, b: Omit<Station, 'sends'>, overs: string[], start: number, seed: number): [Station, Station] {
  const rng = mulberry32(seed);
  const pair: [Station, Station] = [
    { ...a, seed: a.seed ?? seed, sends: [] },
    { ...b, seed: b.seed ?? seed + 1, sends: [] },
  ];
  let t = start;
  overs.forEach((text, i) => {
    const s = pair[i % 2];
    const marks = keySend(s, text, s.sends.length);
    s.sends.push({ text, at: t });
    t += marks[marks.length - 1].end + 0.5 + 1.5 * rng();
  });
  return pair;
}

const amplitude = (db: number) => Math.pow(10, db / 20);

export function renderBand(band: Band, sampleRate: number): BandAudio {
  const fs = sampleRate;
  const seed = band.seed ?? 1;
  const stations = band.stations.map((s, i) => ({ ...s, seed: s.seed ?? seed * 101 + i }));

  const truth: StationTruth[] = stations.map((s) => {
    const sends: Send[] = [];
    const marks: { start: number; end: number }[] = [];
    s.sends.forEach((send, k) => {
      const own = keySend(s, send.text, k).map((m) => ({ start: m.start + send.at, end: m.end + send.at }));
      if (!own.length) return;
      if (marks.length && own[0].start < marks[marks.length - 1].end) throw new Error(`${s.name}: transmissions overlap`);
      sends.push({ text: keyedText(send.text), start: own[0].start, end: own[own.length - 1].end });
      marks.push(...own);
    });
    const drift = (s.driftHzPerMin ?? 0) / 60;
    const a = s.pitch + drift * (marks[0]?.start ?? 0);
    const b = s.pitch + drift * (marks[marks.length - 1]?.end ?? 0);
    return {
      name: s.name,
      pitch: s.pitch,
      pitchRange: [Math.min(a, b), Math.max(a, b)],
      wpm: s.wpm,
      overallWpm: s.overallWpm,
      keying: s.keying ?? 'machine',
      levelDb: s.levelDb ?? 0,
      text: sends.map((x) => x.text).join(' '),
      sends,
      marks,
    };
  });

  const last = Math.max(0, ...truth.map((t) => t.marks[t.marks.length - 1]?.end ?? 0));
  const seconds = band.seconds ?? last + 1.5;
  if (last > seconds) throw new Error('a station sends past the end of the clip');
  const n = Math.ceil(seconds * fs);
  const out = new Float32Array(n);

  stations.forEach((s, i) => {
    const drift = s.driftHzPerMin ? { hzPerSec: s.driftHzPerMin / 60 } : undefined;
    const opts = { sampleRate: fs, pitch: s.pitch, qsb: s.qsb, chirp: s.chirp, drift };
    addTone(out, truth[i], s.pitch, REF_AMP * amplitude(s.levelDb ?? 0), opts, fs, mulberry32(s.seed + 7));
  });

  // The reference: a station's peak amplitude and its power while it sends.
  const refStation = band.ref === undefined ? stations[0] : stations.find((s) => s.name === band.ref);
  if (band.ref !== undefined && !refStation) throw new Error(`no station named ${band.ref}`);
  const refAmp = REF_AMP * amplitude(refStation?.levelDb ?? 0);
  const ps = (refAmp * refAmp) / 2;
  const bw = band.noise?.bandwidthHz ?? 500;
  // White noise of standard deviation sigma has sigma^2 * 2 * bw / fs of its power in bw.
  const sigmaFor = (power: number) => Math.sqrt((power * fs) / (2 * bw));

  if (band.voice) {
    const v = roomNoise('speech', seconds, fs, (refAmp / Math.SQRT2) * amplitude(band.voice.db), seed + 3);
    for (let i = 0; i < n && i < v.length; i++) out[i] += v[i];
  }

  if (band.qrn) {
    // Crashes come at random; a third are lightning with 2 to 4 strokes 20
    // to 170 ms apart. Each stroke is broadband noise that jumps up and dies
    // away with a time constant of 3 to 30 ms.
    const rng = mulberry32(seed + 2);
    const peak = sigmaFor(ps * Math.pow(10, band.qrn.db / 10));
    const wait = () => -Math.log(1 - rng()) / band.qrn!.ratePerSec;
    for (let t = wait(); t < seconds; t += wait()) {
      const strokes = rng() < 0.33 ? 2 + Math.floor(rng() * 3) : 1;
      let at = t;
      for (let k = 0; k < strokes; k++) {
        const tau = 0.003 * Math.pow(10, rng()) * fs;
        const g = peak * (0.3 + 0.7 * rng());
        const a = Math.floor(at * fs);
        for (let j = 0; j < 5 * tau && a + j < n; j++) out[a + j] += gaussian(rng) * g * Math.exp(-j / tau);
        at += 0.02 + 0.15 * rng();
      }
    }
  }

  if (band.noise) {
    const rng = mulberry32(seed + 1);
    const sigma = sigmaFor(ps / Math.pow(10, band.noise.snrDb / 10));
    for (let i = 0; i < n; i++) out[i] += gaussian(rng) * sigma;
  }

  if (band.passband) {
    // Fourth-order Butterworth at each edge: 24 dB an octave outside.
    const [lo, hi] = band.passband;
    const hp = [new HighPass(fs, lo, 0.5412), new HighPass(fs, lo, 1.3066)];
    const lp = [new LowPass(fs, hi, 0.5412), new LowPass(fs, hi, 1.3066)];
    for (let i = 0; i < n; i++) out[i] = lp[1].step(lp[0].step(hp[1].step(hp[0].step(out[i]))));
  }

  let clipped = 0;
  for (let i = 0; i < n; i++) {
    if (out[i] > 1 || out[i] < -1) {
      clipped++;
      out[i] = out[i] > 1 ? 1 : -1;
    }
  }
  return { samples: out, sampleRate: fs, seconds, truth, clipped };
}
