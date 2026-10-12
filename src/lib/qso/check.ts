// Checks a guided-QSO step: what you sent against the parts the step needs,
// in order, and what you copied against what the station sent. The words you
// sent are lined up with the parts by dynamic programming over the whole over,
// so one slip gives one note: a part missing, a letter off, two words run
// together, one word split in two, or a word the step doesn't need. Parts that
// operators send in either order (name and QTH) are tried in every order.

import { editDistance } from '../util/text';
import { words } from './parse';

/** One part of an over: their call, DE, your call, a report, K. */
export interface Slot {
  /** What it is, in feedback: 'their call'. */
  role: string;
  /** Accepted words, upper case. Empty with kind 'rst' for any signal report. */
  accept: string[];
  kind?: 'rst';
  /** Times it may come in a row (calls and names are often sent twice). */
  min?: number;
  max?: number;
  optional?: boolean;
  /** Said when it is missing. */
  missing: string;
  /**
   * Neighbouring slots with the same part name form one part (NAME and your
   * name). Neighbouring parts may come in any order (your name before or after
   * your QTH).
   */
  part?: string;
}

export interface Verdict {
  /** pass: all there. almost: all there, but something was a letter off or spaced wrong. try: something missing. */
  result: 'pass' | 'almost' | 'try';
  notes: string[];
  /** Words sent that the step doesn't need (fine, just noted). */
  extras: string[];
}

const RST = /^[1-5][1-9N][1-9N]$/;
/** Prosigns, sent as one character. */
const PROSIGNS = new Set(['SK', 'BT', 'KN', 'AR', 'VA']);
/**
 * Everyday QSO words that may be glued to a part (TNXFER): the run-together is
 * worth a note even though the word itself isn't needed.
 */
const FILLER = new Set([
  'FER', 'FOR', 'CALL', 'ES', 'BT', 'PSE', 'HR', 'GE', 'GM', 'GA', 'GN', 'FB', 'OM', 'TU', 'TNX', 'ABT', 'AR', 'KN', 'BK',
  'RST', 'UR', 'NAME', 'QTH', 'DE', 'CQ', '73', 'GL', 'CUL', 'HPE', 'QSO', 'VY', 'SRI', 'HW', 'HW?', 'CPY', 'CPY?', 'RR',
]);

// What each kind of difference costs in the alignment. A missing part costs
// most. An extra word is cheap: extra words are fine. A slip of one letter
// costs more than an extra word, so a slip next to the right word (K1XYA
// K1XYZ) is lined up as an extra and then named as a slip.
const COST = { missing: 6, short: 3, near: 2, extra: 1, spacing: 0.9 };

function exact(w: string, s: Slot): boolean {
  if (s.kind === 'rst') return RST.test(w);
  return s.accept.includes(w);
}

/** The word without a stray E or T (one dit or dah) at either end. */
function unstray(w: string): string[] {
  const out: string[] = [];
  if (w.length > 1 && (w[0] === 'E' || w[0] === 'T')) out.push(w.slice(1));
  if (w.length > 1 && (w.endsWith('E') || w.endsWith('T'))) out.push(w.slice(0, -1));
  return out;
}

const times = (n: number) => (n === 2 ? 'twice' : n === 3 ? 'three times' : `${n} times`);
const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

