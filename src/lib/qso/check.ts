// Checks a guided-QSO step: what you sent against the parts the step needs,
// in order, and what you copied against what the station sent. Says exactly
// what is missing or wrong, so you can try again.

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
  /** pass: all there. almost: all there, but something was a letter off. try: something missing. */
  result: 'pass' | 'almost' | 'try';
  notes: string[];
  /** Words sent that the step doesn't need (fine, just noted). */
  extras: string[];
}

const RST = /^[1-5][1-9N][1-9N]$/;

function exact(w: string, s: Slot): boolean {
  if (s.kind === 'rst') return RST.test(w);
  return s.accept.includes(w);
}

/** A letter off: a slip of the key or a misread, on words of three or more letters. */
function near(w: string, s: Slot): string | null {
  if (s.kind === 'rst') return null;
  for (const a of s.accept) if (a.length >= 3 && Math.abs(a.length - w.length) <= 1 && editDistance([...w], [...a]) === 1) return a;
  return null;
}

const times = (n: number) => (n === 2 ? 'twice' : n === 3 ? 'three times' : `${n} times`);

export function checkSend(text: string, slots: Slot[]): Verdict {
  const w = words(text);
  const notes: string[] = [];
  const extras: string[] = [];
  let missing = false;
  let close = false;
  let i = 0;
  for (const s of slots) {
    let at = -1;
    let fix: string | null = null;
    for (let j = i; j < w.length && at < 0; j++) if (exact(w[j], s)) at = j;
    if (at < 0) {
      for (let j = i; j < w.length && at < 0; j++) {
        const f = near(w[j], s);
        if (f) {
          at = j;
          fix = f;
        }
      }
    }
    if (at < 0) {
      if (!s.optional) {
        notes.push(s.missing);
        missing = true;
      }
      continue;
    }
    const slip = (word: string, it: string) => {
      close = true;
      notes.push(`${s.role[0].toUpperCase()}${s.role.slice(1)}: you sent ${word}; it is ${it}.`);
    };
    if (fix) slip(w[at], fix);
    // Skipped words: a slip of this part (K1XYA K1XYZ) is worth saying; the rest are extras.
    for (const x of w.slice(i, at)) {
      const f = near(x, s);
      if (f) slip(x, f);
      else extras.push(x);
    }
    let k = at + 1;
    let count = 1;
    while (count < (s.max ?? 1) && k < w.length && (exact(w[k], s) || near(w[k], s))) {
      const f = exact(w[k], s) ? null : near(w[k], s);
      if (f) slip(w[k], f);
      k++;
      count++;
    }
    if (count < (s.min ?? 1)) {
      notes.push(`Send ${s.role} ${times(s.min ?? 1)}.`);
      missing = true;
    }
    i = k;
  }
  extras.push(...w.slice(i));
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
