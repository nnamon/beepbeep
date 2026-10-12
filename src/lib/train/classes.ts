// LICW exercises: for each stage of the syllabus (BC1 to ADV 3, TTR+,
// OverLearn), the exercises its classes use, with their timings, and our own
// notes on how to do each one. For students and for anyone following the
// syllabus alone. The material is generated from your lesson or comes from
// text you load; none of LICW's class texts are included.

import type { Recipe } from './player';
import type { Source } from './cards';

export type ClassId = 'bc1' | 'bc2' | 'bc3' | 'int1' | 'int2' | 'int3' | 'adv1' | 'adv2' | 'adv3' | 'ttrplus' | 'overlearn';

export interface Exercise {
  id: string;
  name: string;
  /** One line for the list. */
  summary: string;
  recipe: Recipe;
  /** What it plays unless you choose your own text. */
  source: Source;
  /** Your text: one card per line (phrases, sentences, stories) or per word. */
  perLine?: boolean;
  /** Cards to generate, and group sizes. */
  count?: number;
  min?: number;
  max?: number;
  /** What to do, what good looks like, and the usual mistake. */
  how: string;
  aim: string;
  mind?: string;
  /** Opens one of BeepBeep's drills instead of the player, e.g. sending with the decoder. */
  drill?: string[];
  /** Speeds to choose from; the first is the default. Character and effective speed both, unless `spacing` stays. */
  speeds?: number[];
  /** Keep the effective speed when you choose a character speed (five-character groups). */
  keepSpacing?: boolean;
}

export interface ClassInfo {
  id: ClassId;
  name: string;
  /** The class speed, as shown. */
  band: string;
  /** Receive drill speeds on this stage. Carousel stages follow your lesson; TTR+ and OverLearn use your own speeds. */
  speeds?: { charWpm: number; effectiveWpm: number };
  /** BC1 and BC2 follow your carousel group. */
  carousel?: 'bc1' | 'bc2';
  routine: string[];
  exercises: Exercise[];
}

/** A speed for the screen: "12 wpm", or "12 wpm characters, 8 wpm overall". */
export function speedText(cw: number, eff: number): string {
  return cw === eff ? `${cw} wpm` : `${cw} wpm characters, ${eff} wpm overall`;
}

/** The same, short enough for a one-line subtitle on a phone: "12 wpm, 8 overall". */
export function speedShort(cw: number, eff: number): string {
  return cw === eff ? `${cw} wpm` : `${cw} wpm, ${eff} overall`;
}

const spell = (when: 'before' | 'after' | 'end', delay: number, after = 0) => ({ when, spell: true, delay, after });
const word = (when: 'before' | 'after' | 'end', delay: number, after = 0) => ({ when, spell: false, delay, after });

// ---- Exercise patterns. Speeds and pauses follow the class presets. ----

function familiarity(id: string, name: string, w: number, source: Source, opts: { spelled?: boolean; plays?: number; delay?: number; after?: number; perLine?: boolean; count?: number } = {}): Exercise {
  const plays = opts.plays ?? 3;
  return {
    id,
    name,
    summary: `The voice ${opts.spelled ?? true ? 'spells' : 'says'} it, then it plays${plays === 1 ? ' once' : plays === 2 ? ' twice' : ` ${plays === 3 ? 'three' : plays} times`}. At ${w} wpm.`,
    recipe: { wpm: w, fwpm: w, repeats: plays - 1, repeatGap: 2, voice: (opts.spelled ?? true ? spell : word)('before', opts.delay ?? 1.5, opts.after ?? 0.25) },
    source,
    perLine: opts.perLine,
    count: opts.count ?? 15,
    how: `Listen to the voice, then the code. ${plays > 1 ? 'Each time it plays, say' : 'Say'} it out loud along with the code.`,
    aim: 'You know the name the moment you hear the sound, without working it out.',
    mind: "Don't count dits and dahs. Counting builds a translation step you have to unlearn later.",
  };
}

