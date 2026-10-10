// International Morse code (ITU-R M.1677-1) plus the prosigns operators use.
// Patterns use '.' for a dit and '-' for a dah. They are data for the encoder
// and decoder only; the UI draws rhythm to scale and never shows these strings.

export type Pattern = string;

const LETTERS: Record<string, Pattern> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
};

const DIGITS: Record<string, Pattern> = {
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
};

const PUNCTUATION: Record<string, Pattern> = {
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', ')': '-.--.-', ':': '---...', ';': '-.-.-.', '-': '-....-',
  '_': '..--.-', '"': '.-..-.', '@': '.--.-.',
};

/**
 * Prosigns are written as <XX>. Several share a pattern with punctuation:
 * AR = '+', BT = '=', KN = '(', AS = '&'. The prosign is the canonical token.
 */
const PROSIGNS: Record<string, Pattern> = {
  '<AR>': '.-.-.', '<BT>': '-...-', '<SK>': '...-.-', '<KN>': '-.--.',
  '<BK>': '-...-.-', '<AS>': '.-...', '<SN>': '...-.', '<CT>': '-.-.-',
  '<HH>': '........',
};

/** Punctuation that is the same sound as a prosign; maps to the prosign token. */
export const PROSIGN_ALIASES: Record<string, string> = {
  '+': '<AR>', '=': '<BT>', '(': '<KN>', '&': '<AS>',
};

export const CODE: Record<string, Pattern> = {
  ...LETTERS, ...DIGITS, ...PUNCTUATION, ...PROSIGNS,
};

const REVERSE: Record<Pattern, string> = {};
for (const [token, pattern] of Object.entries(CODE)) {
  // First definition wins; prosigns are listed last, so put them in explicitly.
  if (!(pattern in REVERSE)) REVERSE[pattern] = token;
}
for (const [token, pattern] of Object.entries(PROSIGNS)) REVERSE[pattern] = token;

export function patternOf(token: string): Pattern | undefined {
  const t = PROSIGN_ALIASES[token] ?? token.toUpperCase();
  return CODE[t];
}

export function tokenOf(pattern: Pattern): string | undefined {
  return REVERSE[pattern];
}

export function isProsign(token: string): boolean {
  return token.length > 1 && token.startsWith('<') && token.endsWith('>');
}

/** How a token is shown to people: prosigns without brackets (styled overlined in the UI). */
export function displayToken(token: string): string {
  return isProsign(token) ? token.slice(1, -1) : token;
}

/**
 * Splits text into tokens: characters, <prosigns>, and ' ' for word breaks.
 * Unknown characters are dropped. Runs of whitespace collapse to one space.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const s = text.toUpperCase();
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      if (out.length && out[out.length - 1] !== ' ') out.push(' ');
      i++;
      continue;
    }
    if (ch === '<') {
      const close = s.indexOf('>', i);
      if (close > i) {
        const tok = s.slice(i, close + 1);
        if (CODE[tok]) {
          out.push(tok);
          i = close + 1;
          continue;
        }
      }
    }
    const tok = PROSIGN_ALIASES[ch] ?? ch;
    if (CODE[tok]) out.push(tok);
    i++;
  }
  while (out.length && out[out.length - 1] === ' ') out.pop();
  return out;
}

/** Joins tokens back into text, keeping prosigns in <XX> form. */
export function detokenize(tokens: string[]): string {
  return tokens.join('');
}

/** Number of dit-units a token occupies, excluding the trailing gap. */
export function unitsOf(pattern: Pattern): number {
  let u = 0;
  for (let i = 0; i < pattern.length; i++) {
    u += pattern[i] === '.' ? 1 : 3;
    if (i < pattern.length - 1) u += 1;
  }
  return u;
}

export const ALL_TOKENS = Object.keys(CODE);
export const LETTER_TOKENS = Object.keys(LETTERS);
export const DIGIT_TOKENS = Object.keys(DIGITS);
export const PUNCTUATION_TOKENS = Object.keys(PUNCTUATION);
export const PROSIGN_TOKENS = Object.keys(PROSIGNS);
