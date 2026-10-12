// The two course tracks: classic Koch order and the LICW Beginners Carousel.

export type TrackId = 'koch' | 'licw';

export interface Level {
  /** Stable id, e.g. 'koch-5' or 'licw-bc1-TIN'. */
  id: string;
  /** Short name, e.g. 'Lesson 5' or 'BC1 · TIN'. */
  name: string;
  /** Characters introduced at this level. */
  added: string[];
  /** Every character known once this level is reached (cumulative). */
  known: string[];
  /** Letter pairs practised as one unit from this level on, e.g. BK. */
  words?: string[];
  /** Letter pairs this lesson adds (BK in 2 8 BK). */
  addedWords?: string[];
  /** Recommended character / effective speed. */
  charWpm: number;
  effectiveWpm: number;
}

/**
 * The classic "Koch" order beginning K M R S U, as used by most Koch trainers
 * (e.g. lakey, Morse Code Ninja). LICW's Method Guide 2.2 traces this order to
 * Otto Lipmann's 1919 aptitude-testing work rather than to Koch.
 */
export const KOCH_ORDER = [
  'K', 'M', 'R', 'S', 'U', 'A', 'P', 'T', 'L', 'O', 'W', 'I', '.', 'N', 'J', 'E',
  'F', '0', 'Y', ',', 'V', 'G', '5', '/', 'Q', '9', 'Z', 'H', '3', '8', 'B', '?',
  '4', '2', '7', 'C', '1', 'D', '6', 'X', '<BT>', '<AR>', '<SK>', '<KN>', '<BK>',
];

/** LICW Beginners Carousel groups (Curriculum Guide 2.4): BC1 then BC2. */
export const LICW_BC1 = [
  ['R', 'E', 'A'], ['T', 'I', 'N'], ['P', 'S', 'G'], ['L', 'C', 'D'], ['H', 'O', 'F'], ['U', 'W', 'B'],
];
export const LICW_BC2 = [
  ['K', 'M', 'Y'], ['5', '9', ','], ['Q', 'X', 'V'], ['7', '3', '?'], ['<AR>', '<SK>', '<BT>'],
  ['1', '6', '.'], ['Z', 'J', '/'], ['2', '8'], ['4', '0'],
];
/** BK comes with 2 and 8: sent as the letters B and K, practised as a pair. */
const LICW_BC2_WORDS: Record<number, string[]> = { 7: ['BK'] };

/** A carousel group's key, as LICW names it: REA, 59, (comma), ARSKBT, 28BK. */
export function groupKey(chars: readonly string[], words: readonly string[] = []): string {
  return [...chars, ...words].map((c) => c.replace(/[<>]/g, '')).join('');
}

/** A group as shown: TIN; 5 9 ,; AR SK BT; 2 8 BK. */
function groupName(chars: readonly string[], words: readonly string[] = []): string {
  const all = [...chars, ...words].map((c) => c.replace(/[<>]/g, ''));
  return all.every((c) => /^[A-Z]$/.test(c)) ? all.join('') : all.join(' ');
}

export const BC1_GROUPS = LICW_BC1.map((g) => groupKey(g));
export const BC2_GROUPS = LICW_BC2.map((g, i) => groupKey(g, LICW_BC2_WORDS[i]));

/** Each carousel's groups as choices: key and how it is shown. */
export const CAROUSEL_GROUPS = {
  bc1: LICW_BC1.map((g) => ({ value: groupKey(g), label: groupName(g) })),
  bc2: LICW_BC2.map((g, i) => ({ value: groupKey(g, LICW_BC2_WORDS[i]), label: groupName(g, LICW_BC2_WORDS[i]) })),
};

/** Where you joined each carousel: the group key you started on. */
export interface Carousel {
  bc1: string;
  bc2: string;
}

export const DEFAULT_CAROUSEL: Carousel = { bc1: 'REA', bc2: 'KMY' };

function kochLevels(): Level[] {
  const levels: Level[] = [];
  for (let n = 2; n <= KOCH_ORDER.length; n++) {
    const known = KOCH_ORDER.slice(0, n);
    levels.push({
      id: `koch-${n - 1}`,
      name: `Lesson ${n - 1}`,
      added: n === 2 ? known.slice() : [KOCH_ORDER[n - 1]],
      known,
      charWpm: 20,
      effectiveWpm: 20,
    });
  }
  return levels;
}

/** Groups in carousel order from the one you joined at. */
function rotate<T>(groups: T[], keys: string[], start: string): { group: T; index: number }[] {
  const from = Math.max(0, keys.indexOf(start));
  return groups.map((_, i) => (from + i) % groups.length).map((index) => ({ group: groups[index], index }));
}

/**
 * The carousel as you meet it: each group adds three characters to the ones
 * you have had since you joined. BC2 starts with all of BC1 known.
 */
export function licwLevels(c: Carousel = DEFAULT_CAROUSEL): Level[] {
  const levels: Level[] = [];
  const known: string[] = [];
  const words: string[] = [];
  for (const { group } of rotate(LICW_BC1, BC1_GROUPS, c.bc1)) {
    known.push(...group);
    levels.push({ id: `licw-bc1-${groupKey(group)}`, name: `BC1 · ${groupName(group)}`, added: group, known: known.slice(), charWpm: 12, effectiveWpm: 8 });
  }
  for (const { group, index } of rotate(LICW_BC2, BC2_GROUPS, c.bc2)) {
    const w = LICW_BC2_WORDS[index] ?? [];
    known.push(...group);
    words.push(...w);
    levels.push({
      id: `licw-bc2-${groupKey(group, w)}`,
      name: `BC2 · ${groupName(group, w)}`,
      added: group,
      known: known.slice(),
      ...(words.length ? { words: words.slice() } : {}),
      ...(w.length ? { addedWords: w.slice() } : {}),
      charWpm: 12,
      effectiveWpm: 10,
    });
  }
  return levels;
}

export const KOCH_LEVELS = kochLevels();

export const TRACK_NAMES: Record<TrackId, string> = {
  koch: 'Classic Koch order',
  licw: 'LICW Beginners Carousel',
};

/** Ids saved before the carousel could start anywhere: licw-bc1-2 was TIN, licw-bc2-8 was 28 BK. */
export function migrateLevelId(id: string): string {
  const m = /^licw-(bc[12])-(\d+)$/.exec(id);
  if (!m) return id;
  const keys = m[1] === 'bc1' ? BC1_GROUPS : BC2_GROUPS;
  const key = keys[Number(m[2]) - 1];
  return key ? `licw-${m[1]}-${key}` : id;
}

export function trackOf(levelId: string): TrackId {
  return levelId.startsWith('licw') ? 'licw' : 'koch';
}