function recognition(id: string, name: string, w: number, source: Source, opts: { spelled?: boolean; delay?: number; after?: number; perLine?: boolean; count?: number } = {}): Exercise {
  const delay = opts.delay ?? 1.5;
  return {
    id,
    name,
    summary: `Hear the sound and say what it is; the voice gives the answer ${delay} s later. At ${w} wpm.`,
    recipe: { wpm: w, fwpm: w, voice: (opts.spelled ?? true ? spell : word)('after', delay, opts.after ?? 2) },
    source,
    perLine: opts.perLine,
    count: opts.count ?? 30,
    how: `Say it out loud as soon as you know it, before the voice. You have ${delay} s.`,
    aim: 'You say it before the voice every time.',
    mind: 'If you are guessing, run Familiarity again first.',
  };
}

function ttr(w: number, delay: number, source: Source = 'chars'): Exercise {
  return {
    id: 'ttr',
    name: 'TTR',
    summary: `Time to recognise: you have ${delay} s to say it before the voice does. At ${w} wpm.`,
    recipe: { wpm: w, fwpm: w, voice: spell('after', delay, 0) },
    source,
    count: 40,
    how: `Each character plays once; the voice names it ${delay} s later. Say it before the voice.`,
    aim: 'Beat the voice two times in three, then nearly every time.',
    mind: "Say it out loud; don't type it. To have your time measured, use the Time to recognise (TTR) drill, where you type.",
  };
}

function vet(reverse: boolean, cw: number, eff: number[]): Exercise {
  const steps = (reverse ? [...eff].reverse() : eff).map((fwpm) => ({ seconds: 30, wpm: cw, fwpm }));
  return {
    id: reverse ? 'vet-reverse' : 'vet',
    name: reverse ? 'Reverse VET (gaps grow)' : 'VET (gaps shrink)',
    summary: reverse
      ? 'Groups of three to copy. The gaps between characters start short and grow every 30 seconds.'
      : 'Groups of three to copy. The gaps between characters start wide and shrink every 30 seconds.',
    recipe: { wpm: cw, fwpm: steps[0].fwpm, steps, voice: spell('end', 0) },
    source: 'groups',
    min: 3,
    max: 3,
    count: 200,
    how: `Copy each group of three on paper for two minutes. The characters stay at ${cw} wpm; the extra space between them ${reverse ? 'grows' : 'shrinks'} every 30 seconds (${steps.map((s) => s.fwpm).join(', then ')} wpm overall). At the end the voice reads every group back so you can check.`,
    aim: reverse ? 'Copy the first 30 seconds, when there is no extra space.' : 'Still keeping up in the last 30 seconds, when the extra space is gone.',
    mind: 'If you miss a character, leave a gap and listen for the next. Stopping to think costs you the next few.',
  };
}

function vst(reverse: boolean, eff: number): Exercise {
  const cw = [24, 20, 16, 12];
  const steps = (reverse ? [...cw].reverse() : cw).map((wpm) => ({ seconds: 30, wpm, fwpm: eff }));
  return {
    id: reverse ? 'vst-reverse' : 'vst',
    name: reverse ? 'Reverse VST (characters speed up)' : 'VST (characters slow down)',
    summary: reverse
      ? 'Pairs to copy. The characters start slow and speed up every 30 seconds.'
      : 'Pairs to copy. The characters start fast and slow down every 30 seconds.',
    recipe: { wpm: steps[0].wpm, fwpm: eff, steps, voice: spell('end', 0) },
    source: 'groups',
    min: 2,
    max: 2,
    count: 200,
    how: `Copy each pair on paper for two minutes. The gaps stay wide (${eff} wpm overall), but the characters themselves are sent at ${steps.map((s) => s.wpm).join(', then ')} wpm, changing every 30 seconds. At the end the voice reads every pair back.`,
    aim: 'Copy the 24 wpm characters as easily as the 12.',
    mind: 'At 24 wpm a character is too fast to count, so you have to hear its shape.',
  };
}

