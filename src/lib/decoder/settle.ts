// The second pass: an over decoded as a whole, the way an experienced
// listener copies a beginner. Every reading of the over (which marks are dits
// or dahs, which gaps end a letter or a word) is scored by
//
//  - timing, judged per letter: each letter gets its own tempo (beginners slow
//    down on unfamiliar letters), drawn from a tempo curve across the over
//    (they speed up or tire), with robust tails for hesitations;
//  - a light character language model, which settles what the timing leaves
//    open and never outweighs a clearly sent letter; or, for practice groups
//    of a lesson's few characters (KKKMM MKMK KKMM), which no language model
//    expects, a model of groups: few characters, about five to a group;
//
// and the best reading wins (beam search). The fist itself (dah ratio, gaps,
// tempo drift, spread) is re-estimated from that reading and the over decoded
// again, a few rounds, from a start given by the live decoder's model.

import { ALL_TOKENS, tokenOf } from '../morse/code';
import type { DecodedChar, DecodedMark, DecoderModel, DecoderOutput } from './decoder';
import { languageModel, wordEvidence } from './lm';
import { kmeans2 } from './kmeans';
import { gapClasses, settledClasses, upperRole } from './breaks';

interface Mark {
  start: number;
  end: number;
}

/** A fist in log units relative to the dit, plus how much each part wanders. */
export interface FistParams {
  t0: number;
  /** log dit length (s) at t0, and its change per second (tempo drift). */
  logDit: number;
  drift: number;
  /** log of dah, gap inside a letter, letter gap and word gap, in dits. */
  dah: number;
  elem: number;
  char: number;
  word: number;
  sdMark: number;
  sdGap: number;
  sdInter: number;
  sdTempo: number;
}

/** The least spread of gaps the search allows (log units), for the most regular fist. */
const REGULAR_SD = 0.12;

/**
 * Search settings; tests sweep them. `groups`: how often an over is practice
 * groups of a few characters (KKKMM MKMK) rather than language.
 */
export const tuning = { groups: 0.02, rewrite: 3, lmWeight: 1, unknown: -12, beam: 600, fitBeam: 80, rounds: 2, sdTempo: 0.15, sdMark: 0.22, wordBonus: 1.2, repeatBonus: 0.9, outlier: 0.05, markOutlier: 0.03, minWord: 1, drift: true, sdInter: 0.35, sdGap: 0.3 };
const MAX_PATTERN = 9;
/** Where timing cannot tell letter gaps from word gaps, both classes sit this factor either side of the gaps. */
const OPEN = 1.35;
/** A gap longer than a word gap is still a word gap: how much of the excess counts against it. */
const WORD_TAIL = 0.5;
/** Gaps an over needs before a small group of quick gaps is folded into the gaps inside letters. */
const SETTLE_CLASSES = 8;

const LN2PI = Math.log(2 * Math.PI);

/**
 * Log density of residual r: mostly N(0, sd), with a wider tail for slips.
 * For gaps (`longer`) the tail is one-sided: a hesitation only ever makes a
 * gap longer, so a gap far shorter than its class gets no allowance. A short
 * pause can then never be read as a word gap to make a familiar word.
 */
function robust(r: number, sd: number, longer = false): number {
  const a = -0.5 * (r / sd) ** 2 - Math.log(sd) - 0.5 * LN2PI;
  if (longer && r <= 0) return a + Math.log(1 - tuning.outlier);
  const w = 3 * sd;
  const b = -0.5 * (r / w) ** 2 - Math.log(w) - 0.5 * LN2PI + (longer ? Math.log(2) : 0);
  const eps = longer ? tuning.outlier : tuning.markOutlier;
  const m = Math.max(a, b);
  return m + Math.log((1 - eps) * Math.exp(a - m) + eps * Math.exp(b - m));
}

export interface Item {
  token: string | null;
  pattern: string;
  from: number;
  to: number;
  /** Fitted log dit length of this letter. */
  tempo: number;
  /** A word space follows this letter. */
  space: boolean;
}

interface Chain {
  item: Item;
  prev: Chain | null;
}

