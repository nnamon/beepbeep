// What stored progress looks like, checked field by field. An export file is
// read through these checks before anything is replaced, and the screens that
// show progress read stored values through them, so a damaged or hand-edited
// value can't break a screen.

import { logOf, NEW_HEAT, type ItemStat } from '../train/srs';
import type { FistReport } from '../train/fist';
import type { SlipCounts } from '../train/session';
import type { QsoRecord, SessionRecord } from './db';
import type { SavedText } from './texts';

export const DAMAGED = 'That export file is damaged. Nothing was changed.';

type Row = Record<string, unknown>;

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
/** Milliseconds since 1970 that a date can hold. */
const isTime = (v: unknown): v is number => isNum(v) && v >= 0 && v <= 8.64e15;

function damaged(): never {
  throw new Error(DAMAGED);
}

/**
 * A number the record must have. JSON writes a number that went wrong (NaN)
 * as null; that reads as `fallback`. Missing, or anything else, is damage.
 */
function need(v: unknown, fallback = 0): number {
  if (v === null) return fallback;
  return isNum(v) ? v : damaged();
}

/** Text the record should have; missing reads as empty. */
function text(v: unknown): string {
  if (v === undefined || v === null) return '';
  return isStr(v) ? v : damaged();
}

/** Leaves out an optional field that is there but of the wrong type. */
function optional(r: Row, key: string, ok: (v: unknown) => boolean) {
  if (r[key] !== undefined && !ok(r[key])) delete r[key];
}

const isId = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
const orNull = (ok: (v: unknown) => boolean) => (v: unknown) => v === null || ok(v);

// ---- Rows of an export file: damage the app can't use throws DAMAGED ----

export function itemRow(v: unknown): ItemStat {
  if (!isObj(v) || !isStr(v.key)) damaged();
  if (!Array.isArray(v.recent) || !v.recent.every(isNum)) damaged();
  const s: Row = { ...v, heat: need(v.heat, NEW_HEAT), seen: need(v.seen), correct: need(v.correct), avgMs: need(v.avgMs), lastSeen: need(v.lastSeen) };
  // The timestamped answers are optional: bad entries are left out.
  if (v.log !== undefined) {
    const log = logOf(v.log);
    if (log.length) s.log = log;
    else delete s.log;
  }
  return s as unknown as ItemStat;
}

export function sessionRow(v: unknown): SessionRecord {
  if (!isObj(v) || !isTime(v.at) || !isStr(v.mode) || typeof v.sending !== 'boolean') damaged();
  if (!(v.accuracy === undefined || v.accuracy === null || isNum(v.accuracy))) damaged();
  const s: Row = { ...v, seconds: need(v.seconds), items: need(v.items), wpm: need(v.wpm), accuracy: isNum(v.accuracy) ? v.accuracy : null };
  optional(s, 'id', isId);
  optional(s, 'track', isStr);
  optional(s, 'level', isStr);
  optional(s, 'effectiveWpm', isNum);
  optional(s, 'sentWpm', isNum);
  optional(s, 'ttrDelay', isNum);
  optional(s, 'recovery', orNull(isNum));
  optional(s, 'stretch', (x) => typeof x === 'boolean');
  if (s.fist !== undefined && s.fist !== null) {
    const f = fistOf(s.fist);
    if (f) s.fist = f;
    else delete s.fist;
  }
  return s as unknown as SessionRecord;
}

export function qsoRow(v: unknown): QsoRecord {
  if (!isObj(v) || !isTime(v.at)) damaged();
  const q: Row = { ...v };
  for (const k of ['format', 'opener', 'call', 'name', 'qth', 'state', 'rstSent', 'rstRcvd']) q[k] = text(v[k]);
  for (const k of ['seconds', 'overs', 'copyScore', 'sendScore', 'wpm']) q[k] = need(v[k]);
  optional(q, 'id', isId);
  return q as unknown as QsoRecord;
}

