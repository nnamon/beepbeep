// Today's session: an ordered checklist for your course and lesson, worked
// from the top. A step ticks itself when a session of its kind is recorded
// today.

import type { ClassId } from './classes';

export interface Step {
  id: string;
  title: string;
  /** Why it is in the session, in a sentence. */
  why: string;
  minutes: number;
  /** Route to open. */
  to: string[];
  /** Session modes that tick it ('qso' for a logged QSO). */
  modes: string[];
  /** Only if there is time left. */
  optional?: boolean;
}

export interface TodayInput {
  track: 'koch' | 'licw';
  /** LICW stage (bc1 … overlearn); ignored on Koch. */
  stage: ClassId;
  /** New characters of the lesson you haven't learned yet, and weak ones. */
  fresh: string[];
  weak: string[];
  /** Characters just added by the lesson (shown in titles). */
  added: string[];
  sessionMinutes: number;
  /** Days since 1 Jan 1970, local: picks the day's copy exercise. */
  day: number;
}

const ex = (stage: string, id: string) => ['practice', 'class', stage, id];
const mode = (stage: string, id: string) => `class:${stage}/${id}`;

function scale(steps: Step[], minutes: number): Step[] {
  const base = steps.filter((s) => !s.optional).reduce((a, s) => a + s.minutes, 0);
  const k = base ? minutes / base : 1;
  return steps.map((s) => ({ ...s, minutes: Math.max(1, Math.round(s.minutes * k)) }));
}

function bc(stage: 'bc1' | 'bc2', i: TodayInput): Step[] {
  const group = i.added.join(' ');
  const copy = [
    ['vet', 'VET (gaps shrink)'],
    ['vst', 'VST (characters slow down)'],
    ['groups-5', 'Groups of 5'],
    [stage === 'bc1' ? 'groups-1-3' : 'groups-1-4', stage === 'bc1' ? 'Random groups 1 to 3' : 'Random groups 1 to 4'],
    ['vet-reverse', 'Reverse VET (gaps grow)'],
    ['vst-reverse', 'Reverse VST (characters speed up)'],
  ][i.day % 6];
  return [
    { id: 'familiarity', title: `Familiarity on ${group}`, why: 'Hear the name of each new character, then its sound.', minutes: 2, to: ex(stage, 'familiarity'), modes: [mode(stage, 'familiarity')] },
    ...(i.fresh.length
      ? [{ id: 'spot', title: 'Spot the new character', why: 'Tap when you hear a new character among the ones you know.', minutes: 2, to: ['practice', 'familiarity'], modes: ['familiarity'] }]
      : []),
    { id: 'recognition', title: 'Recognition', why: 'Say each character out loud before the voice names it. It uses every character you know.', minutes: 3, to: ex(stage, 'recognition'), modes: [mode(stage, 'recognition')] },
    { id: 'ttr', title: 'TTR (time to recognise)', why: 'Like Recognition, with less time before the voice names it.', minutes: 2, to: ex(stage, 'ttr'), modes: [mode(stage, 'ttr')] },
    { id: 'copy', title: copy[1], why: 'Copy on paper. A different copy exercise comes up each day.', minutes: 3, to: ex(stage, copy[0]), modes: [mode(stage, copy[0])] },
    { id: 'send', title: 'Hear it, send it', why: 'Copy a character or word, then send it on your key.', minutes: 4, to: ['practice', 'hear-send'], modes: ['hear-send', 'send', 'live'] },
    { id: 'check', title: 'Copy drill', why: 'Type what you hear and get a score. At 80% or more, move on to the next lesson.', minutes: 3, to: ['practice', 'copy', 'groups'], modes: ['copy'] },
  ];
}