function groupsOf(min: number, max: number, cw: number, eff: number): Exercise {
  const fixed = min === max;
  return {
    id: fixed ? `groups-${min}` : `groups-${min}-${max}`,
    name: fixed ? `Groups of ${min}` : `Random groups ${min} to ${max}`,
    summary: `Copy groups of ${fixed ? min : `${min} to ${max}`} characters. The voice reads them back at the end. At ${speedText(cw, eff)}.`,
    recipe: { wpm: cw, fwpm: eff, wait: 0.5, voice: spell('end', 0) },
    source: 'groups',
    min,
    max,
    count: fixed ? 12 : 20,
    how: 'Write each group on paper as it comes. At the end the voice reads them all back: mark the ones you got wrong.',
    aim: 'Every group written down, with every character right.',
    mind: 'Write each character as you recognise it, without waiting for the end of the group.',
  };
}

function overlearn(kind: 'letters' | 'words', rate: 1 | 2): Exercise {
  const w = rate === 1 ? 17 : 21;
  return {
    id: `overlearn-${kind}-${rate}`,
    name: `OverLearn ${kind}, rate ${rate}`,
    summary: `Each ${kind === 'letters' ? 'character' : 'word'} plays three times at ${w} wpm. Just listen.`,
    recipe: { wpm: w, fwpm: w, repeats: 2, wait: 0.5 },
    source: kind === 'letters' ? 'chars' : 'words',
    count: 30,
    how: `Each ${kind === 'letters' ? 'character' : 'word'} plays three times at ${w} wpm. Don't write anything. Name it to yourself by the second time it plays.`,
    aim: 'You know it the first time it plays.',
  };
}

function racer(kind: 'letters' | 'words', rate: 1 | 2): Exercise {
  const base = rate === 1 ? 23 : 27;
  const m = rate === 1 ? [1.348, 1.174, 1] : [1.296, 1.148, 1];
  const speeds = m.map((x) => Math.round(base * x));
  return {
    id: `racer-${kind}-${rate}`,
    name: `Speed Racing ${kind}, rate ${rate}`,
    summary: `Each ${kind === 'letters' ? 'character' : 'word'} plays at ${speeds.join(', then ')} wpm.`,
    recipe: { wpm: base, fwpm: base, racer: { multipliers: m }, wait: 1 },
    source: kind === 'letters' ? 'chars' : 'words',
    count: 25,
    how: `Each one plays three times, getting slower: ${speeds.join(', then ')} wpm. Try to know it at ${speeds[0]}; the slower plays let you check.`,
    aim: `You name it at ${speeds[0]} wpm, the first and fastest play.`,
  };
}

function sending(w: number): Exercise {
  return {
    id: 'sending',
    name: 'Hear it, send it',
    summary: 'Copy a character or word, then send it back. BeepBeep shows what it received.',
    recipe: { wpm: w, fwpm: w },
    source: 'chars',
    drill: ['hear-send'],
    how: 'A character or word plays; send it back on your key. BeepBeep decodes your sending and shows what it received.',
    aim: 'BeepBeep reads back exactly what you meant to send, with even spacing.',
    mind: 'Send at the speed you copy. Rushed sending is the commonest fault.',
  };
}

function copyRecap(id: string, name: string, cw: number, eff: number, source: Source, perLine = false, spelled = true): Exercise {
  return {
    id,
    name,
    summary: `Copy everything on paper. The voice reads it back at the end. At ${speedText(cw, eff)}.`,
    recipe: { wpm: cw, fwpm: eff, wait: 1, voice: (spelled ? spell : word)('end', 0) },
    source,
    perLine,
    count: 15,
    how: 'Copy everything on paper. At the end the voice reads it all back: mark what you missed.',
    aim: 'Nine characters in ten right, or better.',
    mind: 'Once a character has gone by, let it go. Leave a gap and keep up.',
  };
}

function callsigns(w: number): Exercise {
  return {
    id: 'callsigns',
    name: 'Callsigns',
    summary: `Hear a callsign and say it; the voice spells it 1 second later. At ${w} wpm.`,
    recipe: { wpm: w, fwpm: w, voice: spell('after', 1, 1) },
    source: 'callsigns',
    count: 20,
    how: 'A callsign plays; say it before the voice spells it back.',
    aim: 'The whole call the first time you hear it.',
    mind: 'Callsigns have a shape: a prefix, a digit, then a suffix. Listen for the digit to anchor it.',
  };
}