export function confusionRow(v: unknown): { pair: string; want: string; got: string; count: number; last: number } {
  if (!isObj(v) || !isStr(v.pair) || !isStr(v.want) || !isStr(v.got)) damaged();
  return { ...v, pair: v.pair, want: v.want, got: v.got, count: need(v.count), last: need(v.last) };
}

/** What each known setting-like value must look like; undefined when it can't be used. */
const KV: Record<string, (v: unknown) => unknown> = {
  texts: (v) => (Array.isArray(v) ? textsOf(v) : undefined),
  'pocket.custom': (v) => (isObj(v) ? customSetOf(v) : undefined),
  recentSends: (v) => (Array.isArray(v) ? sendsOf(v) : undefined),
  sendSlips: (v) => slipsOf(v) ?? undefined,
  today: (v) => (isObj(v) && isNum(v.day) && Array.isArray(v.ids) ? { day: v.day, ids: v.ids.filter(isStr) } : undefined),
  qsoLessons: (v) => (isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, n]) => isNum(n))) : undefined),
  farnsworthSince: (v) => (v === null || isNum(v) ? v : undefined),
};

/** A row of the kv store, its value checked when it is one the app reads; null leaves the row out. */
export function kvRow(v: unknown): { key: string; value: unknown } | null {
  if (!isObj(v) || !isStr(v.key)) damaged();
  const check = KV[v.key];
  if (!check) return { key: v.key, value: v.value };
  const value = check(v.value);
  return value === undefined ? null : { key: v.key, value };
}

// ---- Stored values as the screens read them: anything unusable is left out ----

const FIST_FIELDS = ['chars', 'unit', 'dahRatio', 'elemGap', 'charGap', 'wordGap', 'weighting', 'drift', 'ditSpread', 'clean'];

/** A timing report, or null if it isn't one: it needs a speed, and its other figures are numbers or missing. */
export function fistOf(v: unknown): FistReport | null {
  if (!isObj(v) || !isNum(v.wpm)) return null;
  if (!FIST_FIELDS.every((k) => v[k] === undefined || v[k] === null || isNum(v[k]))) return null;
  return v as unknown as FistReport;
}

/** The Pocket custom set: lists of text, empty where the stored value isn't one. */
export function customSetOf(v: unknown): { chars: string[]; words: string[] } {
  const o = isObj(v) ? v : {};
  const list = (x: unknown) => (Array.isArray(x) ? x.filter(isStr) : []);
  return { chars: list(o.chars), words: list(o.words) };
}

/** Saved texts that have an id, a name and their text. */
export function textsOf(v: unknown): SavedText[] {
  if (!Array.isArray(v)) return [];
  return v.filter((t): t is Row => isObj(t) && isStr(t.id) && isStr(t.name) && isStr(t.text)).map((t) => ({ ...t, at: isNum(t.at) ? t.at : 0 }) as SavedText);
}

export interface RecentSend {
  at: number;
  text: string;
  marks: { start: number; end: number }[];
}

/** Recent sends that have a time, the text and the marks. */
export function sendsOf(v: unknown): RecentSend[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (s): s is RecentSend =>
      isObj(s) && isNum(s.at) && isStr(s.text) && Array.isArray(s.marks) && s.marks.every((m) => isObj(m) && isNum(m.start) && isNum(m.end)),
  );
}

/** Spacing slip counts, a count of 0 where one isn't a number; null if it isn't a set of counts. */
export function slipsOf(v: unknown): SlipCounts | null {
  if (!isObj(v)) return null;
  const n = (x: unknown) => (isNum(x) ? x : 0);
  const pairs = isObj(v.pairs) ? Object.fromEntries(Object.entries(v.pairs).filter(([, c]) => isNum(c))) : {};
  return { 'merged-words': n(v['merged-words']), 'merged-letters': n(v['merged-letters']), 'split-letter': n(v['split-letter']), 'split-word': n(v['split-word']), pairs } as SlipCounts;
}
