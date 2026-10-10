// Shared plumbing for drills: playback with the learner's settings, band
// conditions, item stats and session records.

import { engine, type Playback } from '../audio/engine';
import { renderSchedule, type Conditions } from '../morse/render';
import { scheduleFromMarks, type FistOptions } from '../morse/schedule';
import { settings, strict } from '../state/settings.svelte';
import { TRACKS, levelById, type Level } from './courses';
import { addConfusion, addSession, getItems, putItem, type SessionRecord } from '../state/db';
import { newStat, recordAnswer, type ItemStat } from './srs';
import { randomSeed } from '../util/random';

export function currentLevel(): Level {
  return levelById(settings.level[settings.track]) ?? TRACKS[settings.track].levels[0];
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
export function playCw(text: string, o: PlayOpts = {}): Promise<Playback> {
  const sp = receiveSpeeds();
  return engine.playText(text, {
    charWpm: o.charWpm ?? sp.charWpm,
    effectiveWpm: o.effectiveWpm ?? (o.charWpm ? o.charWpm : sp.effectiveWpm),
    pitch: settings.pitch + (o.pitchOffset ?? 0),
    fist: o.plain ? undefined : fist(),
    ...(o.plain ? {} : conditions()),
    seed: randomSeed(),
  });
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