function speedRacing(kind: 'spell' | 'words', w: number): Exercise {
  const m = [1.5, 1.35, 1.175, 1];
  const speeds = m.map((x) => Math.round(w * x));
  return {
    id: `racing-${kind}`,
    name: `Speed Racing, ${kind === 'spell' ? 'spelled' : 'words'}`,
    summary: `Each word plays four times, slowing from ${speeds[0]} to ${speeds.at(-1)} wpm; then the voice says it and it plays once more at ${speeds[0]}.`,
    recipe: { wpm: w, fwpm: w, racer: { multipliers: m, say: true, replay: true }, voice: (kind === 'spell' ? spell : word)('after', 0.5, 0.5), wait: 1 },
    source: 'words',
    perLine: kind === 'words',
    count: 20,
    how: `Each word plays at ${speeds.join(', ')} wpm, the voice says it, and it plays once more at ${speeds[0]}.`,
    aim: `You know it at ${speeds[0]} wpm, before the voice says it.`,
    mind: 'On the last fast play, hear the word as one sound.',
  };
}

function phrases(id: string, name: string, cw: number, eff: number, voice: boolean, source: Source = 'phrases'): Exercise {
  return {
    id,
    name,
    summary: voice ? `Hear a short phrase and say it back; the voice gives the answer 2 seconds later. At ${speedText(cw, eff)}.` : `Copy short phrases, with a pause after each. At ${speedText(cw, eff)}.`,
    recipe: { wpm: cw, fwpm: eff, wait: voice ? 0 : 2, ...(voice ? { voice: word('after', 2) } : {}) },
    source,
    perLine: true,
    count: 15,
    how: voice ? 'A phrase plays; say it back before the voice does.' : 'Each phrase is followed by a pause. Copy in your head or on paper.',
    aim: 'Common phrases like CQ, TNX FER CALL and 73 heard as one sound each.',
  };
}

// ---- The classes ----

function bc(n: 1 | 2): ClassInfo {
  const eff = n === 1 ? 8 : 10;
  return {
    id: n === 1 ? 'bc1' : 'bc2',
    name: `BC${n}`,
    band: speedText(12, eff),
    carousel: n === 1 ? 'bc1' : 'bc2',
    routine: [
      'Exercises use the characters of your lesson and of every lesson before it.',
      'Copy by hand, on paper, in the copy exercises.',
      'Fifteen to twenty minutes a day does more than an hour once a week.',
      ...(n === 2 ? ['Treat numbers and prosigns like any other character: say them as you hear them, such as five or A R.'] : []),
    ],
    exercises: [
      familiarity('familiarity', 'Familiarity', 14, 'new', { count: 12 }),
      recognition('recognition', 'Recognition', 14, 'chars'),
      ttr(14, 1),
      vet(false, 12, [8, 10, 11, 12]),
      vet(true, 12, [8, 10, 11, 12]),
      vst(false, eff),
      vst(true, eff),
      groupsOf(5, 5, 12, eff),
      groupsOf(1, 3, 12, eff),
      ...(n === 2 ? [groupsOf(1, 4, 12, eff)] : []),
      overlearn('letters', 1),
      overlearn('words', 1),
      overlearn('letters', 2),
      overlearn('words', 2),
      racer('letters', 1),
      racer('words', 1),
      racer('letters', 2),
      racer('words', 2),
      sending(12),
      phrases('phrases', 'Phrases', 12, eff, true),
      phrases('phrases-quiet', 'Phrases, no voice', 12, eff, false),
      ...(n === 2 ? [phrases('prosign-phrases', 'Prosign phrases', 12, eff, false, 'prosigns')] : []),
      copyRecap('evaluation', 'Progress check', 12, eff, 'phrases', true, false),
    ],
  };
}

