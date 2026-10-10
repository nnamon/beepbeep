// Generated practice material: callsigns, groups, words and phrases, limited to
// the characters the learner knows when asked.

import { type Rng, pick, shuffle } from '../util/random';
import {
  ANTENNAS, CHUNKS, COMMON_WORDS, JOBS, NAMES, PHRASES, QSO_WORDS, RIGS, STATES, STATE_CITIES,
  WEATHER, usesOnly,
} from './words';

const US_PREFIX_1 = ['K', 'W', 'N'];
const US_PREFIX_2 = ['AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AI', 'AJ', 'AK', 'KA', 'KB', 'KC', 'KD', 'KE', 'KF', 'KG', 'KI', 'KJ', 'KK', 'KM', 'KN', 'KO', 'KQ', 'KR', 'KS', 'KT', 'KU', 'KV', 'KW', 'KX', 'KY', 'KZ', 'NA', 'NB', 'NC', 'ND', 'NE', 'NF', 'NG', 'NI', 'NJ', 'NK', 'NM', 'NN', 'NO', 'NQ', 'NR', 'NS', 'NT', 'NU', 'NV', 'NW', 'NX', 'NY', 'NZ', 'WA', 'WB', 'WD', 'WG', 'WJ', 'WK', 'WN', 'WO', 'WQ', 'WR', 'WS', 'WT', 'WU', 'WV', 'WW', 'WX', 'WY', 'WZ'];
const DX_PREFIX = ['VE', 'VA', 'G', 'M', 'DL', 'DK', 'DJ', 'F', 'EA', 'I', 'IK', 'IZ', 'PA', 'ON', 'OH', 'SM', 'LA', 'OZ', 'SP', 'OK', 'OM', 'HA', 'YO', 'LZ', 'UA', 'UR', 'JA', 'JH', 'JR', 'VK', 'ZL', 'PY', 'LU', 'CE', 'XE', 'ZS', 'EI', 'GM', 'GW', 'HB9', 'OE', 'S5', '9A', 'YU', 'EI', 'CT', 'SV', 'TA', '4X', 'BV', 'HL', 'DU', 'YB', 'VU'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export interface CallOptions {
  /** Share of DX (non-US) callsigns, 0..1. */
  dx?: number;
  /** Only use these characters (retries until it fits, falls back to anything). */
  known?: Set<string>;
}

export function callsign(rng: Rng, opts: CallOptions = {}): string {
  for (let attempt = 0; attempt < 60; attempt++) {
    const c = rawCall(rng, opts.dx ?? 0.25);
    if (!opts.known || usesOnly(c, opts.known)) return c;
  }
  return rawCall(rng, opts.dx ?? 0.25);
}

function rawCall(rng: Rng, dx: number): string {
  const digit = String(Math.floor(rng() * 10));
  const suffix = (n: number) => Array.from({ length: n }, () => pick(rng, LETTERS)).join('');
  if (rng() < dx) {
    const p = pick(rng, DX_PREFIX);
    const hasDigit = /\d$/.test(p);
    return `${p}${hasDigit ? '' : digit}${suffix(1 + Math.floor(rng() * 3))}`;
  }
  const r = rng();
  if (r < 0.3) return `${pick(rng, US_PREFIX_1)}${digit}${suffix(3)}`; // 1x3
  if (r < 0.5) return `${pick(rng, US_PREFIX_2)}${digit}${suffix(3)}`; // 2x3
  if (r < 0.7) return `${pick(rng, US_PREFIX_1)}${digit}${suffix(2)}`; // 1x2
  if (r < 0.85) return `${pick(rng, US_PREFIX_2)}${digit}${suffix(2)}`; // 2x2
  if (r < 0.95) return `${pick(rng, US_PREFIX_1)}${digit}${suffix(1)}`; // 1x1-ish
  return `${pick(rng, US_PREFIX_2)}${digit}${suffix(1)}`; // 2x1
}

/** Random groups of known characters, e.g. for copy and recognition drills. */
export function groups(rng: Rng, known: readonly string[], count: number, size: () => number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = size();
    let g = '';
    for (let j = 0; j < n; j++) g += pick(rng, known);
    out.push(g);
  }
  return out;
}

export interface Fillers {
  call?: string;
  name?: string;
  state?: string;
}

export function fillPhrase(rng: Rng, template: string, f: Fillers = {}): string {
  const state = f.state ?? pick(rng, STATES);
  const cities = STATE_CITIES[state];
  return template
    .replaceAll('{CALL}', f.call ?? callsign(rng))
    .replaceAll('{NAME}', f.name ?? pick(rng, NAMES))
    .replaceAll('{QTH}', cities ? pick(rng, cities) : state)
    .replaceAll('{STATE}', state)
    .replaceAll('{RIG}', pick(rng, RIGS))
    .replaceAll('{ANT}', pick(rng, ANTENNAS))
    .replaceAll('{WX}', pick(rng, WEATHER))
    .replaceAll('{PWR}', pick(rng, ['5', '10', '50', '100']))
    .replaceAll('{RST}', pick(rng, ['599', '579', '569', '559', '449', '339']))
    .replaceAll('{AGE}', String(30 + Math.floor(rng() * 50)))
    .replaceAll('{JOB}', pick(rng, JOBS));
}

export type Material = 'characters' | 'chunks' | 'words' | 'callsigns' | 'phrases' | 'groups';

/** Practice items of a kind, restricted to the known characters when given. */
export function items(rng: Rng, kind: Material, known: Set<string> | null, count: number): string[] {
  const ok = (s: string) => !known || usesOnly(s, known);
  switch (kind) {
    case 'characters': {
      const chars = known ? [...known] : LETTERS;
      return Array.from({ length: count }, () => pick(rng, chars));
    }
    case 'chunks':
      return take(rng, CHUNKS.filter(ok), count);
    case 'words':
      return take(rng, [...QSO_WORDS, ...COMMON_WORDS].filter(ok), count);
    case 'callsigns':
      return Array.from({ length: count }, () => callsign(rng, { known: known ?? undefined }));
    case 'phrases': {
      const out: string[] = [];
      for (let i = 0; i < count * 20 && out.length < count; i++) {
        const p = fillPhrase(rng, pick(rng, PHRASES));
        if (ok(p)) out.push(p);
      }
      return out;
    }
    case 'groups': {
      const chars = known ? [...known] : LETTERS;
      return groups(rng, chars, count, () => 2 + Math.floor(rng() * 4));
    }
  }
}

function take(rng: Rng, list: string[], count: number): string[] {
  if (!list.length) return [];
  const out: string[] = [];
  while (out.length < count) out.push(...shuffle(rng, list));
  return out.slice(0, count);
}