interface Hyp {
  /** Score of everything closed so far. */
  base: number;
  /** base plus the open letter so far (what the beam compares). */
  score: number;
  pattern: string;
  /** Index of the first mark of the open letter. */
  from: number;
  /** The open letter's score and fitted tempo. */
  open: { score: number; tempo: number } | null;
  ctx: string[];
  chain: Chain | null;
  /** Fitted tempo of the last closed letter, for the gap after it. */
  lastTempo: number | null;
  /** Letters of the word so far, and the last few words (for repeats). */
  word: string;
  recent: string[];
  /** Timing and the rest, without the text's own probability. */
  rest: number;
  /** The text's log probability as language (character model and word evidence), and as groups of practice characters. */
  lang: number;
  grp: number;
  /** How often each character has been read so far in this reading (by `TOKEN_INDEX`), and in all. */
  seen: Uint16Array | null;
  nSeen: number;
  /** The characters read so far, as a set (for keeping readings with different ones apart). */
  sig: string;
}

const TOKEN_INDEX = new Map(ALL_TOKENS.map((t, i) => [t, i]));

/**
 * The text's log probability: as language (the character model and word
 * evidence) or as practice groups, whichever explains it, weighted by how
 * often an over is groups (`tuning.groups`).
 */
function textScore(lang: number, grp: number): number {
  if (!(tuning.groups > 0)) return lang;
  const a = lang + Math.log(1 - tuning.groups);
  const b = grp + Math.log(tuning.groups);
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}

/** Groups use few characters: one already read is as likely as its share so far; a new one is any of them. */
function groupLetter(seen: Uint16Array | null, n: number, i: number): number {
  const c = seen ? seen[i] : 0;
  return c ? Math.log(c / (n + 1)) : Math.log(1 / (n + 1) / ALL_TOKENS.length);
}

const tempoAt = (p: FistParams, t: number) => p.logDit + p.drift * (t - p.t0);

/**
 * Scores one letter: its marks and the gaps inside it against one tempo,
 * which is fitted (Gaussian prior from the tempo curve) and integrated out.
 */
function letterScore(marks: Mark[], from: number, to: number, pattern: string, p: FistParams): { score: number; tempo: number } {
  const mu = tempoAt(p, marks[from].start);
  const w0 = 1 / p.sdTempo ** 2;
  const ys: number[] = [];
  const ss: number[] = [];
  for (let k = from; k <= to; k++) {
    ys.push(Math.log(marks[k].end - marks[k].start) - (pattern[k - from] === '-' ? p.dah : 0));
    ss.push(p.sdMark);
    if (k < to) {
      ys.push(Math.log(marks[k + 1].start - marks[k].end) - p.elem);
      ss.push(p.sdGap);
    }
  }
  let W = w0;
  let sum = w0 * mu;
  for (let i = 0; i < ys.length; i++) {
    const w = 1 / ss[i] ** 2;
    W += w;
    sum += w * ys[i];
  }
  const m = sum / W;
  let score = -0.5 * w0 * (m - mu) ** 2 - Math.log(p.sdTempo) - 0.5 * LN2PI + 0.5 * (LN2PI - Math.log(W));
  // Entries alternate mark, gap, mark...: gaps take the one-sided tail.
  for (let i = 0; i < ys.length; i++) score += robust(ys[i] - m, ss[i], i % 2 === 1);
  return { score, tempo: m };
}

function gapScore(gap: number, cls: 'char' | 'word', h: Hyp, t: number, p: FistParams): number {
  const local = h.lastTempo === null ? tempoAt(p, t) : 0.5 * h.lastTempo + 0.5 * tempoAt(p, t);
  const r = Math.log(gap) - local - (cls === 'char' ? p.char : p.word);
  // Beginners pause between words for as long as they like.
  return robust(cls === 'word' && r > 0 ? r * WORD_TAIL : r, p.sdInter, true);
}

/** A reading the search must follow for the first marks: dit or dah per mark, and per gap e (inside a letter), c (letter) or w (word). */
export interface Fixed {
  sym: string;
  gap: string;
}

