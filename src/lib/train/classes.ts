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
  /** BC1 and BC2 follow your carousel group. */
  carousel?: 'bc1' | 'bc2';
  routine: string[];
  exercises: Exercise[];
}

const spell = (when: 'before' | 'after' | 'end', delay: number, after = 0) => ({ when, spell: true, delay, after });
const word = (when: 'before' | 'after' | 'end', delay: number, after = 0) => ({ when, spell: false, delay, after });

// ---- Exercise patterns. Speeds and pauses follow the class presets. ----

function familiarity(id: string, name: string, w: number, source: Source, opts: { spelled?: boolean; plays?: number; delay?: number; after?: number; perLine?: boolean; count?: number } = {}): Exercise {
  const plays = opts.plays ?? 3;
  return {
    id,
    name,
    summary: `The voice says it first, then it plays ${plays === 1 ? 'once' : `${plays} times`}. ${w} wpm.`,
    recipe: { wpm: w, fwpm: w, repeats: plays - 1, repeatGap: 2, voice: (opts.spelled ?? true ? spell : word)('before', opts.delay ?? 1.5, opts.after ?? 0.25) },
    source,
    perLine: opts.perLine,
    count: opts.count ?? 15,
    how: `Listen to the name, then the sound${plays > 1 ? ', each time it plays' : ''}. Say the name with it, out loud.`,
    aim: 'The sound and the name arrive together, with no working out.',
    mind: "Don't count dits and dahs. Counting builds a translation step you have to unlearn later.",
  };
}

function recognition(id: string, name: string, w: number, source: Source, opts: { spelled?: boolean; delay?: number; after?: number; perLine?: boolean; count?: number } = {}): Exercise {
  const delay = opts.delay ?? 1.5;
  return {
    id,
    name,
    summary: `It plays, then the voice says it ${delay} s later. ${w} wpm.`,
    recipe: { wpm: w, fwpm: w, voice: (opts.spelled ?? true ? spell : word)('after', delay, opts.after ?? 2) },
    source,
    perLine: opts.perLine,
    count: opts.count ?? 30,
    how: `Say it out loud as soon as you know it, before the voice. You have ${delay} s.`,
    aim: 'Ahead of the voice every time.',
    mind: 'If you are guessing, run Familiarity again first.',
  };
}

function ttr(w: number, delay: number, source: Source = 'chars'): Exercise {
  return {
    id: 'ttr',
    name: 'TTR',
    summary: `Time to recognise: ${delay} s before the voice. ${w} wpm.`,
    recipe: { wpm: w, fwpm: w, voice: spell('after', delay, 0) },
    source,
    count: 40,
    how: `Each character plays once; the voice names it ${delay} s later. Say it before the voice.`,
    aim: 'Before the voice on two in three, then on nearly all.',
    mind: "Say it, don't type it. BeepBeep's typed TTR drill measures your time if you want a number.",
  };
}

function vet(reverse: boolean, cw: number, eff: number[]): Exercise {
  const steps = (reverse ? [...eff].reverse() : eff).map((fwpm) => ({ seconds: 30, wpm: cw, fwpm }));
  return {
    id: reverse ? 'vet-reverse' : 'vet',
    name: reverse ? 'Reverse VET' : 'VET',
    summary: `Three-character groups. Spacing ${steps.map((s) => s.fwpm).join(', ')} wpm, 30 s each.`,
    recipe: { wpm: cw, fwpm: steps[0].fwpm, steps, voice: spell('end', 0) },
    source: 'groups',
    min: 3,
    max: 3,
    count: 200,
    how: reverse
      ? `Groups of three at ${cw} wpm. The run starts with no extra space and adds it back every 30 s. Copy on paper; the voice reads every group back at the end.`
      : `Groups of three at ${cw} wpm. The space between characters shrinks every 30 s until there is none. Copy on paper; the voice reads every group back at the end.`,
    aim: reverse ? `Copy the first 30 s, at ${cw}/${cw}.` : `Keep up in the last 30 s, at ${cw}/${cw}.`,
    mind: 'Miss one, leave a gap and go on to the next. Never stop to think.',
  };
}

