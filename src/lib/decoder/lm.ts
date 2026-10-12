// Character language model for the second pass: an interpolated trigram over
// Morse tokens (letters, digits, punctuation, prosigns, word space), trained
// at first use on generated operating text: QSO lines, practice phrases,
// English, callsigns and numbers. It only breaks ties the timing leaves open,
// as an experienced listener does; it never outweighs a clearly sent letter.

import { ALL_TOKENS, tokenize } from '../morse/code';
import { CHUNKS, COMMON_WORDS, JOBS, NAMES, PHRASES, QSO_WORDS, STATES, STATE_CITIES, RIGS, ANTENNAS, WEATHER } from '../train/words';
import { callsign, fillPhrase } from '../train/generate';
import { ENGLISH } from '../train/english';
import { COUNTRIES, WORLD_REGIONS, station } from '../train/world';
import { mulberry32, pick } from '../util/random';

const SPACE = ' ';
const VOCAB = [...ALL_TOKENS, SPACE];
/** Characters keyed as sending warm-ups, one letter to a word. */
const DRILLS = ['V'];

export interface LanguageModel {
  /** log P(token | the two tokens before it); `prev` holds up to two tokens, oldest first. */
  logp(prev: readonly string[], token: string): number;
}

function corpus(): string[] {
  const rng = mulberry32(73);
  const lines: string[] = [];
  // Callsigns from everywhere, so a 9V1, JA or DL call is as familiar as a K.
  const call = () => callsign(rng, { mix: 'world' });
  const rst = () => pick(rng, ['599', '579', '559', '449', '5NN', '339', '569']);

  const num = (n: number) => Array.from({ length: n }, () => Math.floor(rng() * 10)).join('');
  for (let i = 0; i < 400; i++) lines.push(fillPhrase(rng, pick(rng, PHRASES)));
  for (let i = 0; i < 400; i++) {
    // Stations from everywhere: call, local name, city and region together.
    const st = station(rng, 'world');
    const a = call();
    const b = st.call;
    const n = st.name;
    const city = () => `${st.qth} ${st.region}`;
    const state = () => st.region;
    lines.push(
      pick(rng, [
        `CQ CQ DE ${a} ${a} K`,
        `CQ CQ CQ DE ${a} ${a} ${a} K`,
        `${a} DE ${b} ${b} K`,
        `${a} DE ${b} GM TNX FER CALL UR RST ${rst()} ${rst()} NAME ${n} ${n} QTH ${city()} HW? ${a} DE ${b} K`,
        `R R TNX ${n} UR RST ${rst()} NAME ${n} QTH ${city()} BK`,
        `RIG HR IS ${pick(rng, RIGS)} ES ANT IS ${pick(rng, ANTENNAS)} WX ${pick(rng, WEATHER)}`,
        `TNX FER QSO ${n} 73 ES GL ${a} DE ${b} <SK>`,
        `${a} 5NN ${num(3)} TU`,
        `${a} TU 5NN ${state()}`,
        `QRZ? DE ${a}`,
        `${a} UR ${rst()} ${state()} BK`,
        // The closing dit dit, keyed as EE or as E E.
        `TU ${a} 73 <SK> ${i % 2 ? 'E E' : 'EE'}`,
        `PSE QRS AGN? <BK>`,
        `VVV VVV DE ${a}`,
      ]),
    );
  }
  for (let i = 0; i < 400; i++) {
    const words = Array.from({ length: 3 + Math.floor(rng() * 6) }, () => pick(rng, rng() < 0.75 ? COMMON_WORDS : QSO_WORDS));
    lines.push(words.join(' '));
  }
  for (let i = 0; i < 500; i++) {
    lines.push(Array.from({ length: 3 + Math.floor(rng() * 6) }, () => pick(rng, ENGLISH) + (rng() < 0.1 ? 'S' : '')).join(' '));
  }
  for (let i = 0; i < 150; i++) lines.push(Array.from({ length: 2 + Math.floor(rng() * 4) }, () => num(1 + Math.floor(rng() * 4))).join(' '));
  // A little uniform material so nothing is impossible.
  for (let i = 0; i < 120; i++) {
    lines.push(Array.from({ length: 3 + Math.floor(rng() * 4) }, () => Array.from({ length: 1 + Math.floor(rng() * 5) }, () => pick(rng, ALL_TOKENS)).join('')).join(' '));
  }
  // Sending warm-ups: V keyed as words of one letter (V V V), as beginners
  // practise it. Without them a word of one letter is so unlikely that a
  // clear word space after each V still read as VVV.
  for (let i = 0; i < 80; i++) {
    const c = pick(rng, DRILLS);
    lines.push(Array.from({ length: 2 + Math.floor(rng() * 4) }, () => c).join(' '));
  }
  return lines;
}