/** The best reading and its score (log probability, up to a constant). */
export function decodeOnce(marks: Mark[], p: FistParams, beam = tuning.beam, fixed: Fixed = { sym: '', gap: '' }): { items: Item[]; score: number } {
  const lm = languageModel();
  // Many readings share a letter (same marks, same pattern): score it once.
  const letters = new Map<string, { score: number; tempo: number }>();
  const letter = (from: number, to: number, pattern: string) => {
    const k = `${from}|${pattern}`;
    let v = letters.get(k);
    if (!v) {
      v = letterScore(marks, from, to, pattern, p);
      letters.set(k, v);
    }
    return v;
  };
  let hyps: Hyp[] = [{ base: 0, score: 0, pattern: '', from: 0, open: null, ctx: [' ', ' '], chain: null, lastTempo: null, word: '', recent: [], rest: 0, lang: 0, grp: 0, seen: null, nSeen: 0, sig: '' }];

  /** Closes the open letter; `gap` (if any) is the silence after it, as a letter or word gap. */
  const close = (h: Hyp, to: number, space: boolean, gap: number | null): Hyp => {
    const token = tokenOf(h.pattern) ?? null;
    const ls = h.open!;
    let rest = h.rest + ls.score;
    let lang = h.lang;
    let grp = h.grp;
    let seen = h.seen;
    let nSeen = h.nSeen;
    let sig = h.sig;
    if (token) {
      lang += tuning.lmWeight * lm.logp(h.ctx, token);
      const ti = TOKEN_INDEX.get(token);
      if (ti !== undefined) {
        grp += groupLetter(seen, nSeen, ti);
        if (!seen?.[ti]) sig = [...sig, String.fromCharCode(65 + ti)].sort().join('');
        seen = seen ? new Uint16Array(seen) : new Uint16Array(ALL_TOKENS.length);
        seen[ti]++;
        nSeen++;
      }
    } else rest += tuning.unknown;
    // Groups of about five: a space after one letter in five.
    if (gap !== null) grp += Math.log(space ? 0.2 : 0.8);
    const ctx = [...h.ctx, token ?? '?'].slice(-2);
    if (gap !== null) rest += gapScore(gap, space ? 'word' : 'char', { ...h, lastTempo: ls.tempo }, marks[to].end, p);
    let word = h.word + (token ?? '?');
    let recent = h.recent;
    // A finished word: real words, callsigns and numbers, and repeats, are evidence.
    if (space || gap === null) {
      // Per letter, so cutting one word into several short known ones gains nothing.
      const ev = wordEvidence(word, recent);
      const letters = word.replace(/<[A-Z]+>/g, '#').length;
      // Short words form by accident when an unfamiliar word is cut up (FEB as
      // FE DE); they are left to the letter-level model, which knows them well.
      if (letters >= tuning.minWord) lang += letters * (ev.known * tuning.wordBonus + ev.repeat * tuning.repeatBonus);
      recent = [...recent, word].slice(-4);
      word = '';
    }
    if (space) {
      lang += tuning.lmWeight * lm.logp(ctx, ' ');
      ctx.push(' ');
    }
    const base = rest + textScore(lang, grp);
    const item: Item = { token, pattern: h.pattern, from: h.from, to, tempo: ls.tempo, space };
    return { base, score: base, pattern: '', from: to + 1, open: null, ctx: ctx.slice(-2), chain: { item, prev: h.chain }, lastTempo: ls.tempo, word, recent, rest, lang, grp, seen, nSeen, sig };
  };

  const prune = (list: Hyp[]): Hyp[] => {
    const best = new Map<string, Hyp>();
    for (const h of list) {
      // What shapes the rest: the open letter, the language-model context and
      // the word so far; for a reading that reads as groups, its characters too.
      const groupLike = tuning.groups > 0 && h.grp + Math.log(tuning.groups) > h.lang + Math.log(1 - tuning.groups);
      const key = `${h.pattern}|${h.ctx.join('')}|${h.word}${groupLike ? `|${h.sig}` : ''}`;
      const b = best.get(key);
      if (!b || h.score > b.score) best.set(key, h);
    }
    const sorted = [...best.values()].sort((a, b) => b.score - a.score);
    const kept = sorted.slice(0, beam);
    // Readings that have just closed a letter always keep some room, so a poor
    // start cannot fill the beam with letters that never end.
    const closed = sorted.slice(beam).filter((h) => !h.pattern).slice(0, Math.ceil(beam / 4));
    return closed.length ? [...kept, ...closed] : kept;
  };

  for (let i = 0; i < marks.length; i++) {
    // Mark i joins the open letter as a dit or a dah.
    const next: Hyp[] = [];
    for (let h of hyps) {
      // Longer than any character: close it as unknown rather than lose the reading.
      if (h.pattern.length >= MAX_PATTERN) h = close(h, i - 1, false, marks[i].start - marks[i - 1].end);
      for (const sym of ['.', '-']) {
        if (i < fixed.sym.length && sym !== fixed.sym[i]) continue;
        const pattern = h.pattern + sym;
        const open = letter(h.from, i, pattern);
        next.push({ ...h, pattern, open, score: h.base + open.score });
      }
    }
    hyps = prune(next);
    if (i < marks.length - 1) {
      // The gap after it: inside the letter, or the end of a letter or a word.
      const gap = marks[i + 1].start - marks[i].end;
      const after: Hyp[] = [];
      const cls = fixed.gap[i];
      for (const h of hyps) {
        // Provisional until the next mark joins and the letter is scored again.
        if (!cls || cls === 'e') after.push({ ...h, score: h.score + robust(Math.log(gap) - h.open!.tempo - p.elem, p.sdGap, true) });
        if (!cls || cls === 'c') after.push(close(h, i, false, gap));
        if (!cls || cls === 'w') after.push(close(h, i, true, gap));
      }
      hyps = prune(after);
    } else {
      hyps = prune(hyps.map((h) => close(h, i, false, null)));
    }
  }
  const items: Item[] = [];
  for (let c = hyps[0]?.chain ?? null; c; c = c.prev) items.unshift(c.item);
  return { items, score: hyps[0]?.score ?? -Infinity };
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN;
};
const mad = (xs: number[]) => {
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
};
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Starting fist, from the over's own marks and gaps (dits and dahs by 2-means,
 * gap classes by their density peaks); the live model fills in what one over
 * cannot show.
 */