function vst(reverse: boolean, eff: number): Exercise {
  const cw = [24, 20, 16, 12];
  const steps = (reverse ? [...cw].reverse() : cw).map((wpm) => ({ seconds: 30, wpm, fwpm: eff }));
  return {
    id: reverse ? 'vst-reverse' : 'vst',
    name: reverse ? 'Reverse VST' : 'VST',
    summary: `Two-character groups. Character speed ${steps.map((s) => s.wpm).join(', ')} wpm, 30 s each.`,
    recipe: { wpm: steps[0].wpm, fwpm: eff, steps, voice: spell('end', 0) },
    source: 'groups',
    min: 2,
    max: 2,
    count: 200,
    how: `Pairs of characters with ${eff} wpm spacing. The characters themselves ${reverse ? 'speed up' : 'slow down'} every 30 s. Copy on paper; the voice reads every pair back at the end.`,
    aim: 'Copy the 24 wpm characters as easily as the 12.',
    mind: 'At 24 wpm a character is too fast to count, so you have to hear its shape.',
  };
}

function groupsOf(min: number, max: number, cw: number, eff: number): Exercise {
  const fixed = min === max;
  return {
    id: fixed ? `groups-${min}` : `groups-${min}-${max}`,
    name: fixed ? `Groups of ${min}` : `Random groups ${min} to ${max}`,
    summary: `${fixed ? `${min}-character` : `${min} to ${max} character`} groups at ${cw}/${eff}. Read back at the end.`,
    recipe: { wpm: cw, fwpm: eff, wait: 0.5, voice: spell('end', 0) },
    source: 'groups',
    min,
    max,
    count: fixed ? 12 : 20,
    how: 'Copy each group on paper as it comes. The voice reads them all back at the end; mark your copy.',
    aim: 'Every group written, every character right.',
    mind: 'Write each character as you recognise it, without waiting for the end of the group.',
  };
}

function overlearn(kind: 'letters' | 'words', rate: 1 | 2): Exercise {
  const w = rate === 1 ? 17 : 21;
  return {
    id: `overlearn-${kind}-${rate}`,
    name: `OverLearn ${kind}, rate ${rate}`,
    summary: `Each ${kind === 'letters' ? 'character' : 'word'} three times at ${w} wpm.`,
    recipe: { wpm: w, fwpm: w, repeats: 2, wait: 0.5 },
    source: kind === 'letters' ? 'chars' : 'words',
    count: 30,
    how: `Each ${kind === 'letters' ? 'character' : 'word'} plays three times at ${w} wpm. No writing. Name it to yourself by the second play.`,
    aim: 'Known on the first play.',
  };
}

function racer(kind: 'letters' | 'words', rate: 1 | 2): Exercise {
  const base = rate === 1 ? 23 : 27;
  const m = rate === 1 ? [1.348, 1.174, 1] : [1.296, 1.148, 1];
  const speeds = m.map((x) => Math.round(base * x));
  return {
    id: `racer-${kind}-${rate}`,
    name: `Speed Racer ${kind}, rate ${rate}`,
    summary: `Each ${kind === 'letters' ? 'character' : 'word'} at ${speeds.join(', ')} wpm.`,
    recipe: { wpm: base, fwpm: base, racer: { multipliers: m }, wait: 1 },
    source: kind === 'letters' ? 'chars' : 'words',
    count: 25,
    how: `Each one plays at ${speeds.join(', then ')} wpm. Try to catch it at ${speeds[0]}; the slower plays confirm it.`,
    aim: `Named at ${speeds[0]} wpm.`,
  };
}

function sending(w: number): Exercise {
  return {
    id: 'sending',
    name: 'Sending practice',
    summary: 'Copy it, send it back. BeepBeep decodes what you send.',
    recipe: { wpm: w, fwpm: w },
    source: 'chars',
    drill: ['hear-send'],
    how: 'A character or word plays; send it back on your key. BeepBeep decodes your sending and shows what it received.',
    aim: 'What it received matches, with even spacing.',
    mind: 'Send at the speed you copy. Rushed sending is the commonest fault.',
  };
}

function copyRecap(id: string, name: string, cw: number, eff: number, source: Source, perLine = false, spelled = true): Exercise {
  return {
    id,
    name,
    summary: `${cw}/${eff} wpm, read back at the end.`,
    recipe: { wpm: cw, fwpm: eff, wait: 1, voice: (spelled ? spell : word)('end', 0) },
    source,
    perLine,
    count: 15,
    how: 'Copy everything on paper. The voice reads it all back at the end; mark what you missed.',
    aim: 'Nine characters in ten, or better.',
    mind: 'A missed character is gone. Leave a gap and keep up.',
  };
}