function intermediate(n: 1 | 2 | 3): ClassInfo {
  const w = [12, 16, 20][n - 1];
  const fam = [14, 18, 23][n - 1];
  const rec = [14, 16, 20][n - 1];
  return {
    id: `int${n}` as ClassId,
    name: `INT ${n}`,
    band: speedText(w, w),
    speeds: { charWpm: w, effectiveWpm: w },
    routine: [
      'Learn to hear each word as one sound.',
      'Head copy where you can: follow it without writing.',
      'Any exercise can play a text of your own: load it under Your text.',
      'Send every day: the QSO simulator gives you someone to send to.',
    ],
    exercises: [
      familiarity('fam-words', 'Familiarity, words', fam, 'words', { spelled: false, delay: 1, after: 1 }),
      familiarity('fam-spelled', 'Familiarity, spelled', fam, 'words', { delay: 1, after: 1 }),
      familiarity('fam-phrases', 'Familiarity, phrases', fam, 'phrases', { spelled: false, plays: 2, delay: 1, after: 1, perLine: true }),
      familiarity('fam-sentences', 'Familiarity, sentences', fam, 'sentences', { spelled: false, plays: 1, delay: 2, after: 0.5, perLine: true }),
      { ...familiarity('multi', 'Multi words', w, 'multi', { spelled: false, plays: 2, delay: 1, after: 0, perLine: true }), summary: `The voice says two words, then they play twice. At ${w} wpm.`, how: 'Hear the two words said, then sent twice. Say them along with the code.' },
      recognition('rec-spelled', 'Recognition, spelled', rec, 'words', { delay: n === 1 ? 0.75 : 1, after: 1.5 }),
      recognition('rec-words', 'Recognition, words', rec, 'words', { spelled: false, delay: n === 1 ? 0.75 : 1, after: 1.5 }),
      speedRacing('spell', w),
      speedRacing('words', w),
      callsigns(w),
      ...(n === 1 ? [{ ...copyRecap('binomials', 'Binomials', w, w, 'binomials', true), summary: `Common word pairs like SALT AND PEPPER, to copy and hear as one phrase. At ${w} wpm.` }] : []),
      ...(n > 1 ? [phrases('phrases', 'Phrases', w - 4, w - 4, true)] : []),
      ...(n > 1 ? [{ ...copyRecap('affixes', 'Affixes', w, w, 'affixes'), summary: `Common word beginnings and endings, like PRE and ING, to hear as one sound. At ${w} wpm.` }] : []),
      ttr([27, 30, 34][n - 1], 0.75),
      sending(w),
      copyRecap('copy', 'Copy, read back', w, w, 'words'),
    ],
  };
}

function advanced(n: 1 | 2 | 3): ClassInfo {
  const w = [25, 30, 35][n - 1];
  const fam = [28, 40, 40][n - 1];
  const famWords = [28, 35, 40][n - 1];
  return {
    id: `adv${n}` as ClassId,
    name: `ADV ${n}`,
    band: speedText(w, w),
    speeds: { charWpm: w, effectiveWpm: w },
    routine: [
      "Follow the meaning; don't spell words out. Write only what you need to keep.",
      'Stories and sentences of your own play under Your text.',
      'Recognition and Speed Racing train you to hear words as single sounds at speed.',
    ],
    exercises: [
      familiarity('fam-words', 'Familiarity, words', famWords, 'words', { spelled: false, delay: 0.5, after: 0.5 }),
      familiarity('fam-spelled', 'Familiarity, spelled', fam, 'words', { delay: 1, after: 0.5 }),
      familiarity('fam-phrases', 'Familiarity, phrases', fam, 'phrases', { spelled: false, plays: 2, delay: 0.5, after: 0.5, perLine: true }),
      familiarity('fam-sentences', 'Familiarity, sentences', famWords, 'sentences', { spelled: false, plays: 1, delay: 2, after: 0.5, perLine: true }),
      recognition('rec-spelled', 'Recognition, spelled', w, 'words', { delay: n === 1 ? 0.5 : 1.25, after: n === 1 ? 0 : 1.5 }),
      recognition('rec-words', 'Recognition, words', w, 'words', { spelled: false, delay: 1.25, after: 1.5 }),
      speedRacing('spell', w),
      speedRacing('words', w),
      callsigns(w),
      { ...copyRecap('affixes', 'Affixes', w, w, 'affixes'), summary: `Common word beginnings and endings, like PRE and ING, to hear as one sound. At ${w} wpm.` },
      {
        id: 'stories',
        name: 'Stories',
        summary: 'Your own story, a line at a time. The voice says each line after it plays.',
        recipe: { wpm: w, fwpm: w, wait: 2, voice: word('after', 1.25) },
        source: 'text',
        perLine: true,
        speeds: [w, w + 5],
        how: 'Load a story under Your text. Each line plays, then the voice says it. Follow the story; check yourself against the voice.',
        aim: 'The story makes sense before the voice confirms it.',
      },
      ttr(40, 0.5),
      ...(n === 3
        ? [{
            id: 'com',
            name: 'Five-character groups',
            summary: 'Five-character groups with fast characters and wide gaps (16 wpm overall), as in commercial traffic.',
            recipe: { wpm: 18, fwpm: 16, wait: 0.5, voice: spell('end', 0) },
            source: 'groups' as Source,
            min: 5,
            max: 5,
            count: 15,
            speeds: [18, 20, 22, 25, 30],
            keepSpacing: true,
            how: 'Copy each group of five on paper. The gaps stay at 16 wpm; raise the character speed as it gets easy.',
            aim: 'Clean copy with the characters at 25 wpm.',
          }]
        : []),
      sending(w),
    ],
  };
}

