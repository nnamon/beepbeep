// Heat-based spaced repetition: each item carries a "heat"; misses and slow
// answers raise it, quick right answers cool it. Hot items come up more often,
// and an item just asked waits a few turns before it can return.

import type { Rng } from '../util/random';

export interface ItemStat {
  key: string;
  heat: number;
  seen: number;
  correct: number;
  /** Rolling mean answer time, ms. */
  avgMs: number;
  /** Last N outcomes, newest last (1 right, 0 wrong). */
  recent: number[];
  lastSeen: number;
  /**
   * Timestamped answers, newest last, for 7- and 30-day figures:
   * [time ms, 1 right / 0 wrong, value]. The value is the answer time in ms
   * for copying, and the timing error in thousandths for sending.
   */
  log?: [number, number, number][];
}

const LOG_SIZE = 120;

export const NEW_HEAT = 3;
const MAX_HEAT = 10;
const MIN_HEAT = 0.3;

export function newStat(key: string): ItemStat {
  return { key, heat: NEW_HEAT, seen: 0, correct: 0, avgMs: 0, recent: [], lastSeen: 0 };
}

/**
 * Records one answer. `slowMs` is the answer time considered slow for this
 * item (e.g. 1500 ms for a character, longer for words).
 */
export function recordAnswer(s: ItemStat, right: boolean, ms: number, slowMs: number, now = Date.now()): ItemStat {
  const next = { ...s, recent: [...s.recent, right ? 1 : 0].slice(-10) };
  next.log = [...(s.log ?? []), [now, right ? 1 : 0, Math.round(ms)] as [number, number, number]].slice(-LOG_SIZE);
  next.seen += 1;
  next.lastSeen = now;
  if (right) {
    next.correct += 1;
    next.avgMs = next.avgMs ? next.avgMs * 0.7 + ms * 0.3 : ms;
    const fast = ms < slowMs;
    next.heat = Math.max(MIN_HEAT, next.heat * (fast ? 0.65 : 0.9));
  } else {
    next.heat = Math.min(MAX_HEAT, next.heat * 1.6 + 1);
  }
  return next;
}

/** Recent accuracy 0..1 (null if never seen). */
export function accuracy(s: ItemStat): number | null {
  if (!s.recent.length) return null;
  return s.recent.reduce((a, b) => a + b, 0) / s.recent.length;
}

/**
 * Accuracy and mean value (answer time, or timing error) over answers since
 * `since`; the value averages right answers only. Null when there are none.
 */
export function windowStats(s: ItemStat | undefined, since: number): { n: number; accuracy: number; value: number | null } | null {
  const rows = (s?.log ?? []).filter(([t]) => t >= since);
  if (!rows.length) return null;
  const right = rows.filter(([, ok]) => ok);
  const vals = right.map(([, , v]) => v).filter((v) => v > 0);
  return {
    n: rows.length,
    accuracy: right.length / rows.length,
    value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
  };
}

/**
 * Picks the next item: weighted by heat, avoiding the last few asked. With
 * only a few items, fewer are held back, so at least half stay in the draw:
 * holding back all but one would make the order a fixed cycle you could
 * predict (K M K M), and a weak item could never come up more often.
 */
export function pickNext(rng: Rng, keys: readonly string[], stats: Map<string, ItemStat>, avoid: readonly string[] = []): string {
  if (keys.length === 1) return keys[0];
  const blocked = new Set(avoid.slice(avoid.length - Math.min(3, Math.floor((keys.length - 1) / 2))));
  const pool = keys.filter((k) => !blocked.has(k));
  const list = pool.length ? pool : keys;
  let total = 0;
  const w = list.map((k) => {
    const h = stats.get(k)?.heat ?? NEW_HEAT;
    total += h;
    return h;
  });
  let r = rng() * total;
  for (let i = 0; i < list.length; i++) {
    r -= w[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}
