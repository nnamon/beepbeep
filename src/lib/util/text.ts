// Edit distance and alignment between what was sent and what was received.

/** Levenshtein distance over arrays (characters or tokens). */
export function editDistance<T>(a: readonly T[], b: readonly T[]): number {
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

const ALIASES: Record<string, string> = { '+': '<AR>', '=': '<BT>', '(': '<KN>', '&': '<AS>' };

/**
 * Splits text into Morse tokens for comparison: <PROSIGNS> count as one token,
 * aliases (=, +, (, &) become their prosign, whitespace collapses to one ' ',
 * and anything else (including the unknown marker) is its own token.
 */
export function textTokens(text: string): string[] {
  const out: string[] = [];
  const s = text.toUpperCase().trim();
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      if (out.length && out[out.length - 1] !== ' ') out.push(' ');
      i++;
    } else if (ch === '<' && s.indexOf('>', i) > i) {
      const j = s.indexOf('>', i);
      out.push(s.slice(i, j + 1));
      i = j + 1;
    } else {
      out.push(ALIASES[ch] ?? ch);
      i++;
    }
  }
  return out;
}

/** Character error rate of `got` against `want` over Morse tokens, 0..1+. */
export function cer(want: string, got: string): number {
  const a = textTokens(want);
  const b = textTokens(got);
  if (!a.length) return b.length ? 1 : 0;
  return editDistance(a, b) / a.length;
}

export type AlignOp =
  | { op: 'match'; want: string; got: string; wi: number; gi: number }
  | { op: 'sub'; want: string; got: string; wi: number; gi: number }
  | { op: 'del'; want: string; wi: number }
  | { op: 'ins'; got: string; gi: number };

/** Needleman-Wunsch style alignment with unit costs; returns the edit script. */
export function align<T extends string>(want: readonly T[], got: readonly T[]): AlignOp[] {
  const m = want.length;
  const n = got.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (want[i - 1] === got[j - 1] ? 0 : 1));
    }
  }
  const ops: AlignOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (want[i - 1] === got[j - 1] ? 0 : 1)) {
      const same = want[i - 1] === got[j - 1];
      ops.push({ op: same ? 'match' : 'sub', want: want[i - 1], got: got[j - 1], wi: i - 1, gi: j - 1 });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ op: 'del', want: want[i - 1], wi: i - 1 });
      i--;
    } else {
      ops.push({ op: 'ins', got: got[j - 1], gi: j - 1 });
      j--;
    }
  }
  return ops.reverse();
}
