// Practice vocabulary: QSO chunks, words and phrases. Original lists written
// for BeepBeep (no third-party course material).

import { tokenize } from '../morse/code';

/** Short sequences heard as one rhythm: LICW's "natural chunking". */
export const CHUNKS = [
  'CQ', 'DE', 'TU', '73', '5NN', 'RST', 'QTH', 'TNX', 'FB', 'THE', 'ING', 'ED', 'UR', 'ES', 'HR',
  'BK', 'K', 'R', 'OP', 'NAME', 'WX', 'ANT', 'RIG', 'PWR', 'FER', 'GM', 'GA', 'GE', 'OM', 'GL',
  'CUL', 'AGN', 'PSE', 'QRS', 'QRZ', 'QSL', 'QRM', 'QSB', 'HW', '599', '579', '559', 'TEST', 'AND',
  'ION', 'ER', 'ST', 'TH', 'AN', 'IN',
];

/** Common operating words and abbreviations. */
export const QSO_WORDS = [
  'CQ', 'DE', 'K', 'KN', 'BK', 'R', 'RR', 'TU', 'TNX', 'TKS', 'FER', 'UR', 'RST', 'NAME', 'OP', 'QTH',
  'RIG', 'ANT', 'PWR', 'WX', 'HR', 'ES', 'FB', 'GM', 'GA', 'GE', 'GN', 'OM', 'YL', 'XYL', 'HW', 'CPY',
  'AGN', 'PSE', 'QRS', 'QRQ', 'QRM', 'QRN', 'QSB', 'QSL', 'QRZ', 'QRL', 'QSY', 'CUL', 'GL', 'DX', 'SRI',
  'HPE', 'WID', 'ABT', 'VY', 'WKD', 'TEMP', 'SUNNY', 'CLOUDY', 'RAIN', 'SNOW', 'WINDY', 'COLD', 'WARM',
  'DIPOLE', 'VERT', 'YAGI', 'EFHW', 'WATTS', 'QRP', 'KEY', 'BUG', 'PADDLE', 'AGE', 'YRS', 'RETIRED',
  'LICW', 'SKCC', 'POTA', 'SOTA', 'PARK', 'SUMMIT', 'NR', 'BAND', 'SIG', 'GUD', 'NICE', 'MEET',
];

