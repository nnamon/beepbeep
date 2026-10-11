// Shared plumbing for drills: playback with the learner's settings, band
// conditions, item stats and session records.

import { engine, type Playback } from '../audio/engine';
import { renderSchedule, type Conditions } from '../morse/render';
import { scheduleFromMarks, type FistOptions } from '../morse/schedule';
import { settings, strict } from '../state/settings.svelte';
import { signal, startMic } from '../state/signal.svelte';
import type { LiveDecoder } from '../audio/live';
import { DEFAULT_CAROUSEL, KOCH_LEVELS, licwLevels, type Level, type TrackId } from './courses';
import { addConfusion, addSession, getItems, getKv, putItem, setKv, type SessionRecord } from '../state/db';
import { newStat, recordAnswer, type ItemStat } from './srs';
import { randomSeed } from '../util/random';
import { align, textTokens } from '../util/text';
import { charTimingError } from './fist';
import type { DecodedChar } from '../decoder/decoder';

let licwCache: { key: string; levels: Level[] } | null = null;

/** A track's levels. The LICW carousel runs from REA and KMY, or in a class from the groups you joined at. */
export function trackLevels(track: TrackId = settings.track): Level[] {
  if (track === 'koch') return KOCH_LEVELS;
  const c = settings.licwEnrolled ? settings.carousel : DEFAULT_CAROUSEL;
  const key = `${c.bc1}|${c.bc2}`;
  if (licwCache?.key !== key) licwCache = { key, levels: licwLevels(c) };
  return licwCache.levels;
}

export function currentLevel(): Level {
  const levels = trackLevels();
  return levels.find((l) => l.id === settings.level[settings.track]) ?? levels[0];
}

/** Speeds for receive drills: the level's speeds on the LICW track, settings otherwise. */
export function receiveSpeeds(): { charWpm: number; effectiveWpm: number } {
  if (settings.track === 'licw' && settings.useCourseSpeeds) {
    const l = currentLevel();
    return { charWpm: l.charWpm, effectiveWpm: l.effectiveWpm };
  }
  return { charWpm: settings.charWpm, effectiveWpm: Math.min(settings.effectiveWpm, settings.charWpm) };
}

export function conditions(): Conditions {
  const c: Conditions = {};
  const snr = [null, 20, 12, 6][settings.noise];
  if (snr !== null && snr !== undefined) c.noise = { snrDb: snr };
  if (settings.qsb > 0) c.qsb = { depth: settings.qsb * 0.3, rateHz: 0.35 };
  if (settings.qrm > 0) c.qrm = { text: 'CQ TEST DE W9XYZ W9XYZ TEST TEST', offsetHz: 220, relativeDb: settings.qrm === 1 ? -12 : -6, wpm: 24 };
  if (settings.qrn > 0) c.qrn = { ratePerSec: settings.qrn * 0.8, level: 1.2 };
  if (settings.chirp) {
    c.chirp = { hz: 18, tau: 0.03 };
    c.drift = { hzPerSec: 1.2 };
  }
  return c;
}

/** Human-sounding fist for generated code, unless strict beginners' practice. */
export function fist(): FistOptions | undefined {
  if (!settings.humanFist) return undefined;
  if (strict() && currentLevel().id.includes('-bc')) return undefined;
  return { jitter: 0.07, weight: 0.03, seed: randomSeed() };
}

export interface PlayOpts {
  charWpm?: number;
  effectiveWpm?: number;
  plain?: boolean;
  pitchOffset?: number;
}

/** Plays text as CW with the learner's pitch, speed and conditions. */
export async function playCw(text: string, o: PlayOpts = {}): Promise<Playback> {
  const sp = receiveSpeeds();
  const pb = await engine.playText(text, {
    charWpm: o.charWpm ?? sp.charWpm,
    effectiveWpm: o.effectiveWpm ?? (o.charWpm ? o.charWpm : sp.effectiveWpm),
    pitch: settings.pitch + (o.pitchOffset ?? 0),
    fist: o.plain ? undefined : fist(),
    ...(o.plain ? {} : conditions()),
    seed: randomSeed(),
  });
  vibrateRhythm(pb);
  return pb;
}

/** Vibrates the rhythm of a playback (Android browsers; iPhone has no vibration API). */
export function vibrateRhythm(pb: Playback) {
  if (!settings.vibrate || typeof navigator === 'undefined' || !('vibrate' in navigator) || !pb.schedule) return;
  const lead = Math.max(0, (pb.startTime - engine.now) * 1000);
  const pattern: number[] = [0];
  let t = 0;
  for (const m of pb.schedule.marks) {
    pattern.push(Math.max(0, m.start * 1000 - t) + (t === 0 ? lead : 0), (m.end - m.start) * 1000);
    t = m.end * 1000;
  }
  navigator.vibrate(pattern.map((x) => Math.round(x)));
}

/** Receive score that opens the next lesson: 90% on the Koch track, 80% on LICW. */
export function advanceThreshold(): number {
  return settings.track === 'licw' ? 0.8 : 0.9;
}

/** The lesson a receive score opens, or null (below the threshold, or the last lesson). */
export function lessonOpenedBy(accuracy: number): Level | null {
  if (accuracy < advanceThreshold()) return null;
  const levels = trackLevels();
  return levels[levels.findIndex((l) => l.id === currentLevel().id) + 1] ?? null;
}

/**
 * Keeps a running decoder on the input you choose while sending: switching to
 * the touch key from a drill brings up a key that works at once. Call from an
 * $effect that reads settings.input.
 */
export async function followInput(live: LiveDecoder | null) {
  const src = sendInput();
  if (!live || src === live.source) return;
  if (src === 'mic' && !signal.micOn && !(await startMic())) return;
  await live.switchSource(src);
}