function listed(parts: string[]): string {
  return parts.length <= 2 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** A report's three digits: what each one is and the numbers it may be. */
const DIGITS = [
  { which: 'first', what: 'readability', ok: /[1-5]/, range: '1 to 5' },
  { which: 'second', what: 'strength', ok: /[1-9N]/, range: '1 to 9' },
  { which: 'third', what: 'tone', ok: /[1-9N]/, range: '1 to 9' },
];

/** What is wrong with three digits that aren't a report (679: readability 6), or null. */
function badReport(w: string, role: string): string | null {
  if (!/^\d[\dN][\dN]$/.test(w)) return null;
  const d = DIGITS.find((x, i) => !x.ok.test(w[i]));
  return d ? `${cap(role)}: you sent ${w}, but the ${d.which} digit, ${d.what}, goes from ${d.range}.` : null;
}

/**
 * A slip of one letter: one letter off in a word of three or more letters, or a
 * stray dit or dah at either end of any word. Gives the word it should be; for a
 * report with a digit out of range, what is wrong with it instead.
 */
function near(w: string, s: Slot): { fix: string; note?: string } | null {
  if (s.kind === 'rst') {
    const fix = unstray(w).find((c) => RST.test(c));
    if (fix) return { fix };
    const note = badReport(w, s.role);
    return note ? { fix: w, note } : null;
  }
  for (const a of s.accept) {
    if (a.length >= 3 && Math.abs(a.length - w.length) <= 1 && editDistance([...w], [...a]) === 1) return { fix: a };
    if (unstray(w).includes(a)) return { fix: a };
  }
  return null;
}

/** Every order of a list, the given order first. */
function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

/** The slots in every order their parts may come in, the step's own order first. */
function orders(slots: Slot[]): Slot[][] {
  let out: Slot[][] = [[]];
  for (let i = 0; i < slots.length; ) {
    if (!slots[i].part) {
      for (const o of out) o.push(slots[i]);
      i++;
      continue;
    }
    // A run of neighbouring parts, each a run of slots with the same part name.
    const parts: Slot[][] = [];
    while (i < slots.length && slots[i].part) {
      const name = slots[i].part;
      const part: Slot[] = [];
      while (i < slots.length && slots[i].part === name) part.push(slots[i++]);
      parts.push(part);
    }
    out = out.flatMap((o) => permutations(parts).map((p) => [...o, ...p.flat()]));
  }
  return out;
}

type Move =
  /** Word i from character o to its end is this part. */
  | { kind: 'match'; i: number; o: number }
  /** Word i, a letter off (or a report with a digit out of range, with what is wrong). */
  | { kind: 'near'; i: number; fix: string; note?: string }
  /** Words i to i+q-1 joined are this part (a word split by a word space). */
  | { kind: 'join'; i: number; q: number }
  /** Characters o to p of word i are this part, and the word goes on (words run together). */
  | { kind: 'piece'; i: number; o: number; p: number }
  /** Characters o to p of word i are an everyday word the step doesn't need, or a part sent once more, glued to a part. */
  | { kind: 'gluedExtra'; i: number; o: number; p: number }
  /** On to the next part, with this many of the current one. */
  | { kind: 'advance'; j: number; r: number }
  /** Word i isn't part of this step. */
  | { kind: 'extra'; i: number; j: number };

type At = [number, number, number, number];
type Node = { cost: number; move: Move | null; next: At | null };

/** The cheapest way to line up the words with the slots, in this order. */
function align(w: string[], slots: Slot[]) {
  const n = w.length;
  const m = slots.length;
  const reps = slots.map((s) => s.max ?? 1);
  const R = Math.max(1, ...reps) + 1;
  const L = Math.max(1, ...w.map((x) => x.length)) + 1;
  const key = (i: number, o: number, j: number, r: number) => ((i * L + o) * (m + 1) + j) * R + r;
  const memo = new Map<number, Node>();

  // Cheapest way to line up the rest of the over (from word i, character o)
  // with the rest of the parts (from part j, of which r have come so far).
  function solve(i: number, o: number, j: number, r: number): number {
    const k = key(i, o, j, r);
    const hit = memo.get(k);
    if (hit) return hit.cost;
    let best = Infinity;
    let move: Move | null = null;
    let next: At | null = null;
    const consider = (c: number, mv: Move, to: At) => {
      if (c < best - 1e-9) {
        best = c;
        move = mv;
        next = to;
      }
    };
    if (i === n && j === m) best = 0;
    else {
      if (j < m && i < n && r < reps[j]) {
        const s = slots[j];
        const rest = w[i].slice(o);
        if (exact(rest, s)) consider(solve(i + 1, 0, j, r + 1), { kind: 'match', i, o }, [i + 1, 0, j, r + 1]);
        else if (o === 0) {
          const fix = near(rest, s);
          if (fix) consider(COST.near + solve(i + 1, 0, j, r + 1), { kind: 'near', i, ...fix }, [i + 1, 0, j, r + 1]);
        }
        if (o === 0) {
          for (let q = 2; q <= 3 && i + q <= n; q++) {
            if (exact(w.slice(i, i + q).join(''), s)) consider(COST.spacing * (q - 1) + solve(i + q, 0, j, r + 1), { kind: 'join', i, q }, [i + q, 0, j, r + 1]);
          }
        }
        for (let p = o + 1; p < w[i].length; p++) {
          if (exact(w[i].slice(o, p), s)) consider(COST.spacing + solve(i, p, j, r + 1), { kind: 'piece', i, o, p }, [i, p, j, r + 1]);
        }
      }
      if (i < n) {
        // An everyday word glued before or after a part (TNXFER, GETNX), or the
        // part just sent, sent again with no gap (9V1NE9V1NE where it is wanted once).
        const again = (x: string) => (r > 0 && exact(x, slots[j])) || (r === 0 && j > 0 && exact(x, slots[j - 1]));
        for (let p = o + 1; p <= w[i].length; p++) {
          const piece = w[i].slice(o, p);
          if ((o === 0 && p === w[i].length) || !(FILLER.has(piece) || (o > 0 && again(piece)))) continue;
          const c = p === w[i].length ? COST.extra : COST.extra + COST.spacing;
          const to: At = p === w[i].length ? [i + 1, 0, j, r] : [i, p, j, r];
          consider(c + solve(...to), { kind: 'gluedExtra', i, o, p }, to);
        }
      }
      if (j < m) {
        const s = slots[j];
        const min = s.min ?? 1;
        const miss = r === 0 ? (s.optional ? 0 : COST.missing) : r < min ? COST.short * (min - r) : 0;
        consider(miss + solve(i, o, j + 1, 0), { kind: 'advance', j, r }, [i, o, j + 1, 0]);
      }
      if (o === 0 && i < n) consider(COST.extra + solve(i + 1, 0, j, r), { kind: 'extra', i, j }, [i + 1, 0, j, r]);
    }
    memo.set(k, { cost: best, move, next });
    return best;
  }
  return { cost: solve(0, 0, 0, 0), memo, key };
}

export function checkSend(text: string, slots: Slot[]): Verdict {
  const w = words(text);
  // The step's own order, unless another order of its parts lines up better.
  let best: { slots: Slot[]; run: ReturnType<typeof align> } | null = null;
  for (const order of orders(slots)) {
    const run = align(w, order);
    if (!best || run.cost < best.run.cost - 1e-9) best = { slots: order, run };
    if (best.run.cost === 0) break;
  }
  const { memo, key } = best!.run;
  const order = best!.slots;

  const notes: string[] = [];
  const extras: string[] = [];
  let missing = false;
  let close = false;
  const pieces = new Map<number, string[]>();
  const slip = (role: string, sent: string, it: string, note?: string) => {
    close = true;
    notes.push(note ?? `${cap(role)}: you sent ${sent}; it is ${it}.`);
  };
  const glued = (i: number, piece: string, last: boolean) => {
    const list = [...(pieces.get(i) ?? []), piece];
    pieces.set(i, list);
    if (last && list.length > 1) {
      close = true;
      notes.push(`${listed(list)} ran together: leave a word space between ${list.length === 2 ? 'them' : 'each of them'}.`);
    }
  };
  // Optional parts passed over since the last word that was lined up, latest
  // first: a word that isn't needed may be a slip of one of them (BKE for BK).
  let skipped: Slot[] = [];

  let at: At | null = [0, 0, 0, 0];
  while (at) {
    const node = memo.get(key(...at));
    if (!node?.move) break;
    const mv = node.move as Move;
    const j = at[2];
    if (mv.kind !== 'advance' && mv.kind !== 'extra') skipped = [];
    switch (mv.kind) {
      case 'match':
        if (mv.o > 0) glued(mv.i, w[mv.i].slice(mv.o), true);
        break;
      case 'near':
        slip(order[j].role, w[mv.i], mv.fix, mv.note);
        break;
      case 'join': {
        close = true;
        const parts = w.slice(mv.i, mv.i + mv.q);
        const joined = parts.join('');
        notes.push(
          PROSIGNS.has(joined)
            ? `${joined} came out as ${parts.join(' ')}: send it as one character, with no gap inside.`
            : `${joined} came out as ${parts.join(' ')}: a gap inside it was as long as a word space, so keep its ${/^[A-Z]+$/.test(joined) ? 'letters' : 'characters'} closer together.`,
        );
        break;
      }
      case 'piece':
        glued(mv.i, w[mv.i].slice(mv.o, mv.p), false);
        break;
      case 'gluedExtra': {
        const piece = w[mv.i].slice(mv.o, mv.p);
        extras.push(piece);
        glued(mv.i, piece, mv.p === w[mv.i].length);
        break;
      }
      case 'advance': {
        const s = order[mv.j];
        const min = s.min ?? 1;
        if (mv.r === 0 && !s.optional) {
          notes.push(s.missing);
          missing = true;
        } else if (mv.r > 0 && mv.r < min) {
          notes.push(`Send ${s.role} ${times(min)}.`);
          missing = true;
        }
        skipped = mv.r === 0 ? [s, ...skipped] : [];
        break;
      }
      case 'extra': {
        // A slip of a part it sits next to (K1XYA K1XYZ, or BKE before TU) is worth saying; anything else is just extra.
        const x = w[mv.i];
        const around = [order[mv.j], ...skipped, order[mv.j - 1]].filter(Boolean);
        const fixFor = around.map((s) => ({ s, fix: near(x, s) })).find((f) => f.fix);
        if (fixFor) slip(fixFor.s.role, x, fixFor.fix!.fix, fixFor.fix!.note);
        else extras.push(x);
        break;
      }
    }
    at = node.next;
  }
  return { result: missing ? 'try' : close ? 'almost' : 'pass', notes: [...new Set(notes)], extras };
}

export type FieldKind = 'call' | 'rst' | 'name' | 'qth' | 'text';

export interface FieldCheck {
  result: 'right' | 'close' | 'wrong';
  /** What it was, when not right. */
  answer: string;
}

/** What you copied into a field against what the station sent. */
export function checkField(got: string, answer: string, kind: FieldKind): FieldCheck {
  const norm = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();
  let g = norm(got);
  let a = norm(answer);
  if (kind === 'rst') {
    g = g.replace(/N/g, '9');
    a = a.replace(/N/g, '9');
  }
  if (g === a) return { result: 'right', answer };
  // QTH: the town, with or without the region after it.
  if (kind === 'qth' && g && g.startsWith(`${a} `)) return { result: 'right', answer };
  if (g && a.length >= 3 && editDistance([...g], [...a]) === 1) return { result: 'close', answer };
  return { result: 'wrong', answer };
}
