// Today's session: an ordered checklist for your course and lesson. New
// sounds first, then naming them fast, then copying under pressure, then
// sending. A step ticks itself when a session of its kind is recorded today.

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
    ['vet', 'VET'],
    ['vst', 'VST'],
    ['groups-5', 'Groups of 5'],
    [stage === 'bc1' ? 'groups-1-3' : 'groups-1-4', stage === 'bc1' ? 'Random groups 1 to 3' : 'Random groups 1 to 4'],
    ['vet-reverse', 'Reverse VET'],
    ['vst-reverse', 'Reverse VST'],
  ][i.day % 6];
  return [
    { id: 'familiarity', title: `Familiarity on ${group}`, why: 'Hear the new sounds with their names before anything else.', minutes: 2, to: ex(stage, 'familiarity'), modes: [mode(stage, 'familiarity')] },
    ...(i.fresh.length
      ? [{ id: 'spot', title: 'Spot the new character', why: 'Pick each new sound out from the others before you hear its name.', minutes: 2, to: ['practice', 'familiarity'], modes: ['familiarity'] }]
      : []),
    { id: 'recognition', title: 'Recognition', why: 'Say each character before the voice, across everything you know.', minutes: 3, to: ex(stage, 'recognition'), modes: [mode(stage, 'recognition')] },
    { id: 'ttr', title: 'TTR', why: 'The same with less time, so recognition gets instant.', minutes: 2, to: ex(stage, 'ttr'), modes: [mode(stage, 'ttr')] },
    { id: 'copy', title: copy[1], why: "Today's copy exercise, on paper. It changes each day.", minutes: 3, to: ex(stage, copy[0]), modes: [mode(stage, copy[0])] },
    { id: 'send', title: 'Sending practice', why: 'A quarter of your time should be sending.', minutes: 4, to: ['practice', 'hear-send'], modes: ['hear-send', 'send', 'live'] },
    { id: 'check', title: 'Copy drill', why: 'Scores your copy. 80% opens the next group.', minutes: 3, to: ['practice', 'copy', 'groups'], modes: ['copy'] },
  ];
}

function later(stage: ClassId, i: TodayInput): Step[] {
  const send = { id: 'send', title: 'A QSO', why: 'Send to the simulated station; it answers what it copies.', minutes: 5, to: ['qso'], modes: ['qso', 'hear-send', 'send'] };
  switch (stage) {
    case 'bc3':
      return [
        { id: 'fam', title: 'Familiarity, QSO words', why: 'The words of a QSO as single sounds.', minutes: 3, to: ex(stage, 'fam-words'), modes: [mode(stage, 'fam-words')] },
        { id: 'calls', title: 'Call signs', why: 'Every QSO starts with copying a call.', minutes: 3, to: ex(stage, 'callsigns'), modes: [mode(stage, 'callsigns')] },
        { id: 'contests', title: 'Contest exchanges', why: 'Short, fast, and the same shape every time.', minutes: 3, to: ex(stage, 'contests'), modes: [mode(stage, 'contests')] },
        { ...send, why: 'Put it together: an LICW protocol, SKCC or POTA contact.' },
        { id: 'copy', title: 'Copy, read back', why: 'Phrases on paper, checked at the end.', minutes: 3, to: ex(stage, 'copy'), modes: [mode(stage, 'copy')], optional: true },
      ];
    case 'ttrplus':
      return [
        { id: 'spell', title: 'Pairs, spelled', why: 'Two characters with 3 s to answer after the voice.', minutes: 5, to: ex(stage, 'spell'), modes: [mode(stage, 'spell')] },
        { id: 'words', title: 'Word pairs', why: 'The same with words.', minutes: 5, to: ex(stage, 'words'), modes: [mode(stage, 'words')] },
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
        { id: 'chars', title: 'Characters', why: 'A fast warm-up on single characters.', minutes: 2, to: ex(stage, 'characters'), modes: [mode(stage, 'characters')] },
        { id: 'a', title: a[1], why: "Today's first OverLearn exercise.", minutes: 5, to: ex(stage, a[0]), modes: [mode(stage, a[0])] },
        { id: 'b', title: b[1], why: "Today's second. They change each day.", minutes: 5, to: ex(stage, b[0]), modes: [mode(stage, b[0])] },
        send,
      ];
    }
    default: {
      // INT and ADV.
      const extra: [string, string][] = stage.startsWith('int')
        ? [['callsigns', 'Call signs'], ['multi', 'Multi words'], stage === 'int1' ? ['binomials', 'Binomials'] : ['affixes', 'Affixes'], stage === 'int1' ? ['callsigns', 'Call signs'] : ['phrases', 'Phrases']]
        : [['callsigns', 'Call signs'], ['fam-sentences', 'Familiarity, sentences'], ['affixes', 'Affixes'], ['fam-phrases', 'Familiarity, phrases']];
      const x = extra[i.day % extra.length];
      return [
        { id: 'fam', title: 'Familiarity, words', why: 'Words heard as single sounds, with their names first.', minutes: 3, to: ex(stage, 'fam-words'), modes: [mode(stage, 'fam-words')] },
        { id: 'rec', title: 'Recognition, words', why: 'Say each word before the voice.', minutes: 3, to: ex(stage, 'rec-words'), modes: [mode(stage, 'rec-words')] },
        { id: 'racing', title: 'Speed Racing, words', why: 'Catch words at a speed above your own.', minutes: 3, to: ex(stage, 'racing-words'), modes: [mode(stage, 'racing-words')] },
        { id: 'extra', title: x[1], why: 'Changes each day.', minutes: 3, to: ex(stage, x[0]), modes: [mode(stage, x[0])] },
        send,
      ];
    }
  }
}

function koch(i: TodayInput): Step[] {
  return [
    ...(i.fresh.length
      ? [{ id: 'spot', title: `Spot the new character: ${i.fresh.join(' ')}`, why: 'Pick the new sound out from the others before you hear its name.', minutes: 2, to: ['practice', 'familiarity'], modes: ['familiarity'] }]
      : []),
    { id: 'copy', title: 'Copy drill', why: 'Your main receive practice. 90% opens the next lesson.', minutes: 5, to: ['practice', 'copy', 'groups'], modes: ['copy'] },
    { id: 'ttr', title: 'TTR drill', why: 'Type each character before the voice, so recognition gets instant.', minutes: 3, to: ['practice', 'ttr'], modes: ['ttr'] },
    { id: 'send', title: 'Hear it, send it', why: 'A quarter of your time should be sending.', minutes: 4, to: ['practice', 'hear-send'], modes: ['hear-send', 'send', 'live'] },
    ...(i.weak.length
      ? [{ id: 'weak', title: `Pocket round for ${i.weak.join(' ')}`, why: 'Your weakest characters this month get more turns in a round.', minutes: 2, to: ['pocket', 'round', 'characters'], modes: ['pocket-characters'], optional: true }]
      : []),
    { id: 'more', title: 'Sound surfing (IFR)', why: 'A continuous stream: keep going through misses.', minutes: 3, to: ['practice', 'ifr'], modes: ['ifr'], optional: true },
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