let model: LanguageModel | null = null;

/** The shared model, trained on first use (a few milliseconds). */
export function languageModel(): LanguageModel {
  if (model) return model;
  const uni = new Map<string, number>();
  const bi = new Map<string, number>();
  const tri = new Map<string, number>();
  const ctx1 = new Map<string, number>();
  const ctx2 = new Map<string, number>();
  let total = 0;
  for (const line of corpus()) {
    const toks = [SPACE, SPACE, ...tokenize(line), SPACE];
    for (let i = 2; i < toks.length; i++) {
      const [a, b, c] = [toks[i - 2], toks[i - 1], toks[i]];
      uni.set(c, (uni.get(c) ?? 0) + 1);
      bi.set(`${b}|${c}`, (bi.get(`${b}|${c}`) ?? 0) + 1);
      tri.set(`${a}|${b}|${c}`, (tri.get(`${a}|${b}|${c}`) ?? 0) + 1);
      ctx1.set(b, (ctx1.get(b) ?? 0) + 1);
      ctx2.set(`${a}|${b}`, (ctx2.get(`${a}|${b}`) ?? 0) + 1);
      total++;
    }
  }
  const V = VOCAB.length;
  const cache = new Map<string, number>();
  model = {
    logp(prev, token) {
      const a = prev.length >= 2 ? prev[prev.length - 2] : SPACE;
      const b = prev.length >= 1 ? prev[prev.length - 1] : SPACE;
      const key = `${a}|${b}|${token}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const pu = ((uni.get(token) ?? 0) + 1) / (total + V);
      const c1 = ctx1.get(b) ?? 0;
      const pb = c1 ? (bi.get(`${b}|${token}`) ?? 0) / c1 : 0;
      const c2 = ctx2.get(`${a}|${b}`) ?? 0;
      const pt = c2 ? (tri.get(key) ?? 0) / c2 : 0;
      const p = 0.55 * pt + 0.3 * pb + 0.12 * pu + 0.03 / V;
      const lp = Math.log(p);
      cache.set(key, lp);
      return lp;
    },
  };
  return model;
}

let lexicon: Set<string> | null = null;

function words(): Set<string> {
  if (lexicon) return lexicon;
  const all = [
    ...ENGLISH, ...COMMON_WORDS, ...QSO_WORDS, ...CHUNKS, ...NAMES, ...STATES, ...RIGS, ...WEATHER, ...JOBS,
    ...ANTENNAS.flatMap((a) => a.split(' ')),
    // City names whole: SANTA FE must not make FE a word.
    ...Object.values(STATE_CITIES).flat().filter((c) => !c.includes(' ')),
    ...PHRASES.flatMap((p) => p.split(' ')).filter((w) => !w.includes('{')),
    ...COUNTRIES.flatMap((c) => [...c.names, ...c.places.map((p) => p.city)]),
    ...WORLD_REGIONS,
    'HW?', 'QRZ?', 'AGN?', '<AR>', '<SK>', '<BT>', '<KN>', '<BK>', 'EE', 'TEST', 'VVV', 'PARIS',
  ];
  lexicon = new Set(all);
  return lexicon;
}

// Amateur callsign shape: a prefix of one or two characters (letters, or a
// digit and a letter), the call-area digit, then one to four letters.
const CALLSIGN = /^(?:[A-Z]{1,2}|[A-Z]\d|\d[A-Z])\d[A-Z]{1,4}$/;
const NUMBER = /^\d{1,4}$|^[5][N9][N9]$/;

/**
 * Word-level evidence an experienced listener uses: is it a word, a callsign
 * or a number they would expect, and does it repeat one just sent (CQ CQ, the
 * call twice, 579 579, V V V)? 1 or 0 each.
 */
const knownCache = new Map<string, number>();

/** In the lexicon, or a plural or -ED/-ING form of a word that is. */
function isWord(w: string): boolean {
  const lex = words();
  if (lex.has(w)) return true;
  if (w.length < 4) return false;
  for (const suffix of ['S', 'ES', 'ED', 'D', 'ING']) {
    if (w.endsWith(suffix) && lex.has(w.slice(0, -suffix.length))) return true;
  }
  return w.endsWith('ING') && lex.has(w.slice(0, -3) + 'E');
}

export function wordEvidence(word: string, recent: readonly string[]): { known: number; repeat: number } {
  const w = word;
  let known = knownCache.get(w);
  if (known === undefined) {
    known = isWord(w) || CALLSIGN.test(w) || NUMBER.test(w) ? 1 : 0;
    knownCache.set(w, known);
  }
  const repeat = recent.includes(w) ? 1 : 0;
  return { known, repeat };
}