export function initialParams(model: DecoderModel, marks: Mark[]): FistParams {
  const logs = marks.map((m) => Math.log(m.end - m.start));
  let dit = model.dit;
  let dahRatio = model.dah / model.dit;
  let split = false;
  if (logs.length >= 4) {
    // Seeded at the shortest and longest marks, except one far from the rest
    // (1.6 times shorter or longer than its neighbour) when the rest still
    // hold dits and dahs: a blip from the room, or a voice merged into a
    // mark, must not pose as the dit or the dah. The one dah of SET stays.
    const sorted = [...logs].sort((a, b) => a - b);
    const last = sorted.length - 1;
    const apart = Math.log(1.6);
    let i = 0;
    while (i < last - 1 && sorted[i + 1] - sorted[i] > apart) i++;
    if (sorted[last] - sorted[i] < apart) i = 0;
    let j = last;
    while (j > i + 1 && sorted[j] - sorted[j - 1] > apart) j--;
    if (sorted[j] - sorted[i] < apart) j = last;
    const lo = sorted[i];
    const hi = sorted[j];
    const k = kmeans2(logs, lo, hi);
    if (k.nLow >= 1 && k.nHigh >= 1 && k.high - k.low >= Math.log(1.6)) {
      dit = Math.exp(k.low);
      dahRatio = Math.exp(k.high - k.low);
      split = true;
    }
  }
  const gaps = marks.slice(1).map((m, i) => Math.log(m.start - marks[i].end)).filter((g) => Number.isFinite(g));
  // Marks of one length only (T, M, O): dits or dahs? The gaps inside letters
  // tell: after a dit they are about as long as it or longer (two thirds with
  // heavy weighting), after a dah a third of it (a beginner's, 0.4 to 0.75).
  // Gaps under 0.6 of the marks make them dahs, whatever speed the live
  // decoder assumed (OTOOT keyed at 25 wpm with the setting at 15 read as
  // SESSE).
  if (!split && logs.length >= 2 && gaps.length >= 1) {
    const m = median(logs);
    const g0 = gaps.length >= 3 ? gapClasses(gaps).modes[0] : Math.min(...gaps);
    const asDits = Math.abs(m - Math.log(model.dit)) <= Math.abs(m - Math.log(model.dah));
    if (asDits && g0 - m < Math.log(0.6)) {
      dahRatio = 3;
      dit = Math.exp(m) / dahRatio;
    }
  }
  const dah = clamp(Math.log(dahRatio), Math.log(1.8), Math.log(4.5));
  let elem = Math.log(model.elemGap / dit);
  let char = Math.log(model.charGap / dit);
  let word = Math.log((model.wordBoundaryEst * 1.4) / dit);
  if (gaps.length >= 3) {
    const raw = gapClasses(gaps);
    // As the live decoder reads them (a few hurried gaps are not a class),
    // once there are enough gaps to tell.
    const c = gaps.length >= SETTLE_CLASSES ? settledClasses(raw) : raw;
    const role = c.modes.length === 2 && c.modes[1] - c.modes[0] >= Math.log(1.8) ? upperRole(c.modes[1], c.modes[0], Math.log(dit), c.counts[1]) : 'char';
    if (role === 'word') {
      // Words of one letter (V V V): the class above the gaps inside letters
      // is word gaps, and letter gaps keep their expected length.
      elem = c.modes[0] - Math.log(dit);
      word = c.modes[1] - Math.log(dit);
      char = Math.min(Math.log(3) + Math.max(elem, 0), word - Math.log(1.8));
    } else if (role === 'open') {
      // Letter gaps or word gaps, timing cannot tell: both fit them equally
      // and the language model decides (VVV or V V V).
      elem = c.modes[0] - Math.log(dit);
      char = c.modes[1] - Math.log(dit) - Math.log(OPEN);
      word = c.modes[1] - Math.log(dit) + Math.log(OPEN);
    } else if (c.modes.length >= 2) {
      elem = c.modes[0] - Math.log(dit);
      char = c.modes[1] - Math.log(dit);
      if (c.modes.length >= 3) word = c.modes[2] - Math.log(dit);
    } else if (c.modes.length === 1) {
      elem = c.modes[0] - Math.log(dit);
    }
  }
  elem = clamp(elem, Math.log(0.5), Math.log(4));
  char = Math.max(char, elem + Math.log(1.6));
  word = Math.max(word, char + Math.log(1.8));
  // A regular fist: every gap sits close to its class (within 10%, median
  // deviation, inside letters and between them). Its gaps are trusted from
  // the first reading, as the refit would trust them, so a letter gap is not
  // read as a word gap or a pause inside a letter to make a familiar word
  // (KKKMM MKMK as K K K MM MK MK, TTMT MMT as MO MO). A beginner's gaps
  // spread two or three times as far and keep the loose start.
  let sdGap = tuning.sdGap;
  let sdInter = tuning.sdInter;
  if (gaps.length >= 8) {
    const c = settledClasses(gapClasses(gaps));
    if (c.modes.length >= 2) {
      const inside: number[] = [];
      const between: number[] = [];
      for (const g of gaps) {
        let k = 0;
        while (k < c.valleys.length && g > c.valleys[k]) k++;
        (k === 0 ? inside : between).push(g - c.modes[Math.min(k, c.modes.length - 1)]);
      }
      if (inside.length >= 3 && between.length >= 3 && mad(inside) < 0.1 && mad(between) < 0.1) sdGap = sdInter = REGULAR_SD;
    }
  }
  return { t0: marks[0]?.start ?? 0, logDit: Math.log(dit), drift: 0, dah, elem, char, word, sdMark: tuning.sdMark, sdGap, sdInter, sdTempo: tuning.sdTempo };
}

