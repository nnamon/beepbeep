// Practice cards for the class exercises: what plays as CW and what the voice
// says. Cards come from the lesson (generated) or from your own text.

import { patternOf, tokenize } from '../morse/code';
import { type Rng, pick, shuffle } from '../util/random';
import { callsign, fillPhrase, groups } from './generate';
import { AFFIXES, BINOMIALS, COMMON_WORDS, PHRASES, QSO_WORDS, SENTENCES, STATES, usesOnly } from './words';

export interface Card {
  /** Sent as CW; empty for a card the voice only says. */
  cw: string;
  /** Said by the voice; empty for a card that is only sent. */
  speech: string;
}

/** CW as sent: upper case, characters with a Morse pattern, prosigns as <AR>. */
export function cwOf(text: string): string {
  return tokenize(text)
    .filter((t) => t === ' ' || patternOf(t))
    .join('');
}

/** Splits a line on spaces, keeping {…} blocks whole. */
function pieces(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of line) {
    if (ch === '{') depth++;
    if (ch === '}') depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Plain text is sent and said; {cw|speech} sends one part and says the other. */
function piece(p: string): Card {
  const m = /^\{([^|}]*)\|?([^|}]*)(?:\|[^}]*)?\}$/.exec(p);
  if (!m) return { cw: cwOf(p), speech: p };
  return { cw: cwOf(m[1]), speech: p.includes('|') ? m[2] : m[1] };
}

function join(parts: Card[]): Card {
  return {
    cw: parts.map((c) => c.cw).filter(Boolean).join(' '),
    speech: parts.map((c) => c.speech).filter(Boolean).join(' '),
  };
}

/**
 * Cards from your own text, one per line or one per word. Reads the markup of
 * Morse Browser files: {CQ|} sends CQ and says nothing; {|calling} says
 * "calling" without sending anything.
 */
export function cardsFromText(text: string, perLine: boolean): Card[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cards = perLine ? lines.map((l) => join(pieces(l).map(piece))) : lines.flatMap((l) => pieces(l).map(piece));
  return cards.filter((c) => c.cw || c.speech.trim());
}

/** What an exercise plays. */
export type Source =
  | 'new' // this group's characters
  | 'chars' // every known character, this group's more often
  | 'groups' // random groups of known characters
  | 'words'
  | 'multi' // two words at a time
  | 'phrases'
  | 'prosigns' // short phrases ending in a prosign
  | 'callsigns'
  | 'contest'
  | 'binomials'
  | 'affixes'
  | 'sentences'
  | 'alphabet'
  | 'numbers'
  | 'trigrams'
  | 'text'; // your own text

export interface MaterialOptions {
  rng: Rng;
  /** Characters you know, and those just added (BC carousel). */
  known: string[];
  added: string[];
  /** Letter pairs practised as a unit (BK). */
  words?: string[];
  count: number;
  /** Group size for 'groups'. */
  min?: number;
  max?: number;
}

const card = (s: string): Card => ({ cw: cwOf(s), speech: s });

function cycle(rng: Rng, list: string[], count: number): string[] {
  if (!list.length) return [];
  const out: string[] = [];
  while (out.length < count) out.push(...shuffle(rng, list));
  return out.slice(0, count);
}

/** Generated cards from your lesson's characters. Text cards come from cardsFromText. */
export function material(source: Exclude<Source, 'text'>, o: MaterialOptions): Card[] {
  const { rng, count } = o;
  const known = new Set(o.known);
  const fits = (s: string) => usesOnly(s, known);
  switch (source) {
    case 'new':
      return cycle(rng, [...o.added, ...(o.words ?? [])], count).map(card);
    case 'chars': {
      // Half from the newest group, half from everything known.
      const fresh = o.added.length ? o.added : o.known;
      return Array.from({ length: count }, (_, i) => (i % 2 ? pick(rng, fresh) : pick(rng, [...o.known, ...(o.words ?? [])]))).map(card);
    }
    case 'groups': {
      const lo = o.min ?? 2;
      const hi = o.max ?? lo;
      return groups(rng, o.known, count, () => lo + Math.floor(rng() * (hi - lo + 1))).map(card);
    }
    case 'words':
      return cycle(rng, [...QSO_WORDS, ...COMMON_WORDS, ...(o.words ?? [])].filter(fits), count).map(card);
    case 'multi': {
      const words = [...QSO_WORDS, ...COMMON_WORDS].filter(fits);
      return words.length ? Array.from({ length: count }, () => `${pick(rng, words)} ${pick(rng, words)}`).map(card) : [];
    }
    case 'phrases': {
      const out: string[] = [];
      for (let i = 0; i < count * 30 && out.length < count; i++) {
        const p = fillPhrase(rng, pick(rng, PHRASES));
        if (fits(p)) out.push(p);
      }
      return out.map(card);
    }
    case 'prosigns': {
      const signs = ['<AR>', '<SK>', '<BT>', '<KN>'].filter((s) => known.has(s));
      const out: string[] = [];
      for (let i = 0; i < count * 30 && out.length < count && signs.length; i++) {
        const p = `${fillPhrase(rng, pick(rng, PHRASES))} ${pick(rng, signs)}`;
        if (fits(p)) out.push(p);
      }
      return out.map(card);
    }
    case 'callsigns':
      return Array.from({ length: count }, () => callsign(rng, { known })).map(card);
    case 'contest':
      return Array.from({ length: count }, () => {
        const call = callsign(rng, { known });
        const serial = String(1 + Math.floor(rng() * 400)).padStart(3, '0');
        return pick(rng, [`${call} 5NN ${pick(rng, STATES)}`, `5NN ${serial}`, `TU ${call}`, `${call} TU 5NN ${serial}`, `5NN ${pick(rng, STATES)} TU`]);
      }).map(card);
    case 'binomials':
      return cycle(rng, BINOMIALS.filter(fits), count).map(card);
    case 'affixes':
      return cycle(rng, AFFIXES.filter(fits), count).map(card);
    case 'sentences':
      return cycle(rng, SENTENCES.filter(fits), count).map(card);
    case 'alphabet':
      return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(card);
    case 'numbers':
      return '1234567890'.split('').map(card);
    case 'trigrams': {
      const letters = o.known.filter((t) => /^[A-Z]$/.test(t));
      return letters.length ? groups(rng, letters, count, () => 3).map(card) : [];
    }
  }
}