/** True when beginner sending should use the straight key only (LICW strict, BC lessons). */
export function straightOnly(): boolean {
  return strict() && currentLevel().id.includes('-bc');
}

/** The keying input to use, honouring straight-key-first in strict beginner lessons. */
export function sendInput() {
  // The touch key is a straight key, so strict beginner lessons keep it.
  return straightOnly() && (settings.input === 'iambicA' || settings.input === 'iambicB') ? 'straight' : settings.input;
}

/**
 * Farnsworth taper: after a good receive session, raise effective speed one
 * step toward character speed. Always on in LICW strict mode; opt-in otherwise.
 * Not applied while the LICW lesson speeds are in use.
 */
export function maybeTaper(accuracy: number | null) {
  if (accuracy === null || accuracy < 0.85) return null;
  if (!(strict() || settings.autoTaper)) return null;
  if (settings.track === 'licw' && settings.useCourseSpeeds) return null;
  if (settings.effectiveWpm >= settings.charWpm) return null;
  settings.effectiveWpm = Math.min(settings.charWpm, settings.effectiveWpm + 1);
  return settings.effectiveWpm;
}

/** Days since extra (Farnsworth) spacing was turned on, or null when spacing is natural. */
export async function farnsworthDays(): Promise<number | null> {
  try {
    const wide = settings.effectiveWpm < settings.charWpm && !(settings.track === 'licw' && settings.useCourseSpeeds);
    const since = await getKv<number | null>('farnsworthSince', null);
    if (!wide) {
      if (since !== null) await setKv('farnsworthSince', null);
      return null;
    }
    if (since === null) {
      await setKv('farnsworthSince', Date.now());
      return 0;
    }
    return Math.floor((Date.now() - since) / 864e5);
  } catch {
    return null;
  }
}

export async function stats(prefix: string): Promise<Map<string, ItemStat>> {
  try {
    return await getItems(prefix);
  } catch {
    return new Map();
  }
}

export async function answer(
  map: Map<string, ItemStat>,
  key: string,
  right: boolean,
  ms: number,
  slowMs: number,
  confusion?: { want: string; got: string },
) {
  const s = recordAnswer(map.get(key) ?? newStat(key), right, ms, slowMs);
  map.set(key, s);
  try {
    await putItem(s);
    if (!right && confusion && confusion.got) await addConfusion(confusion.want, confusion.got);
  } catch {
    /* storage unavailable: keep in memory */
  }
  return s;
}

export async function saveSession(s: Omit<SessionRecord, 'at' | 'track' | 'level'>) {
  try {
    await addSession({ ...s, at: Date.now(), track: settings.track, level: settings.level[settings.track] });
  } catch {
    /* storage unavailable */
  }
}

export function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Plays measured marks back as clean CW: your own rhythm, exactly as sent. */
export async function playMarks(marks: { start: number; end: number }[]): Promise<Playback> {
  const ctx = await engine.ensure();
  const schedule = scheduleFromMarks(marks);
  const samples = renderSchedule(schedule, { sampleRate: ctx.sampleRate, pitch: settings.pitch, amplitude: 0.45 });
  return engine.play(samples, { schedule });
}

export interface SlipCounts {
  'merged-words': number;
  'merged-letters': number;
  'split-letter': number;
  'split-word': number;
  /** Letter pairs that ran together, e.g. "ET>A": count. */
  pairs: Record<string, number>;
}

/**
 * Records what a listener received for each character you sent, its timing
 * error (from the decoded characters, when given), and spacing slips.
 */
export async function recordSend(
  intended: string,
  received: string,
  issues: { kind: string; detail: string }[],
  chars: DecodedChar[] = [],
) {
  try {
    const map = await getItems('tx:');
    const got = textTokens(received);
    // Received tokens other than spaces line up one to one with the decoded characters.
    const charAt = (gi: number) => chars[got.slice(0, gi).filter((t) => t !== ' ').length];
    for (const o of align(textTokens(intended), got)) {
      if (o.op === 'match' && o.want !== ' ') {
        const c = charAt(o.gi);
        const err = c ? charTimingError(c) : null;
        await answer(map, `tx:${o.want}`, true, err === null ? 0 : Math.max(1, Math.round(err * 1000)), 1);
      } else if ((o.op === 'sub' || o.op === 'del') && o.want !== ' ') await answer(map, `tx:${o.want}`, false, 0, 1);
    }
    const slips = await getKv<SlipCounts>('sendSlips', { 'merged-words': 0, 'merged-letters': 0, 'split-letter': 0, 'split-word': 0, pairs: {} });
    for (const i of issues) {
      if (i.kind in slips) (slips as unknown as Record<string, number>)[i.kind]++;
      if (i.kind === 'merged-letters' || i.kind === 'split-letter') slips.pairs[i.detail] = (slips.pairs[i.detail] ?? 0) + 1;
    }
    await setKv('sendSlips', slips);
  } catch {
    /* storage unavailable */
  }
}

/** Keeps the timing of the last 8 sends when the setting is on (no audio). */
export async function keepSend(text: string, marks: { start: number; end: number }[]) {
  if (!settings.keepSends || !marks.length) return;
  try {
    const list = await getKv<{ at: number; text: string; marks: { start: number; end: number }[] }[]>('recentSends', []);
    const t0 = marks[0].start;
    list.unshift({ at: Date.now(), text, marks: marks.map((m) => ({ start: m.start - t0, end: m.end - t0 })) });
    await setKv('recentSends', list.slice(0, 8));
  } catch {
    /* storage unavailable */
  }
}
