// Checks a guided-QSO step: what you sent against the parts the step needs,
// in order, and what you copied against what the station sent. The words you
// sent are lined up with the parts by dynamic programming over the whole over,
// so one slip gives one note: a part missing, a letter off, two words run
// together, one word split in two, or a word the step doesn't need.

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

/**
 * A slip of one letter: one letter off in a word of three or more letters, or a
 * stray dit or dah at either end of any word. Returns the word it should be.
 */
function near(w: string, s: Slot): string | null {
  if (s.kind === 'rst') return unstray(w).find((c) => RST.test(c)) ?? null;
  for (const a of s.accept) {
    if (a.length >= 3 && Math.abs(a.length - w.length) <= 1 && editDistance([...w], [...a]) === 1) return a;
    if (unstray(w).includes(a)) return a;
  }
  return null;
}

const times = (n: number) => (n === 2 ? 'twice' : n === 3 ? 'three times' : `${n} times`);
const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

function listed(parts: string[]): string {
  return parts.length <= 2 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

type Move =
  /** Word i from character o to its end is this part. */
  | { kind: 'match'; i: number; o: number }
  /** Word i, a letter off. */
  | { kind: 'near'; i: number; fix: string }
  /** Words i to i+q-1 joined are this part (a word split by a word space). */
  | { kind: 'join'; i: number; q: number }
  /** Characters o to p of word i are this part, and the word goes on (words run together). */
  | { kind: 'piece'; i: number; o: number; p: number }
  /** Characters o to p of word i are an everyday word the step doesn't need, glued to a part. */
  | { kind: 'gluedExtra'; i: number; o: number; p: number }
  /** On to the next part, with this many of the current one. */
  | { kind: 'advance'; j: number; r: number }
  /** Word i isn't part of this step. */
  | { kind: 'extra'; i: number; j: number };

export function checkSend(text: string, slots: Slot[]): Verdict {
  const w = words(text);
  const n = w.length;
  const m = slots.length;
  const reps = slots.map((s) => s.max ?? 1);
  const R = Math.max(1, ...reps) + 1;
  const L = Math.max(1, ...w.map((x) => x.length)) + 1;
  const key = (i: number, o: number, j: number, r: number) => ((i * L + o) * (m + 1) + j) * R + r;
  const memo = new Map<number, { cost: number; move: Move | null; next: [number, number, number, number] | null }>();

  // Cheapest way to line up the rest of the over (from word i, character o)
  // with the rest of the parts (from part j, of which r have come so far).
  function solve(i: number, o: number, j: number, r: number): number {
    const k = key(i, o, j, r);
    const hit = memo.get(k);
    if (hit) return hit.cost;
    let best = Infinity;
    let move: Move | null = null;
    let next: [number, number, number, number] | null = null;
    const consider = (c: number, mv: Move, to: [number, number, number, number]) => {
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
          if (fix) consider(COST.near + solve(i + 1, 0, j, r + 1), { kind: 'near', i, fix }, [i + 1, 0, j, r + 1]);
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
        // An everyday word glued before or after a part (TNXFER, GETNX).
        for (let p = o + 1; p <= w[i].length; p++) {
          if (!FILLER.has(w[i].slice(o, p)) || (o === 0 && p === w[i].length)) continue;
          const c = p === w[i].length ? COST.extra : COST.extra + COST.spacing;
          const to: [number, number, number, number] = p === w[i].length ? [i + 1, 0, j, r] : [i, p, j, r];
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
  solve(0, 0, 0, 0);

  const notes: string[] = [];
  const extras: string[] = [];
  let missing = false;
  let close = false;
  const pieces = new Map<number, string[]>();
  const slip = (role: string, sent: string, it: string) => {
    close = true;
    notes.push(`${cap(role)}: you sent ${sent}; it is ${it}.`);
  };
  const glued = (i: number, piece: string, last: boolean) => {
    const list = [...(pieces.get(i) ?? []), piece];
    pieces.set(i, list);
    if (last && list.length > 1) {
      close = true;
      notes.push(`${listed(list)} ran together: leave a word space between ${list.length === 2 ? 'them' : 'each of them'}.`);
    }
  };

  let at: [number, number, number, number] | null = [0, 0, 0, 0];
  while (at) {
    const node = memo.get(key(...at));
    if (!node?.move) break;
    const mv = node.move as Move;
    const j = at[2];
    switch (mv.kind) {
      case 'match':
        if (mv.o > 0) glued(mv.i, w[mv.i].slice(mv.o), true);
        break;
      case 'near':
        slip(slots[j].role, w[mv.i], mv.fix);
        break;
      case 'join': {
        close = true;
        const parts = w.slice(mv.i, mv.i + mv.q);
        const joined = parts.join('');
        notes.push(
          PROSIGNS.has(joined)
            ? `${joined} came out as ${parts.join(' ')}: send it as one character, with no gap inside.`
            : `${joined} came out as ${parts.join(' ')}: a gap inside it was as long as a word space, so keep its letters closer together.`,
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
        const s = slots[mv.j];
        const min = s.min ?? 1;
        if (mv.r === 0 && !s.optional) {
          notes.push(s.missing);
          missing = true;
        } else if (mv.r > 0 && mv.r < min) {
          notes.push(`Send ${s.role} ${times(min)}.`);
          missing = true;
        }
        break;
      }
      case 'extra': {
        // A slip of the part it sits next to (K1XYA K1XYZ) is worth saying; anything else is just extra.
        const x = w[mv.i];
        const around = [slots[mv.j], slots[mv.j - 1]].filter(Boolean);
        const fixFor = around.map((s) => ({ s, fix: near(x, s) })).find((f) => f.fix);
        if (fixFor) slip(fixFor.s.role, x, fixFor.fix!);
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
