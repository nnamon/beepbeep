// The two course tracks: classic Koch order and the LICW Beginners Carousel.

export type TrackId = 'koch' | 'licw';

export interface Level {
  /** Stable id, e.g. 'koch-5' or 'licw-bc2-4'. */
  id: string;
  /** Short name, e.g. 'Level 5' or 'BC2 · lesson 4'. */
  name: string;
  /** Characters introduced at this level. */
  added: string[];
  /** Every character known once this level is reached (cumulative). */
  known: string[];
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

/** LICW Beginners Carousel order (Curriculum Guide 2.4): BC1 then BC2. */
export const LICW_BC1 = [
  ['R', 'E', 'A'], ['T', 'I', 'N'], ['P', 'S', 'G'], ['L', 'C', 'D'], ['H', 'O', 'F'], ['U', 'W', 'B'],
];
export const LICW_BC2 = [
  ['K', 'M', 'Y'], ['5', '9', ','], ['Q', 'X', 'V'], ['7', '3', '?'], ['<AR>', '<SK>', '<BT>'],
  ['1', '6', '.'], ['Z', 'J', '/'], ['2', '8', '<BK>'], ['4', '0'],
];

function kochLevels(): Level[] {
  const levels: Level[] = [];
  for (let n = 2; n <= KOCH_ORDER.length; n++) {
    const known = KOCH_ORDER.slice(0, n);
    levels.push({
      id: `koch-${n - 1}`,
      name: `Level ${n - 1}`,
      added: n === 2 ? known.slice() : [KOCH_ORDER[n - 1]],
      known,
      charWpm: 20,
      effectiveWpm: 20,
    });
  }
  return levels;
}

function licwLevels(): Level[] {
  const levels: Level[] = [];
  const known: string[] = [];
  LICW_BC1.forEach((chars, i) => {
    known.push(...chars);
    levels.push({ id: `licw-bc1-${i + 1}`, name: `BC1 · lesson ${i + 1}`, added: chars, known: known.slice(), charWpm: 12, effectiveWpm: 8 });
  });
  LICW_BC2.forEach((chars, i) => {
    known.push(...chars);
    levels.push({ id: `licw-bc2-${i + 1}`, name: `BC2 · lesson ${i + 1}`, added: chars, known: known.slice(), charWpm: 12, effectiveWpm: 10 });
  });
  return levels;
}

export const TRACKS: Record<TrackId, { name: string; levels: Level[] }> = {
  koch: { name: 'Classic Koch order', levels: kochLevels() },
  licw: { name: 'LICW Beginners Carousel', levels: licwLevels() },
};

export function levelById(id: string): Level | undefined {
  for (const t of Object.values(TRACKS)) {
    const l = t.levels.find((x) => x.id === id);
    if (l) return l;
  }
  return undefined;
}

export function trackOf(levelId: string): TrackId {
  return levelId.startsWith('licw') ? 'licw' : 'koch';
}

/** LICW intermediate and advanced speed bands, for comfort/stretch suggestions. */
export const LICW_BANDS = [
  { id: 'BC', wpm: 12 },
  { id: 'INT1', wpm: 12 },
  { id: 'INT2', wpm: 16 },
  { id: 'INT3', wpm: 20 },
  { id: 'ADV1', wpm: 25 },
  { id: 'ADV2', wpm: 35 },
  { id: 'ADV3', wpm: 45 },
];