/** Re-estimates the fist from a reading. */
export function refit(marks: Mark[], items: Item[], p: FistParams): FistParams {
  const q = { ...p };
  const dahs: number[] = [];
  const dits: number[] = [];
  const elems: number[] = [];
  const chars: number[] = [];
  const words: number[] = [];
  const tempos: { t: number; v: number }[] = [];
  items.forEach((it, n) => {
    if (!it.token) return;
    tempos.push({ t: marks[it.from].start, v: it.tempo });
    for (let k = it.from; k <= it.to; k++) {
      const r = Math.log(marks[k].end - marks[k].start) - it.tempo;
      (it.pattern[k - it.from] === '-' ? dahs : dits).push(r);
      if (k < it.to) elems.push(Math.log(marks[k + 1].start - marks[k].end) - it.tempo);
    }
    const nx = items[n + 1];
    if (nx) {
      const g = Math.log(marks[nx.from].start - marks[it.to].end) - 0.5 * (it.tempo + tempoAt(p, marks[it.to].end));
      (it.space ? words : chars).push(g);
    }
  });
  if (tempos.length >= 3) {
    // Tempo curve: a straight line in log time, the drift shrunk toward none.
    const tm = tempos.reduce((a, x) => a + x.t, 0) / tempos.length;
    const vm = tempos.reduce((a, x) => a + x.v, 0) / tempos.length;
    const sxx = tempos.reduce((a, x) => a + (x.t - tm) ** 2, 0);
    const sxy = tempos.reduce((a, x) => a + (x.t - tm) * (x.v - vm), 0);
    const slope = sxx > 1 ? (sxy / sxx) * (sxx / (sxx + 4)) : 0;
    q.drift = tuning.drift ? slope : 0;
    q.t0 = tm;
    q.logDit = vm;
    const resid = tempos.map((x) => x.v - (vm + slope * (x.t - tm)));
    if (resid.length >= 5) q.sdTempo = clamp(mad(resid), 0.06, 0.3);
  }
  if (dahs.length >= 2) q.dah = clamp(median(dahs) - (dits.length ? median(dits) : 0), Math.log(1.8), Math.log(4.5));
  if (elems.length >= 3) q.elem = clamp(median(elems), Math.log(0.5), Math.log(4));
  if (chars.length >= 2) q.char = Math.max(median(chars), q.elem + Math.log(1.5));
  if (words.length >= 1) q.word = Math.max(median(words), q.char + Math.log(1.5));
  const marksRes = [...dits.map((x) => x - (dits.length ? median(dits) : 0)), ...dahs.map((x) => x - median(dahs))];
  if (marksRes.length >= 6) q.sdMark = clamp(mad(marksRes), 0.1, 0.4);
  if (elems.length >= 6) q.sdGap = clamp(mad(elems), REGULAR_SD, 0.45);
  // One hand keys every gap: letter and word gaps spread about as much as the
  // gaps inside letters (hesitations have their own allowance). A few gaps
  // between letters, some of them misread, must not loosen this.
  const inter = [...chars.map((x) => x - q.char), ...words.map((x) => x - q.word)];
  const interSd = inter.length >= 5 ? mad(inter) : q.sdInter;
  q.sdInter = clamp(interSd, q.sdGap, 1.6 * q.sdGap);
  return q;
}

