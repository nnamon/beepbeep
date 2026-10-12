// Reads a decoded over (possibly with copy errors) into QSO fields.

import { WORLD_REGIONS } from '../train/world';

/** States, provinces and countries a station may send as its region. */
export const REGION_SET: ReadonlySet<string> = new Set(WORLD_REGIONS);

// Region codes that are also everyday words or prosigns (SK as in <SK>, ON as
// in "FB ON UR ANT"): they count as a region only after QTH or in a bare SST
// exchange, never on their own.
const AMBIGUOUS = new Set(['SK', 'ON']);
import { editDistance } from '../util/text';

export interface Parsed {
  words: string[];
  calls: string[];
  cq: boolean;
  de: boolean;
  rst: string | null;
  name: string | null;
  qth: string | null;
  state: string | null;
  serial: string | null;
  skcc: string | null;
  /** Ends the over and hands it back: K, KN, BK, AR. */
  handover: boolean;
  /** Signing off: 73, SK, TU at the end. */
  signoff: boolean;
  agn: boolean;
  qrs: boolean;
  qrq: boolean;
  qrz: boolean;
  /** Asked something: NAME?, QTH?, RST?, HW? */
  asks: ('name' | 'qth' | 'rst' | 'rig' | 'wx' | 'call')[];
  /** Topic words the operator mentioned (for a friendly reply). */
  topics: { rig?: string; ant?: string; wx?: string; pwr?: string; age?: string; job?: string };
}

const KEYWORDS = new Set([
  'CQ', 'DE', 'K', 'KN', 'BK', 'R', 'RR', 'TU', 'TNX', 'TKS', 'FER', 'UR', 'RST', 'NAME', 'OP', 'NM',
  'QTH', 'IS', 'HR', 'ES', 'FB', 'GM', 'GA', 'GE', 'GN', 'OM', 'HW', 'CPY', 'AGN', 'PSE', 'QRS', 'QRQ',
  'QRZ', 'QRZ?', 'CUL', '73', 'GL', 'SK', 'AR', 'BT', '5NN', 'NR', 'TEST', 'SST', 'SKCC', 'POTA', 'SOTA',
  'RIG', 'ANT', 'WX', 'PWR', 'AGE', '?', 'CALL', 'QSO', 'HPE', 'SRI', 'VY', 'GUD', 'SIG', 'ON', 'TO', 'A',
]);

const CALL_RE = /^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{1,3}\d[A-Z]{1,4}$/;
const RST_RE = /^[1-5][1-9N][1-9N]$/;

export function isCallsign(w: string): boolean {
  return CALL_RE.test(w) && !RST_RE.test(w) && w !== '5NN' && !/^\d+[A-Z]?$/.test(w);
}

/** Splits decoded text into words, prosigns as their own words without brackets. */
export function words(text: string): string[] {
  return text
    .toUpperCase()
    .replace(/<([A-Z]{2})>/g, ' $1 ')
    .replace(/=/g, ' BT ')
    .replace(/\+/g, ' AR ')
    .split(/\s+/)
    .filter(Boolean);
}