function callsigns(w: number): Exercise {
  return {
    id: 'callsigns',
    name: 'Call signs',
    summary: `Call signs at ${w} wpm, spelled 1 s later.`,
    recipe: { wpm: w, fwpm: w, voice: spell('after', 1, 1) },
    source: 'callsigns',
    count: 20,
    how: 'A call sign plays; say it before the voice spells it back.',
    aim: 'Whole calls on the first hearing.',
    mind: 'Calls have a shape: prefix, digit, suffix. Listen for the digit to anchor it.',
  };
}

function speedRacing(kind: 'spell' | 'words', w: number): Exercise {
  const m = [1.5, 1.35, 1.175, 1];
  const speeds = m.map((x) => Math.round(w * x));
  return {
    id: `racing-${kind}`,
    name: `Speed Racing, ${kind === 'spell' ? 'spelled' : 'words'}`,
    summary: `${speeds.join(', ')} wpm, then said, then once more at ${speeds[0]}.`,
    recipe: { wpm: w, fwpm: w, racer: { multipliers: m, say: true, replay: true }, voice: (kind === 'spell' ? spell : word)('after', 0.5, 0.5), wait: 1 },
    source: 'words',
    perLine: kind === 'words',
    count: 20,
    how: `Each word plays at ${speeds.join(', ')} wpm, the voice says it, and it plays once more at ${speeds[0]}.`,
    aim: `Known at ${speeds[0]} before the voice.`,
    mind: 'Listen to the last fast play as one word.',
  };
}

function phrases(id: string, name: string, cw: number, eff: number, voice: boolean, source: Source = 'phrases'): Exercise {
  return {
    id,
    name,
    summary: `Short phrases at ${cw}/${eff}${voice ? ', said 2 s later' : ''}.`,
    recipe: { wpm: cw, fwpm: eff, wait: voice ? 0 : 2, ...(voice ? { voice: word('after', 2) } : {}) },
    source,
    perLine: true,
    count: 15,
    how: voice ? 'A phrase plays; say it back before the voice does.' : 'Phrases with a pause after each. Copy in your head or on paper.',
    aim: 'Each phrase heard as one unit: CQ, TNX FER CALL, 73.',
  };
}

// ---- The classes ----