/** Decodes an over as a whole. `until`: a letter still open at that moment is left out. */
export interface SettleOptions {
  /** Refitting rounds (default 2) and the final search width; the live view uses a quick setting. */
  rounds?: number;
  beam?: number;
  /** Letters already written down, from the start of the over: the reading begins with them. */
  keep?: Kept[];
  /** Letters on screen: kept when a reading that changes them scores less than `tuning.rewrite` better and has fewer letters in known words. */
  prefer?: Kept[];
}

/** Letters of a reading in real words, callsigns, numbers or repeats of an earlier word, and whether that is all of them. */
function known(items: Item[]): { letters: number; all: boolean } {
  let letters = 0;
  let all = true;
  let word = '';
  const recent: string[] = [];
  items.forEach((it, i) => {
    word += it.token ?? '?';
    if (it.space || i === items.length - 1) {
      const ev = wordEvidence(word, recent);
      if (ev.known || ev.repeat) letters += word.length;
      else all = false;
      recent.push(word);
      word = '';
    }
  });
  return { letters, all };
}

/** The search's constraint for letters given from the start of the over (as far as the marks reach). */
function fixedFrom(letters: Kept[], marks: number): Fixed {
  const fixed: Fixed = { sym: '', gap: '' };
  for (const k of letters) {
    if (fixed.sym.length + k.pattern.length > marks) break;
    fixed.sym += k.pattern;
    fixed.gap += 'e'.repeat(Math.max(0, k.pattern.length - 1)) + (k.space ? 'w' : 'c');
  }
  return fixed;
}