const TTR_SPEEDS = [12, 16, 18, 20, 25, 30];

const ttrPlus: ClassInfo = {
  id: 'ttrplus',
  name: 'TTR+',
  band: '12 to 30 wpm',
  routine: ['Each pair plays three times, and the voice spells it 0.75 seconds later. Say it before the voice.', 'Pick a speed where you answer before the voice about half the time.'],
  exercises: [
    {
      id: 'spell',
      name: 'Pairs, spelled',
      summary: 'A pair of characters plays three times; the voice spells it 0.75 seconds later.',
      recipe: { wpm: 12, fwpm: 12, repeats: 2, voice: spell('after', 0.75, 3) },
      source: 'groups',
      min: 2,
      max: 2,
      count: 25,
      speeds: TTR_SPEEDS,
      how: 'Each pair plays three times; the voice spells it 0.75 s later. Say it before the voice.',
      aim: 'Before the voice on most pairs at your chosen speed.',
    },
    {
      id: 'words',
      name: 'Word pairs',
      summary: 'Two words play three times; the voice says them 1.25 seconds later.',
      recipe: { wpm: 12, fwpm: 12, repeats: 2, voice: word('after', 1.25, 3) },
      source: 'multi',
      perLine: true,
      count: 20,
      speeds: TTR_SPEEDS,
      how: 'Each word pair plays three times; the voice says it 1.25 s later. Say it first.',
      aim: 'Both words before the voice.',
    },
  ],
};

const OL_SPEEDS = [23, 27, 31];

function ol(id: string, name: string, summary: string, recipe: Omit<Recipe, 'wpm' | 'fwpm'>, source: Source, how: string, extra: Partial<Exercise> = {}): Exercise {
  return { id, name, summary, recipe: { wpm: 23, fwpm: 23, ...recipe }, source, how, aim: 'Known on the first play, at speed.', speeds: OL_SPEEDS, count: 25, ...extra };
}