function later(stage: ClassId, i: TodayInput): Step[] {
  const send = { id: 'send', title: 'A QSO', why: 'Make a contact with the simulated station. It answers what it copies from your sending.', minutes: 5, to: ['qso'], modes: ['qso', 'hear-send', 'send'] };
  switch (stage) {
    case 'bc3':
      return [
        { id: 'fam', title: 'Familiarity, QSO words', why: 'Hear common QSO words said, then sent, until each sounds like one word.', minutes: 3, to: ex(stage, 'fam-words'), modes: [mode(stage, 'fam-words')] },
        { id: 'calls', title: 'Callsigns', why: 'Say each callsign before the voice spells it.', minutes: 3, to: ex(stage, 'callsigns'), modes: [mode(stage, 'callsigns')] },
        { id: 'contests', title: 'Contest exchanges', why: 'Say each contest exchange before the voice spells it.', minutes: 3, to: ex(stage, 'contests'), modes: [mode(stage, 'contests')] },
        { id: 'send', title: 'A whole QSO, guided', why: 'Make a whole contact in Learn QSOs, checked one step at a time.', minutes: 5, to: ['qso', 'learn', 'whole'], modes: ['qso-learn:whole', 'qso'] },
        { id: 'copy', title: 'Copy, read back', why: 'Copy phrases on paper. The voice reads them back at the end so you can check.', minutes: 3, to: ex(stage, 'copy'), modes: [mode(stage, 'copy')], optional: true },
      ];
    case 'ttrplus':
      return [
        { id: 'spell', title: 'Pairs, spelled', why: 'A pair of characters plays three times. Say it before the voice spells it.', minutes: 5, to: ex(stage, 'spell'), modes: [mode(stage, 'spell')] },
        { id: 'words', title: 'Word pairs', why: 'Two words play three times. Say them before the voice does.', minutes: 5, to: ex(stage, 'words'), modes: [mode(stage, 'words')] },
        send,
      ];
    case 'overlearn': {
      const pick = [
        ['words-3x', 'Words, three times'],
        ['racing', 'Speed Racing'],
        ['sentences-cv', 'Sentences, voice after'],
        ['binomials', 'Binomials'],
        ['rhythm', 'Rhythm'],
        ['cw-voice-cw', 'CW, voice, CW'],
      ];
      const a = pick[i.day % pick.length];
      const b = pick[(i.day + 3) % pick.length];
      return [
        { id: 'chars', title: 'Characters', why: 'Warm up on single characters at speed.', minutes: 2, to: ex(stage, 'characters'), modes: [mode(stage, 'characters')] },
        { id: 'a', title: a[1], why: 'This is one of the two OverLearn exercises for today. They change each day.', minutes: 5, to: ex(stage, a[0]), modes: [mode(stage, a[0])] },
        { id: 'b', title: b[1], why: 'This is the other OverLearn exercise for today.', minutes: 5, to: ex(stage, b[0]), modes: [mode(stage, b[0])] },
        send,
      ];
    }
    default: {
      // INT and ADV.
      const extra: [string, string][] = stage.startsWith('int')
        ? [['callsigns', 'Callsigns'], ['multi', 'Multi words'], stage === 'int1' ? ['binomials', 'Binomials'] : ['affixes', 'Affixes'], stage === 'int1' ? ['callsigns', 'Callsigns'] : ['phrases', 'Phrases']]
        : [['callsigns', 'Callsigns'], ['fam-sentences', 'Familiarity, sentences'], ['affixes', 'Affixes'], ['fam-phrases', 'Familiarity, phrases']];
      const x = extra[i.day % extra.length];
      return [
        { id: 'fam', title: 'Familiarity, words', why: 'Hear each word said, then sent.', minutes: 3, to: ex(stage, 'fam-words'), modes: [mode(stage, 'fam-words')] },
        { id: 'rec', title: 'Recognition, words', why: 'Say each word before the voice.', minutes: 3, to: ex(stage, 'rec-words'), modes: [mode(stage, 'rec-words')] },
        { id: 'racing', title: 'Speed Racing, words', why: 'Catch words at a speed above your own.', minutes: 3, to: ex(stage, 'racing-words'), modes: [mode(stage, 'racing-words')] },
        { id: 'extra', title: x[1], why: 'This exercise changes each day.', minutes: 3, to: ex(stage, x[0]), modes: [mode(stage, x[0])] },
        send,
      ];
    }
  }
}

function koch(i: TodayInput): Step[] {
  return [
    ...(i.fresh.length
      ? [{ id: 'spot', title: `Spot the new character: ${i.fresh.join(' ')}`, why: 'Tap when you hear the new character among the ones you know.', minutes: 2, to: ['practice', 'familiarity'], modes: ['familiarity'] }]
      : []),
    { id: 'copy', title: 'Copy drill', why: 'Type what you hear and get a score. At 90% or more, move on to the next lesson.', minutes: 5, to: ['practice', 'copy', 'groups'], modes: ['copy'] },
    { id: 'ttr', title: 'Time to recognise (TTR)', why: 'Type each character before the voice names it.', minutes: 3, to: ['practice', 'ttr'], modes: ['ttr'] },
    { id: 'send', title: 'Hear it, send it', why: 'Copy a character or word, then send it on your key.', minutes: 4, to: ['practice', 'hear-send'], modes: ['hear-send', 'send', 'live'] },
    ...(i.weak.length
      ? [{ id: 'weak', title: `Pocket round for ${i.weak.join(' ')}`, why: 'In this quiz round, your weakest characters this month come up more often.', minutes: 2, to: ['pocket', 'round', 'characters'], modes: ['pocket-characters'], optional: true }]
      : []),
    { id: 'more', title: 'Sound surfing', why: 'Copy a continuous stream. Keep going when you miss one.', minutes: 3, to: ['practice', 'ifr'], modes: ['ifr'], optional: true },
  ];
}

/** Today's steps, with minutes scaled to your session length. */
export function todaySteps(i: TodayInput): Step[] {
  const steps = i.track === 'koch' ? koch(i) : i.stage === 'bc1' || i.stage === 'bc2' ? bc(i.stage, i) : later(i.stage, i);
  return scale(steps, i.sessionMinutes);
}

/** Days since 1 Jan 1970 in local time. */
export function localDay(t = Date.now()): number {
  return Math.floor((t - new Date(t).getTimezoneOffset() * 60_000) / 864e5);
}