/** `regions`: what counts as a state, province or country (add your own if it is not listed). */
export function parse(text: string, regions: ReadonlySet<string> = REGION_SET): Parsed {
  const w = words(text);
  const p: Parsed = {
    words: w,
    calls: [],
    cq: false,
    de: false,
    rst: null,
    name: null,
    qth: null,
    state: null,
    serial: null,
    skcc: null,
    handover: false,
    signoff: false,
    agn: false,
    qrs: false,
    qrq: false,
    qrz: false,
    asks: [],
    topics: {},
  };
  let hw = false;
  for (let i = 0; i < w.length; i++) {
    const x = w[i];
    const next = (n = 1) => w[i + n];
    if (x === 'CQ') p.cq = true;
    else if (x === 'DE') p.de = true;
    else if (x === 'AGN' || x === 'AGN?' || x === '?') p.agn = true;
    else if (x === 'QRS') p.qrs = true;
    else if (x === 'QRQ') p.qrq = true;
    else if (x === 'QRZ' || x === 'QRZ?') p.qrz = true;
    else if (isCallsign(x)) {
      if (!p.calls.includes(x)) p.calls.push(x);
    } else if ((x === 'RST' || x === 'UR') && next() && RST_RE.test(next()!.replace('?', ''))) {
      p.rst = norm(next()!);
    } else if (RST_RE.test(x) && !p.rst && (w[i - 1] === 'UR' || w[i - 1] === 'RST' || x === '5NN' || /N/.test(x) || bareReport(w, i))) {
      p.rst = norm(x);
    } else if (x === 'NAME' || x === 'OP' || x === 'NM') {
      let j = i + 1;
      while (w[j] === 'IS' || w[j] === 'HR' || w[j] === 'BT') j++;
      if (w[j] && w[j].endsWith('?')) p.asks.push('name');
      else if (w[j] && !KEYWORDS.has(w[j]) && /^[A-Z]{2,10}$/.test(w[j])) p.name ??= w[j];
    } else if (x === 'NAME?') p.asks.push('name');
    else if (x === 'QTH?') p.asks.push('qth');
    else if (x === 'RST?') p.asks.push('rst');
    else if (x === 'QTH') {
      let j = i + 1;
      while (w[j] === 'IS' || w[j] === 'HR' || w[j] === 'NR') j++;
      if (w[j] && w[j].endsWith('?')) p.asks.push('qth');
      else {
        const parts: string[] = [];
        while (w[j] && !KEYWORDS.has(w[j]) && parts.length < 3 && !isCallsign(w[j])) {
          if (parts.length && w[j] === parts[0]) break; // repeated, e.g. "QTH BOSTON BOSTON"
          parts.push(w[j]);
          j++;
        }
        // A region code straight after the city counts even if it is also a
        // keyword or prosign (QTH REGINA SK).
        if (parts.length && w[j] && regions.has(w[j]) && !regions.has(parts[parts.length - 1])) parts.push(w[j]);
        if (parts.length) {
          p.qth ??= parts.join(' ');
          const st = parts.find((s) => regions.has(s));
          if (st) p.state ??= st;
        }
      }
    } else if (x === 'HW' || x === 'HW?') {
      if (x.endsWith('?') || next() === '?' || next() === 'CPY?') hw = true;
    } else if (x === 'NR' && next() && /^\d{1,6}[CTS]?$/.test(next()!)) {
      p.skcc = next()!;
    } else if (/^\d{1,4}$/.test(x) && (w[i - 1] === '5NN' || /^[1-5][9N][9N]$/.test(w[i - 1] ?? ''))) {
      p.serial ??= x.replace(/^0+(?=\d)/, '');
    } else if (regions.has(x) && !AMBIGUOUS.has(x) && !p.state) {
      p.state = x;
    } else if (x === 'RIG' && next()) {
      let j = i + 1;
      while (w[j] === 'IS' || w[j] === 'HR') j++;
      if (w[j] && !KEYWORDS.has(w[j])) p.topics.rig = w[j];
    } else if (x === 'ANT' && next()) {
      let j = i + 1;
      while (w[j] === 'IS' || w[j] === 'HR') j++;
      if (w[j] && !KEYWORDS.has(w[j])) p.topics.ant = w[j];
    } else if (x === 'WX' && next()) {
      let j = i + 1;
      while (w[j] === 'IS' || w[j] === 'HR') j++;
      if (w[j] && !KEYWORDS.has(w[j])) p.topics.wx = w[j];
    } else if (x === 'PWR' && next()) {
      p.topics.pwr = next()!;
    } else if (x === 'AGE' && next() && /^\d{1,3}$/.test(next()!)) {
      p.topics.age = next()!;
    }
  }
  const last = w[w.length - 1];
  const tail = w.slice(-4);
  p.handover = ['K', 'KN', 'BK', 'AR'].includes(last ?? '') || (last ?? '').endsWith('?');
  p.signoff = tail.includes('SK') || (tail.includes('73') && (tail.includes('TU') || last === '73' || last === 'SK' || last === 'EE'));
  // HW? ('how do you copy me?') closing a full over is only the usual way to
  // hand it back. Asked on its own, it wants a report.
  if (hw && !p.rst && !p.name && !p.qth && !p.state && !p.signoff && !Object.keys(p.topics).length) p.asks.push('rst');
  return p;
}

