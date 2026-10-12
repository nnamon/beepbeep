// Generated practice material: callsigns, groups, words and phrases, limited to
// the characters the learner knows when asked.

import { type Rng, pick, shuffle } from '../util/random';
import { callFrom, currentMix, pickCountry, type Mix } from './world';
import { ANTENNAS, CHUNKS, COMMON_WORDS, JOBS, NAMES, PHRASES, QSO_WORDS, RIGS, WEATHER, usesOnly } from './words';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export interface CallOptions {
  /** Where the stations come from (default: the mix set from Settings). */
  mix?: Mix;
  /** Only use these characters (retries until it fits, falls back to anything). */
  known?: Set<string>;
}

/** A callsign with a real prefix, from the areas you hear most. */
export function callsign(rng: Rng, opts: CallOptions = {}): string {
  const mix = opts.mix ?? currentMix();
  for (let attempt = 0; attempt < 60; attempt++) {
    const c = callFrom(rng, pickCountry(rng, mix));
    if (!opts.known || usesOnly(c, opts.known)) return c;
  }
  return callFrom(rng, pickCountry(rng, mix));
}

/**
 * A station's callsign and the region it sends (a US state, a Canadian
 * province, otherwise its country), from the same country.
 */
export function stationAndRegion(rng: Rng, known?: Set<string>): { call: string; region: string } {
  const mix = currentMix();
  let last = { call: '', region: '' };
  for (let attempt = 0; attempt < 60; attempt++) {
    const c = pickCountry(rng, mix);
    last = { call: callFrom(rng, c), region: pick(rng, c.places).region };
    if (!known || usesOnly(`${last.call} ${last.region}`, known)) return last;
  }
  return last;
}

/** Your station, as set in Settings. */
export interface Station {
  call: string;
  name: string;
  qth: string;
  /** State, province or country, as you send it. */
  state: string;
  skcc: string;
}

/**
 * A line about your own station to practise sending: your call, a CQ, an
 * answer, your name, QTH and region, a sign-off. Null without a callsign.
 */
export function stationLine(rng: Rng, you: Station): string | null {
  const up = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');
  const call = up(you.call);
  if (!call) return null;
  const name = up(you.name);
  const qth = up(you.qth);
  const region = up(you.state);
  const other = callsign(rng);
  const rst = pick(rng, ['599', '579', '559']);
  const lines = [
    call,
    `${call} ${call}`,
    `CQ CQ CQ DE ${call} ${call} K`,
    `${other} DE ${call} K`,
    `${other} DE ${call} GM TNX FER CALL UR RST ${rst} ${rst}`,
    `TNX FER QSO 73 ${other} DE ${call} <SK>`,
    ...(name ? [`NAME ${name} ${name}`, `OP ${name} ${name}`] : []),
    ...(qth ? [`QTH ${qth}${region ? ` ${region}` : ''}`, `QTH ${qth} ${qth}`] : []),
    ...(region ? [`TU 5NN ${region}`, `UR ${rst} ${region} ${region}`] : []),
  ];
  return pick(rng, lines);
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
  /** Region sent after the town: a US state, a province or a country. */
  state?: string;
}

/**
 * Fills a phrase template with a station from around the world (weighted to
 * the areas you hear most): its call, a local name, its town and region.
 */
export function fillPhrase(rng: Rng, template: string, f: Fillers = {}): string {
  const country = pickCountry(rng, currentMix());
  const place = pick(rng, country.places);
  return template
    .replaceAll('{CALL}', f.call ?? callFrom(rng, country))
    .replaceAll('{NAME}', f.name ?? pick(rng, country.names.length ? country.names : NAMES))
    .replaceAll('{QTH}', place.city)
    .replaceAll('{STATE}', f.state ?? place.region)
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
