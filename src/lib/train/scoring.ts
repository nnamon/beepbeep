// Comparing what was sent with what was received, and turning a fist report
// into one actionable note.

import { patternOf } from '../morse/code';
import { align, textTokens, type AlignOp } from '../util/text';
import type { FistReport } from './fist';

export interface CopyResult {
  ops: AlignOp[];
  /** Tokens of the wanted text, excluding spaces. */
  total: number;
  correct: number;
  accuracy: number;
  /** Wanted -> got pairs for substitutions (characters only). */
  confusions: { want: string; got: string }[];
  /** Lengths of each run of consecutive misses (the IFR measure). */
  missRuns: number[];
}

export function compareCopy(want: string, got: string): CopyResult {
  const a = textTokens(want);
  const b = textTokens(got);
  const ops = align(a, b);
  let total = 0;
  let correct = 0;
  const confusions: { want: string; got: string }[] = [];
  const missRuns: number[] = [];
  let run = 0;
  for (const o of ops) {
    const wantTok = o.op === 'ins' ? null : o.want;
    if (wantTok === ' ') continue;
    if (o.op === 'match') {
      total++;
      correct++;
      if (run) missRuns.push(run);
      run = 0;
    } else if (o.op === 'sub' || o.op === 'del') {
      total++;
      run++;
      if (o.op === 'sub' && o.got !== ' ') confusions.push({ want: o.want, got: o.got });
    }
  }
  if (run) missRuns.push(run);
  return { ops, total, correct, accuracy: total ? correct / total : 1, confusions, missRuns };
}

/** Average characters needed to get back in step after a miss (lower is better). */
export function recoveryLength(r: CopyResult): number | null {
  if (!r.missRuns.length) return null;
  return r.missRuns.reduce((a, b) => a + b, 0) / r.missRuns.length;
}

export interface SendIssue {
  kind: 'merged-words' | 'split-word' | 'merged-letters' | 'split-letter' | 'other';
  /** Index into the received tokens where it shows. */
  at: number;
  detail: string;
}

/**
 * Finds spacing mistakes by comparing word and letter boundaries, e.g. "CALL ES"
 * received as "CALLES" (word gap too short) or "R" received as "EN" (a gap
 * inside a letter ran long).
 */
export function spacingIssues(intended: string, received: string): SendIssue[] {
  const a = textTokens(intended);
  const b = textTokens(received);
  const issues: SendIssue[] = [];
  const ops = align(a, b);
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    if (o.op === 'del' && o.want === ' ') {
      issues.push({ kind: 'merged-words', at: ops.slice(0, i).filter((x) => x.op !== 'del').length, detail: 'heard as one word' });
    } else if (o.op === 'ins' && o.got === ' ') {
      issues.push({ kind: 'split-word', at: o.gi, detail: 'heard as two words' });
    } else if (o.op === 'sub' && o.got !== ' ' && o.want !== ' ') {
      // The alignment may put the extra or missing letter on either side.
      const prev = ops[i - 1];
      const next = ops[i + 1];
      const p = (t: string) => patternOf(t) ?? '#';
      const merged = (x?: AlignOp, before = false) =>
        x && x.op === 'del' && x.want !== ' ' &&
        p(o.got) === (before ? p(x.want) + p(o.want) : p(o.want) + p(x.want));
      const split = (x?: AlignOp, before = false) =>
        x && x.op === 'ins' && x.got !== ' ' &&
        p(o.want) === (before ? p(x.got) + p(o.got) : p(o.got) + p(x.got));
      if (merged(next) || merged(prev, true)) {
        issues.push({ kind: 'merged-letters', at: o.gi, detail: 'letters ran together' });
        if (merged(next)) i++;
      } else if (split(next) || split(prev, true)) {
        issues.push({ kind: 'split-letter', at: o.gi, detail: `${o.want} split in two` });
        if (split(next)) i++;
      }
    }
  }
  return issues;
}

/** One actionable adjustment, the most important first. */
export function oneNote(report: FistReport | null, issues: SendIssue[] = []): string {
  const has = (k: SendIssue['kind']) => issues.some((i) => i.kind === k);
  if (has('merged-words')) return 'Word gaps ran short. Leave more room between words.';
  if (has('merged-letters')) return 'Letters ran together. Leave a full three-dit gap between letters.';
  if (has('split-letter')) return 'A gap inside a letter ran long, so it was heard as two. Keep letters tight.';
  if (has('split-word')) return 'A gap inside a word ran long. Keep letters of a word closer together.';
  if (!report) return 'Send a little more so there is enough to measure.';
  if (report.weighting > 1.45) return 'Heavy weighting: marks long and gaps short. Lift off a little sooner.';
  if (report.weighting < 0.7) return 'Light weighting: marks short and gaps long. Hold each mark a little longer.';
  if (report.dahRatio < 2.5) return 'Dahs ran short. Hold each one about three dits long.';
  if (report.dahRatio > 3.8) return 'Dahs ran long. Aim for three dits.';
  if (report.wordGap !== null && report.wordGap < 5.5) return 'Word gaps ran a little short. Leave more room between words.';
  if (report.charGap < 2.4) return 'Letters ran close together. Leave a full three-dit gap.';
  if (report.ditSpread > 0.25) return 'Dit lengths varied a lot. Aim for an even rhythm.';
  if (Math.abs(report.drift) > 3) return report.drift > 0 ? 'You sped up as you went. Hold a steady pace.' : 'You slowed down as you went. Hold a steady pace.';
  return 'Clean, even sending.';
}