/** Words a report may follow without UR or RST before it: TU 579, R 579, 9V1NE 579. */
const BEFORE_REPORT = new Set(['TU', 'TNX', 'TKS', 'R', 'RR', 'BK', 'GM', 'GA', 'GE', 'GN', 'FB', 'ES']);

/**
 * Word i, three digits that could be a report, is one although no UR or RST
 * comes before it: it is sent twice (579 579), or it follows a greeting, thanks
 * or a callsign and something other than a number follows it (TU 579
 * SINGAPORE). A number in a sentence (UP 135 FT), or alone at the end where a
 * contest serial number goes (9V1NE 123), is not a report.
 */
function bareReport(w: string[], i: number): boolean {
  const prev = w[i - 1];
  const next = w[i + 1];
  if (next === w[i]) return true;
  return (prev === undefined || BEFORE_REPORT.has(prev) || isCallsign(prev)) && next !== undefined && !/^\d/.test(next);
}

/** Prosigns that end your turn when they are the last thing you send. */
const ENDINGS = new Set(['K', 'KN', 'SK', 'VA', 'AR']);
/** What may follow SK in a sign-off: a last goodbye. */
const AFTER_SK = new Set(['EE', 'E', 'EEE', 'TU', '73', 'GL']);

/**
 * Word i (VA, SK or AR, or any region) is sent as a region, not as a prosign:
 * it is your own region (`own`), it follows a report or the same word (579 VA
 * VA), or it is part of a QTH (QTH NORTH LITTLE ROCK AR). Straight after a
 * callsign it is the prosign (DE W4VA VA).
 */
function asRegion(w: string[], i: number, own: string): boolean {
  const x = w[i];
  if (!REGION_SET.has(x) && x !== own) return false;
  const prev = w[i - 1] ?? '';
  if (isCallsign(prev)) return false;
  if (x === own || prev === x || RST_RE.test(prev) || prev === '5NN') return true;
  // Back over the town's words (letters only) to QTH.
  for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
    if (w[j] === 'QTH') return true;
    if (!/^[A-Z]+$/.test(w[j]) || (KEYWORDS.has(w[j]) && !REGION_SET.has(w[j]))) break;
  }
  return false;
}

/**
 * True when what you have sent so far ends your turn: K, KN, AR or SK at the
 * end, or BK at the end of an over that does not start with it. HW?, 73 or a
 * leading BK in the middle of an over do not end it, and neither does VA, SK
 * or AR sent as a region (see asRegion); `own` is your own region, if you set one.
 */
export function endsTurn(text: string, own = ''): boolean {
  const w = words(text);
  const mine = own.trim().toUpperCase();
  const last = w[w.length - 1];
  if (!last) return false;
  if (last === 'BK') return w.length > 1;
  if (asRegion(w, w.length - 1, mine)) return false;
  if (ENDINGS.has(last)) return true;
  const sk = Math.max(w.lastIndexOf('SK'), w.lastIndexOf('VA'));
  return sk >= 0 && sk < w.length - 1 && !asRegion(w, sk, mine) && w.slice(sk + 1).every((x) => AFTER_SK.has(x));
}

function norm(rst: string): string {
  return rst.replace('?', '').replace(/N/g, '9');
}

/** Callsign similarity: 0 exact, 1-2 close (busted), Infinity unrelated. */
export function callDistance(heard: string, actual: string): number {
  const d = editDistance([...heard], [...actual]);
  return d <= 2 && heard.length >= 3 ? d : Number.POSITIVE_INFINITY;
}

/** The part of `actual` most likely missed when `heard` was copied (for repairs). */
export function missingPart(heard: string, actual: string): string {
  // Longest common prefix, then the rest of the actual call is what to repeat.
  let i = 0;
  while (i < heard.length && i < actual.length && heard[i] === actual[i]) i++;
  const tail = actual.slice(i);
  return tail.length ? tail : actual.slice(-3);
}