const overlearnClass: ClassInfo = {
  id: 'overlearn',
  name: 'OverLearn',
  band: '23 to 35 wpm',
  routine: [
    'These exercises play material you already know, at 23 to 31 wpm, until you know it without thinking.',
    'Pick the speed that is just uncomfortable. Move up when it stops being hard.',
    'Stories and sentences of your own play under Your text.',
  ],
  exercises: [
    ol('characters', 'Characters', 'Single characters play one second apart.', { wait: 1 }, 'chars', 'Name each character to yourself as it plays.', { count: 40 }),
    ol('words-2x', 'Words, twice', 'Each word plays twice.', { repeats: 1, wait: 2 }, 'words', 'Each word plays twice. Try to know it the first time.'),
    ol('words-3x', 'Words, three times', 'Each word plays three times.', { repeats: 2, wait: 2 }, 'words', 'Each word plays three times. Try to know it the first time.'),
    ol('binomials', 'Binomials', 'Each word pair plays three times.', { repeats: 2, wait: 2 }, 'binomials', 'Hear the pair as one phrase.', { perLine: true }),
    ol('suffixes', 'Suffixes', 'Each word ending plays three times.', { repeats: 2, wait: 2 }, 'affixes', 'Hear endings like ING and TION as one sound each.'),
    ol('rhythm', 'Rhythm', 'Each word plays once at your speed, then three times half again as fast.', { racer: { multipliers: [1, 1.52, 1.52, 1.52] }, wait: 2 }, 'words', 'The fast plays carry the rhythm of the word. Listen for the shape.'),
    ol('cw-voice-cw', 'CW, voice, CW', 'Each phrase plays, the voice says it, and it plays again.', { voice: word('after', 1.25), again: true, wait: 1 }, 'phrases', 'Copy the phrase, hear it said, then hear it again knowing what it is.', { perLine: true }),
    ol('sentences-cw', 'Sentences', 'Sentences play two seconds apart.', { wait: 2 }, 'sentences', 'Follow each sentence in your head.', { perLine: true }),
    ol('sentences-cv', 'Sentences, voice after', 'Each sentence plays, then the voice says it.', { voice: word('after', 1.25), wait: 2 }, 'sentences', 'Follow the sentence; the voice confirms it.', { perLine: true }),
    ol('sentences-cvc', 'Sentences, CW, voice, CW', 'Each sentence plays, the voice says it, and it plays again.', { voice: word('after', 2), again: true, wait: 1 }, 'sentences', 'Follow it, hear it said, then follow it again.', { perLine: true }),
    ol('racing', 'Speed Racing', 'Each word plays three times, slowing down to your chosen speed.', { racer: { multipliers: [1.348, 1.174, 1] }, wait: 2 }, 'words', 'Catch it at the fastest play.'),
    ol('racing-reversed', 'Speed Racing, reversed', 'Each word plays three times, speeding up from your chosen speed.', { racer: { multipliers: [1, 1.174, 1.348] }, wait: 2 }, 'words', 'Know it at the slow play, and keep up as it speeds up.'),
    ol('voice-after', 'Voice after words', 'Each word plays three times, then the voice says it.', { repeats: 2, voice: { when: 'after', spell: false, delay: 0, after: 0, lastWord: true }, wait: 1 }, 'words', 'Know it before the voice says it.'),
    ol('send-alphabet', 'Sending: alphabet', 'Each letter from A to Z plays three times, with a gap to send it back.', { repeats: 2, wait: 2 }, 'alphabet', 'Listen to the three plays, then send the character back in the gap.'),
    ol('send-numbers', 'Sending: numbers', 'Each number from 1 to 0 plays three times, with a gap to send it back.', { repeats: 2, wait: 2 }, 'numbers', 'Listen, then send the number back in the gap.'),
    ol('send-trigrams', 'Sending: three letters', 'The voice spells a three-letter group and it plays. Then you have 5 seconds to send it.', { voice: spell('before', 0), wait: 5 }, 'trigrams', 'The voice spells a group, then it plays in code. Send it back in the 5 seconds after that.'),
    ol('send-words', 'Sending: words', 'The voice says a word and it plays. Then you have 5 seconds to send it.', { voice: word('before', 0), wait: 5 }, 'words', 'The voice says a word, then it plays in code. Send it back in the 5 seconds after that.'),
    {
      id: 'stories',
      name: 'Stories',
      summary: 'Your own story, a line at a time. The voice says each line after it plays.',
      recipe: { wpm: 20, fwpm: 20, wait: 2, voice: word('after', 1.25) },
      source: 'text',
      perLine: true,
      speeds: [20, 25, 30, 35],
      how: 'Load a story under Your text. Each line plays, then the voice says it.',
      aim: 'The story makes sense before the voice confirms it.',
    },
    {
      id: 'stories-cvc',
      name: 'Stories, CW, voice, CW',
      summary: 'Each line plays, the voice says it, and it plays again.',
      recipe: { wpm: 25, fwpm: 25, wait: 1, voice: word('after', 0.5, 0.5), again: true },
      source: 'text',
      perLine: true,
      speeds: [20, 25, 30, 35],
      how: 'Load a story under Your text. Follow each line, hear it said, then follow it again.',
      aim: 'You copy the line the first time, without needing the second.',
    },
  ],
};