function bc(n: 1 | 2): ClassInfo {
  const eff = n === 1 ? 8 : 10;
  return {
    id: n === 1 ? 'bc1' : 'bc2',
    name: `BC${n}`,
    band: `12/${eff} wpm`,
    carousel: n === 1 ? 'bc1' : 'bc2',
    routine: [
      'Exercises use the group you are on and every group before it.',
      'Each day: Familiarity on the new group, then Recognition and TTR on everything so far.',
      'Then one copy exercise: VET, VST or groups. Copy by hand, on paper.',
      'Send every day, a few minutes at least.',
      'Fifteen to twenty minutes a day does more than an hour once a week.',
      ...(n === 2 ? ['Numbers and prosigns are characters like any other: say them as you hear them, five, A R.'] : []),
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
    band: `${w}/${w} wpm`,
    routine: [
      'Hear each word as one sound. Familiarity first, then Recognition, then Speed Racing.',
      'Head copy where you can: follow it without writing.',
      'Any exercise can play a text of your own: load it under Your text.',
      'Send every day: the QSO simulator gives you someone to send to.',
    ],
    exercises: [
      familiarity('fam-words', 'Familiarity, words', fam, 'words', { spelled: false, delay: 1, after: 1 }),
      familiarity('fam-spelled', 'Familiarity, spelled', fam, 'words', { delay: 1, after: 1 }),
      familiarity('fam-phrases', 'Familiarity, phrases', fam, 'phrases', { spelled: false, plays: 2, delay: 1, after: 1, perLine: true }),
      familiarity('fam-sentences', 'Familiarity, sentences', fam, 'sentences', { spelled: false, plays: 1, delay: 2, after: 0.5, perLine: true }),
      { ...familiarity('multi', 'Multi words', w, 'multi', { spelled: false, plays: 2, delay: 1, after: 0, perLine: true }), summary: `Two words at a time, said first. ${w} wpm.` },
      recognition('rec-spelled', 'Recognition, spelled', rec, 'words', { delay: n === 1 ? 0.75 : 1, after: 1.5 }),
      recognition('rec-words', 'Recognition, words', rec, 'words', { spelled: false, delay: n === 1 ? 0.75 : 1, after: 1.5 }),
      speedRacing('spell', w),
      speedRacing('words', w),
      callsigns(w),
      ...(n === 1 ? [{ ...copyRecap('binomials', 'Binomials', w, w, 'binomials', true), summary: `Word pairs heard as one, at ${w} wpm.` }] : []),
      ...(n > 1 ? [phrases('phrases', 'Phrases', w - 4, w - 4, true)] : []),
      ...(n > 1 ? [{ ...copyRecap('affixes', 'Affixes', w, w, 'affixes'), summary: `Prefixes and suffixes as single sounds, ${w} wpm.` }] : []),
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
    band: `${w}/${w} wpm`,
    routine: [
      "Follow the meaning; don't spell words out. Write only what you need to keep.",
      'Stories and sentences of your own play under Your text.',
      'Recognition and Speed Racing keep words coming as single sounds at speed.',
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
      { ...copyRecap('affixes', 'Affixes', w, w, 'affixes'), summary: `Prefixes and suffixes, ${w} wpm, 2 word spaces apart.` },
      {
        id: 'stories',
        name: 'Stories',
        summary: `Stories from your own text, a line at a time, each said after it plays. ${w} wpm.`,
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
            summary: 'Commercial-style groups: fast characters, 16 wpm spacing.',
            recipe: { wpm: 18, fwpm: 16, wait: 0.5, voice: spell('end', 0) },
            source: 'groups' as Source,
            min: 5,
            max: 5,
            count: 15,
            speeds: [18, 20, 22, 25, 30],
            keepSpacing: true,
            how: 'Five-character groups with 16 wpm spacing. Copy on paper. Raise the character speed as it gets easy.',
            aim: 'Clean copy at 25 wpm characters.',
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
  routine: ['Pairs, each played three times with 3 s to answer after the voice.', 'Pick a speed where you answer before the voice about half the time.'],
  exercises: [
    {
      id: 'spell',
      name: 'Pairs, spelled',
      summary: 'Two characters, three times, spelled after 0.75 s.',
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
      summary: 'Two words, three times, said after 1.25 s.',
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
    'Material you already know, at 23 to 31 wpm, until it is automatic.',
    'Pick the speed that is just uncomfortable. Move up when it stops being hard.',
    'Stories and sentences of your own play under Your text.',
  ],
  exercises: [
    ol('characters', 'Characters', 'Single characters, one second apart.', { wait: 1 }, 'chars', 'Name each character to yourself as it plays.', { count: 40 }),
    ol('words-2x', 'Words, twice', 'Each word twice.', { repeats: 1, wait: 2 }, 'words', 'Each word plays twice. Know it on the first.'),
    ol('words-3x', 'Words, three times', 'Each word three times.', { repeats: 2, wait: 2 }, 'words', 'Each word plays three times. Know it on the first.'),
    ol('binomials', 'Binomials', 'Word pairs, three times each.', { repeats: 2, wait: 2 }, 'binomials', 'Hear the pair as one phrase.', { perLine: true }),
    ol('suffixes', 'Suffixes', 'Word endings, three times each.', { repeats: 2, wait: 2 }, 'affixes', 'Endings like ING and TION as single sounds.'),
    ol('rhythm', 'Rhythm', 'Once at your speed, then three times half again as fast.', { racer: { multipliers: [1, 1.52, 1.52, 1.52] }, wait: 2 }, 'words', 'The fast plays carry the rhythm of the word. Listen for the shape.'),
    ol('cw-voice-cw', 'CW, voice, CW', 'A phrase, the voice, the phrase again.', { voice: word('after', 1.25), again: true, wait: 1 }, 'phrases', 'Copy the phrase, hear it said, then hear it again knowing what it is.', { perLine: true }),
    ol('sentences-cw', 'Sentences', 'Sentences, two seconds apart.', { wait: 2 }, 'sentences', 'Follow each sentence in your head.', { perLine: true }),
    ol('sentences-cv', 'Sentences, voice after', 'Each sentence, then the voice.', { voice: word('after', 1.25), wait: 2 }, 'sentences', 'Follow the sentence; the voice confirms it.', { perLine: true }),
    ol('sentences-cvc', 'Sentences, CW, voice, CW', 'Each sentence, the voice, the sentence again.', { voice: word('after', 2), again: true, wait: 1 }, 'sentences', 'Follow it, hear it said, then follow it again.', { perLine: true }),
    ol('racing', 'Speed Racing', 'Each word at 31, 27, then 23 wpm.', { racer: { multipliers: [1.348, 1.174, 1] }, wait: 2 }, 'words', 'Catch it at the fastest play.'),
    ol('racing-reversed', 'Speed Racing, reversed', 'Each word at 23, 27, then 31 wpm.', { racer: { multipliers: [1, 1.174, 1.348] }, wait: 2 }, 'words', 'Know it slow, keep it as it speeds up.'),
    ol('voice-after', 'Voice after words', 'Each word three times, then said.', { repeats: 2, voice: { when: 'after', spell: false, delay: 0, after: 0, lastWord: true }, wait: 1 }, 'words', 'Have it before the voice.'),
    ol('send-alphabet', 'Sending: alphabet', 'A to Z, each three times, with room to send it back.', { repeats: 2, wait: 2 }, 'alphabet', 'Listen to the three plays, then send the character back in the gap.'),
    ol('send-numbers', 'Sending: numbers', '1 to 0, each three times, with room to send it back.', { repeats: 2, wait: 2 }, 'numbers', 'Listen, then send the number back in the gap.'),
    ol('send-trigrams', 'Sending: three letters', 'Three-letter groups, said first, 5 s to send each.', { voice: spell('before', 0), wait: 5 }, 'trigrams', 'The voice spells a group; send it in the 5 s that follow, then check it against the CW.'),
    ol('send-words', 'Sending: words', 'Words, said first, 5 s to send each.', { voice: word('before', 0), wait: 5 }, 'words', 'The voice says a word; send it in the 5 s that follow, then check it against the CW.'),
    {
      id: 'stories',
      name: 'Stories',
      summary: 'Stories from your own text, a line at a time, each said after it plays.',
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
      summary: 'Each line, the voice, the line again.',
      recipe: { wpm: 25, fwpm: 25, wait: 1, voice: word('after', 0.5, 0.5), again: true },
      source: 'text',
      perLine: true,
      speeds: [20, 25, 30, 35],
      how: 'Load a story under Your text. Follow each line, hear it said, then follow it again.',
      aim: 'The first hearing copied without needing the second.',
    },
  ],
};

const bc3: ClassInfo = {
  id: 'bc3',
  name: 'BC3',
  band: '12/12 wpm',
  routine: [
    'On-air skills: call signs, contest exchanges and the QSO protocol.',
    'Familiarity on QSO words and phrases first; then call signs and contests.',
    'Put it together in the QSO simulator: LICW protocol, SKCC, SST, POTA.',
  ],
  exercises: [
    familiarity('fam-words', 'Familiarity, QSO words', 14, 'words', { spelled: false, delay: 1, after: 1 }),
    familiarity('fam-spelled', 'Familiarity, spelled', 14, 'words', { delay: 1.5, after: 1 }),
    familiarity('fam-phrases', 'Familiarity, QSO phrases', 14, 'phrases', { spelled: false, plays: 2, delay: 1, after: 1, perLine: true }),
    callsigns(12),
    {
      id: 'contests',
      name: 'Contest exchanges',
      summary: 'Exchanges at 12 wpm, spelled 1 s later.',
      recipe: { wpm: 12, fwpm: 12, voice: spell('after', 1, 1) },
      source: 'contest',
      perLine: true,
      count: 15,
      how: 'A contest exchange plays: call, 5NN, state or serial. Say it before the voice.',
      aim: 'The whole exchange, first time.',
      mind: '5NN is always 5NN: listen past it for the part that changes.',
    },
    sending(12),
    copyRecap('copy', 'Copy, read back', 12, 12, 'phrases', true, false),
    copyRecap('copy-15', 'Copy at 15/12', 15, 12, 'phrases', true, false),
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