/** A letter already written down: its dits and dahs, and whether a word space follows. */
export interface Kept {
  pattern: string;
  space: boolean;
}

/** The quick setting for re-reading on every letter while keying. */
export const LIVE: SettleOptions = { rounds: 1, beam: 150 };

export function settleOver(marks: Mark[], model: DecoderModel, until?: number, opts: SettleOptions = {}): DecoderOutput[] {
  const ms = marks.filter((m) => m.end > m.start);
  if (!ms.length) return [];
  let p = initialParams(model, ms);
  // Fitting rounds use a narrower search; the final reading the full one.
  const rounds = opts.rounds ?? tuning.rounds;
  const fixed = fixedFrom(opts.keep ?? [], ms.length);
  let items = decodeOnce(ms, p, tuning.fitBeam, fixed).items;
  let best = { items, score: -Infinity };
  for (let round = 0; round < rounds; round++) {
    p = refit(ms, items, p);
    best = decodeOnce(ms, p, round === rounds - 1 ? (opts.beam ?? tuning.beam) : tuning.fitBeam, fixed);
    items = best.items;
  }
  // The reading already on screen stands unless another is clearly better:
  // reading the whole over again must not turn a right reading wrong.
  const shown = opts.prefer ?? [];
  if (shown.length > (opts.keep ?? []).length && rounds > 0) {
    const kept = decodeOnce(ms, p, opts.beam ?? tuning.beam, fixedFrom(shown, ms.length));
    // In a near tie the full search is usually right (QRL to QRP, G3XKP to
    // G3YKP, TU V V to V V V), but not when what is on screen is all real
    // words, callsigns, numbers or repeats and it would turn some of them
    // into something else (PARIS to EGAENIS, VVV to EUVEU, TU to Q).
    const close = best.score - kept.score < tuning.rewrite;
    const onScreen = known(kept.items);
    if (kept.items.length && close && onScreen.all && onScreen.letters > known(items).letters) items = kept.items;
  }
  // A letter is still open while the silence after it is shorter than a letter gap.
  if (until !== undefined && items.length) {
    const last = items[items.length - 1];
    const open = Math.exp(last.tempo + (p.elem + p.char) / 2);
    if (until - ms[last.to].end < open) items.pop();
  }
  const out: DecoderOutput[] = [];
  for (const it of items) {
    const dit = Math.exp(it.tempo);
    const dmarks: DecodedMark[] = [];
    let worst = 1;
    for (let k = it.from; k <= it.to; k++) {
      const kind = it.pattern[k - it.from] === '-' ? 'dah' : 'dit';
      dmarks.push({ start: ms[k].start, end: ms[k].end, kind });
      // How far the mark sits from the dit/dah boundary, in units of half the dah ratio.
      const r = Math.log(ms[k].end - ms[k].start) - it.tempo - p.dah / 2;
      worst = Math.min(worst, clamp(Math.abs(r) / (p.dah / 2), 0, 1));
    }
    const char: DecodedChar = {
      token: it.token,
      pattern: it.pattern,
      marks: dmarks,
      start: ms[it.from].start,
      end: ms[it.to].end,
      confidence: it.token ? worst : 0,
      wpm: 1.2 / dit,
    };
    out.push({ kind: 'char', char });
    if (it.space) {
      const nextStart = ms[it.to + 1]?.start ?? ms[it.to].end;
      out.push({ kind: 'space', t: nextStart, gap: nextStart - ms[it.to].end });
    }
  }
  return out;
}