const bc3: ClassInfo = {
  id: 'bc3',
  name: 'BC3',
  band: speedText(12, 12),
  speeds: { charWpm: 12, effectiveWpm: 12 },
  routine: [
    'BC3 is about operating: callsigns, contest exchanges and the order of a QSO.',
    'Use Learn QSOs and the QSO simulator to practise whole contacts.',
  ],
  exercises: [
    familiarity('fam-words', 'Familiarity, QSO words', 14, 'words', { spelled: false, delay: 1, after: 1 }),
    familiarity('fam-spelled', 'Familiarity, spelled', 14, 'words', { delay: 1.5, after: 1 }),
    familiarity('fam-phrases', 'Familiarity, QSO phrases', 14, 'phrases', { spelled: false, plays: 2, delay: 1, after: 1, perLine: true }),
    callsigns(12),
    {
      id: 'contests',
      name: 'Contest exchanges',
      summary: 'Hear a contest exchange and say it; the voice spells it 1 second later. At 12 wpm.',
      recipe: { wpm: 12, fwpm: 12, voice: spell('after', 1, 1) },
      source: 'contest',
      perLine: true,
      count: 15,
      how: 'A contest exchange plays: a callsign, 5NN (the signal report 599), then a serial number or region. Say it before the voice.',
      aim: 'The whole exchange the first time you hear it.',
      mind: '5NN is always 5NN: listen past it for the part that changes.',
    },
    sending(12),
    copyRecap('copy', 'Copy, read back', 12, 12, 'phrases', true, false),
    copyRecap('copy-15', 'Copy, faster characters', 15, 12, 'phrases', true, false),
  ],
};

export const CLASSES: ClassInfo[] = [bc(1), bc(2), bc3, intermediate(1), intermediate(2), intermediate(3), advanced(1), advanced(2), advanced(3), ttrPlus, overlearnClass];

export function classById(id: string): ClassInfo | undefined {
  return CLASSES.find((c) => c.id === id);
}

/** A recipe at a chosen speed: effective speed and timed steps scale with it unless the spacing stays. */
export function atSpeed(r: Recipe, wpm: number, keepSpacing = false): Recipe {
  if (wpm === r.wpm) return r;
  const k = wpm / r.wpm;
  return {
    ...r,
    wpm,
    fwpm: keepSpacing ? r.fwpm : Math.round(r.fwpm * k),
    ...(r.steps ? { steps: r.steps.map((s) => ({ ...s, wpm: Math.round(s.wpm * k), fwpm: Math.round(s.fwpm * k) })) } : {}),
  };
}

/** How Practice groups a class's exercises, in this order. */
export const EXERCISE_GROUPS = ['Recognise', 'Copy', 'Speed', 'Words and phrases', 'On the air', 'Sending'] as const;

export function groupOf(c: ClassInfo, e: Exercise): (typeof EXERCISE_GROUPS)[number] {
  const id = e.id;
  if (e.drill || id.startsWith('send')) return 'Sending';
  if (c.id === 'ttrplus' || /^(fam|familiarity|recognition|rec-|ttr|multi)/.test(id)) return 'Recognise';
  if (/^(vet|vst|groups|evaluation|copy|com)/.test(id)) return 'Copy';
  if (/^(overlearn|racer|racing|characters|words-|rhythm|voice-after)/.test(id)) return 'Speed';
  if (/^(callsigns|contests)/.test(id)) return 'On the air';
  return 'Words and phrases';
}
