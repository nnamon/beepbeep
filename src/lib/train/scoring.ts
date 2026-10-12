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
  /** Characters typed that were not sent (spaces excluded). */
  extra: number;
  /** Right characters over sent characters plus extra ones, so typing more can't raise it. */
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
  let extra = 0;
  const confusions: { want: string; got: string }[] = [];
  const missRuns: number[] = [];
  let run = 0;
  for (const o of ops) {
    if (o.op === 'ins') {
      if (o.got !== ' ') extra++;
      continue;
    }
    if (o.want === ' ') continue;
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
  return { ops, total, correct, extra, accuracy: total + extra ? correct / (total + extra) : 1, confusions, missRuns };
}

/** A round of separate answers, each compared on its own, added up. */
export function compareRound(answers: readonly { want: string; got: string }[]): CopyResult {
  const parts = answers.map((a) => compareCopy(a.want, a.got));
  const total = parts.reduce((n, r) => n + r.total, 0);
  const correct = parts.reduce((n, r) => n + r.correct, 0);
  const extra = parts.reduce((n, r) => n + r.extra, 0);
  return {
    ops: parts.flatMap((r) => r.ops),
    total,
    correct,
    extra,
    accuracy: total + extra ? correct / (total + extra) : 1,
    confusions: parts.flatMap((r) => r.confusions),
    missRuns: parts.flatMap((r) => r.missRuns),
  };
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
      // Each returns the letters involved, e.g. "ET" (ran together as A) or "EN" (R split).
      const merged = (x: AlignOp | undefined, before = false) => {
        if (!x || x.op !== 'del' || x.want === ' ') return null;
        const pair = before ? x.want + o.want : o.want + x.want;
        return p(o.got) === (before ? p(x.want) + p(o.want) : p(o.want) + p(x.want)) ? pair : null;
      };
      const split = (x: AlignOp | undefined, before = false) => {
        if (!x || x.op !== 'ins' || x.got === ' ') return null;
        const parts = before ? x.got + o.got : o.got + x.got;
        return p(o.want) === (before ? p(x.got) + p(o.got) : p(o.got) + p(x.got)) ? parts : null;
      };
      const m = merged(next) ?? merged(prev, true);
      const sp = m ? null : (split(next) ?? split(prev, true));
      if (m) {
        issues.push({ kind: 'merged-letters', at: o.gi, detail: `${m} as ${o.got}` });
        if (merged(next)) i++;
      } else if (sp) {
        issues.push({ kind: 'split-letter', at: o.gi, detail: `${o.want} as ${sp}` });
        if (split(next)) i++;
      }
    }
  }
  return issues;
}

/** One line for a spacing issue, e.g. "Letters ran together: ET as A." */
export function describeIssue(i: SendIssue): string {
  switch (i.kind) {
    case 'merged-words':
      return 'Two words heard as one.';
    case 'split-word':
      return 'One word heard as two.';
    case 'merged-letters':
      return `Letters ran together: ${i.detail}.`;
    case 'split-letter':
      return `Letter split in two: ${i.detail}.`;
    default:
      return i.detail;
  }
}

export type Tolerance = 'tight' | 'normal' | 'loose';
const TOL: Record<Tolerance, number> = { tight: 0.6, normal: 1, loose: 1.5 };

/** One actionable adjustment, the most important first, with its measurement. */
export function oneNote(report: FistReport | null, issues: SendIssue[] = [], tolerance: Tolerance = 'normal'): string {
  const has = (k: SendIssue['kind']) => issues.some((i) => i.kind === k);
  if (has('merged-words')) return 'Word gap too short: two words ran together.';
  if (has('merged-letters')) return 'Letter gap too short: two letters ran together.';
  if (has('split-letter')) return 'Gap inside a letter too long: it split in two.';
  if (has('split-word')) return 'Gap inside a word too long: it split in two.';
  if (!report) return 'Not enough sending to measure.';
  const t = TOL[tolerance];
  const f = (x: number) => x.toFixed(1);
  if (report.weighting > 1 + 0.45 * t) return `Heavy weighting: ${report.weighting.toFixed(2)}, aim 1.0.`;
  if (report.weighting < 1 - 0.3 * t) return `Light weighting: ${report.weighting.toFixed(2)}, aim 1.0.`;
  if (report.dahRatio < 3 - 0.5 * t) return `Dahs short: ${f(report.dahRatio)} dits, aim 3.`;
  if (report.dahRatio > 3 + 0.8 * t) return `Dahs long: ${f(report.dahRatio)} dits, aim 3.`;
  if (report.wordGap !== null && report.wordGap < 7 - 1.5 * t) return `Word gaps short: ${f(report.wordGap)} units, aim 7.`;
  if (report.charGap < 3 - 0.6 * t) return `Letter gaps short: ${f(report.charGap)} units, aim 3.`;
  if (report.ditSpread > 0.25 * t) return `Dit length varies by ${Math.round(report.ditSpread * 100)}%.`;
  if (Math.abs(report.drift) > 3 * t)
    return `Speed ${report.drift > 0 ? 'rose' : 'fell'} ${Math.abs(report.drift).toFixed(0)} wpm per minute.`;
  return 'Timing within range.';
}