/** Frequent English words. */
export const COMMON_WORDS = [
  'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'ANY', 'CAN', 'HAD', 'HER', 'WAS', 'ONE',
  'OUR', 'OUT', 'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW', 'MAN', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO',
  'WAY', 'WHO', 'BOY', 'DID', 'ITS', 'LET', 'PUT', 'SAY', 'SHE', 'TOO', 'USE', 'THAT', 'WITH', 'HAVE',
  'THIS', 'WILL', 'YOUR', 'FROM', 'THEY', 'KNOW', 'WANT', 'BEEN', 'GOOD', 'MUCH', 'SOME', 'TIME',
  'VERY', 'WHEN', 'COME', 'HERE', 'JUST', 'LIKE', 'LONG', 'MAKE', 'MANY', 'MORE', 'ONLY', 'OVER',
  'SUCH', 'TAKE', 'THAN', 'THEM', 'WELL', 'WERE', 'WHAT', 'RADIO', 'SOUND', 'WORK', 'HOME', 'HAND',
  'HOUSE', 'WORLD', 'STILL', 'LEARN', 'PLANT', 'COVER', 'FOOD', 'SUN', 'FOUR', 'BETWEEN', 'STATE',
  'KEEP', 'EYE', 'NEVER', 'LAST', 'THOUGHT', 'CITY', 'TREE', 'CROSS', 'FARM', 'HARD', 'START',
  'STORY', 'SAW', 'FAR', 'SEA', 'DRAW', 'LEFT', 'LATE', 'RUN', 'WHILE', 'PRESS', 'CLOSE', 'NIGHT',
  'REAL', 'LIFE', 'FEW', 'NORTH', 'OPEN', 'SEEM', 'TOGETHER', 'NEXT', 'WHITE', 'BEGIN', 'GOT', 'WALK',
  'EXAMPLE', 'EASE', 'PAPER', 'GROUP', 'ALWAYS', 'MUSIC', 'THOSE', 'BOTH', 'MARK', 'OFTEN', 'LETTER',
  'UNTIL', 'MILE', 'RIVER', 'CAR', 'FEET', 'CARE', 'SECOND', 'BOOK', 'CARRY', 'TOOK', 'SCIENCE', 'EAT',
  'ROOM', 'FRIEND', 'BEGAN', 'IDEA', 'FISH', 'MOUNTAIN', 'STOP', 'ONCE', 'BASE', 'HEAR', 'HORSE',
  'CUT', 'SURE', 'WATCH', 'COLOR', 'FACE', 'WOOD', 'MAIN', 'ENOUGH', 'PLAIN', 'GIRL', 'USUAL', 'YOUNG',
  'READY', 'ABOVE', 'EVER', 'RED', 'LIST', 'THOUGH', 'FEEL', 'TALK', 'BIRD', 'SOON', 'BODY', 'DOG',
  'FAMILY', 'DIRECT', 'POSE', 'LEAVE', 'SONG', 'MEASURE', 'DOOR', 'PRODUCT', 'BLACK', 'SHORT',
  'NUMBER', 'CLASS', 'WIND', 'QUESTION', 'HAPPEN', 'COMPLETE', 'SHIP', 'AREA', 'HALF', 'ROCK', 'ORDER',
  'FIRE', 'SOUTH', 'PROBLEM', 'PIECE', 'TOLD', 'KNEW', 'PASS', 'SINCE', 'TOP', 'WHOLE', 'KING',
  'SPACE', 'HEARD', 'BEST', 'HOUR', 'BETTER', 'TRUE', 'DURING', 'HUNDRED', 'FIVE', 'REMEMBER', 'STEP',
  'EARLY', 'HOLD', 'WEST', 'GROUND', 'INTEREST', 'REACH', 'FAST', 'VERB', 'SING', 'LISTEN', 'SIX',
  'TABLE', 'TRAVEL', 'LESS', 'MORNING', 'TEN', 'SIMPLE', 'SEVERAL', 'VOWEL', 'TOWARD', 'WAR', 'LAY',
  'AGAINST', 'PATTERN', 'SLOW', 'CENTER', 'LOVE', 'PERSON', 'MONEY', 'SERVE', 'APPEAR', 'ROAD', 'MAP',
  'RAIN', 'RULE', 'GOVERN', 'PULL', 'COLD', 'NOTICE', 'VOICE', 'UNIT', 'POWER', 'TOWN', 'FINE',
  'CERTAIN', 'FLY', 'FALL', 'LEAD', 'CRY', 'DARK', 'MACHINE', 'NOTE', 'WAIT', 'PLAN', 'FIGURE', 'STAR',
  'BOX', 'NOUN', 'FIELD', 'REST', 'CORRECT', 'ABLE', 'POUND', 'DONE', 'BEAUTY', 'DRIVE', 'STOOD',
  'CONTAIN', 'FRONT', 'TEACH', 'WEEK', 'FINAL', 'GAVE', 'GREEN', 'OH', 'QUICK', 'DEVELOP', 'OCEAN',
  'WARM', 'FREE', 'MINUTE', 'STRONG', 'SPECIAL', 'MIND', 'BEHIND', 'CLEAR', 'TAIL', 'PRODUCE', 'FACT',
  'STREET', 'INCH', 'MULTIPLY', 'NOTHING', 'COURSE', 'STAY', 'WHEEL', 'FULL', 'FORCE', 'BLUE', 'OBJECT',
  'DECIDE', 'SURFACE', 'DEEP', 'MOON', 'ISLAND', 'FOOT', 'SYSTEM', 'BUSY', 'TEST', 'RECORD', 'BOAT',
  'COMMON', 'GOLD', 'POSSIBLE', 'PLANE', 'STEAD', 'DRY', 'WONDER', 'LAUGH', 'THOUSAND', 'AGO', 'RAN',
  'CHECK', 'GAME', 'SHAPE', 'EQUATE', 'HOT', 'MISS', 'BROUGHT', 'HEAT', 'SNOW', 'TIRE', 'BRING', 'YES',
  'DISTANT', 'FILL', 'EAST', 'PAINT', 'LANGUAGE', 'AMONG',
];

/** Whole QSO lines for phrase practice. Placeholders are filled by `fillPhrase`. */
export const PHRASES = [
  'TNX FER CALL', 'UR RST {RST}', 'NAME IS {NAME}', 'NAME {NAME} {NAME}', 'QTH IS {QTH}',
  'QTH {QTH} {QTH}', 'RIG HR IS {RIG}', 'ANT IS {ANT}', 'WX HR {WX}', 'HW CPY?', 'TNX FER QSO',
  'GL ES 73', 'CUL 73', 'FB OM', 'PSE QRS', 'QRZ?', 'AGN AGN', 'R R TNX', 'GUD SIG HR', 'PWR {PWR} WATTS',
  'CQ CQ DE {CALL} {CALL} K', '{CALL} DE {CALL} K', 'TU 73 <SK>', 'BK TNX FER RPT', 'NICE TO MEET U',
  'RETIRED {JOB}', 'AGE {AGE} YRS', 'HPE CUL', 'VY FB QSO', '5NN {STATE}',
];

export const NAMES = [
  'BOB', 'JIM', 'ANN', 'SUE', 'TOM', 'DAN', 'JOE', 'KEN', 'ROB', 'LIZ', 'MIKE', 'DAVE', 'JOHN', 'MARY',
  'PAT', 'RAY', 'SAM', 'TED', 'AL', 'ED', 'BILL', 'GARY', 'HANK', 'JACK', 'LEN', 'MAX', 'NED', 'RON',
  'STAN', 'WALT', 'AMY', 'BETH', 'CAROL', 'DEB', 'EVA', 'GAIL', 'JAN', 'KAY', 'LOU', 'MEG', 'PEG',
  'ROSE', 'TINA', 'VAL', 'HANS', 'PIET', 'ERIK', 'LARS', 'TARO', 'KENJI', 'LUCA', 'MARCO', 'JUAN',
];

export const STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
  'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
  'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

export const STATE_CITIES: Record<string, string[]> = {
  MA: ['BOSTON', 'SALEM'], NY: ['ALBANY', 'BUFFALO'], CA: ['FRESNO', 'SAN DIEGO'], TX: ['AUSTIN', 'DALLAS'],
  WI: ['MADISON', 'GREEN BAY'], OH: ['DAYTON', 'TOLEDO'], FL: ['TAMPA', 'MIAMI'], CO: ['DENVER', 'BOULDER'],
  WA: ['SEATTLE', 'SPOKANE'], AZ: ['TUCSON', 'MESA'], MN: ['DULUTH', 'ST PAUL'], OR: ['BEND', 'SALEM'],
  NC: ['RALEIGH', 'DURHAM'], VA: ['RICHMOND', 'NORFOLK'], PA: ['ERIE', 'YORK'], IL: ['PEORIA', 'CHICAGO'],
  GA: ['ATLANTA', 'MACON'], MI: ['LANSING', 'FLINT'], UT: ['OGDEN', 'PROVO'], NM: ['TAOS', 'SANTA FE'],
};

export const RIGS = ['IC7300', 'K3', 'KX2', 'FT991', 'TS590', 'K4', 'FT710', 'IC705', 'QCX', 'FT891', 'KX3', 'TS890'];
export const ANTENNAS = ['DIPOLE', 'EFHW', 'VERT', 'YAGI', 'LOOP', 'G5RV', 'HEX BEAM', 'OCF DIPOLE', 'WIRE'];
export const WEATHER = ['SUNNY', 'CLOUDY', 'RAIN', 'SNOW', 'WINDY', 'FOG', 'CLEAR', 'HOT', 'COLD'];
export const JOBS = ['ENGINEER', 'TEACHER', 'PILOT', 'NURSE', 'FARMER', 'COP', 'CHEF', 'DOCTOR'];

/** True when every token in `text` is in the known set (spaces always allowed). */
export function usesOnly(text: string, known: Set<string>): boolean {
  return tokenize(text).every((t) => t === ' ' || known.has(t));
}

export function wordsFromKnown(list: readonly string[], known: Set<string>): string[] {
  return list.filter((w) => usesOnly(w, known));
}
