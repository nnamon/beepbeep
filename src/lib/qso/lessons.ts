// Guided QSO lessons: a standard contact taken apart into small steps. Each
// step explains one part, plays what the other station sends or shows what
// you send, and is checked, so you can try it again until it is right. Every
// run meets a new station.

import { makeIdentity, type BotIdentity } from './bot';
import type { FieldKind, Slot } from './check';
import type { Rng } from '../util/random';
import type { Mix } from '../train/world';

/** Your station, as you send it. */
export interface Me {
  call: string;
  name: string;
  qth: string;
  state: string;
}

export interface Field {
  key: string;
  label: string;
  answer: string;
  kind: FieldKind;
}

export type Step =
  /** Read, and listen if there is something to hear. */
  | { kind: 'note'; title: string; explain: string[]; play?: string }
  /** The other station sends; you copy what it sent into the fields. */
  | { kind: 'listen'; title: string; explain: string[]; play: string; fields: Field[] }
  /** You send; checked against the slots. */
  | { kind: 'send'; title: string; explain: string[]; model: string; outline: string; slots: Slot[] };

export interface Lesson {
  id: string;
  name: string;
  summary: string;
  steps: (c: Ctx) => Step[];
}

export interface Ctx {
  me: Me;
  them: BotIdentity;
  /** Show prosigns drawn as dits and dahs. Off in LICW strict mode, which teaches by sound only. */
  glyphs?: boolean;
}

const up = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');
const first = (s: string) => up(s).split(' ')[0];
/** What you send after QTH: the place, and the region only when it adds something (not SINGAPORE SINGAPORE). */
const where = (me: Me) => (me.state.trim() && up(me.state) !== up(me.qth) ? `${up(me.qth)} ${up(me.state)}` : up(me.qth));
/** Your region (state, province or country) for exchanges; your QTH when you left it blank, as in a city-state. */
const region = (me: Me) => up(me.state) || up(me.qth);
/** A prosign drawn as dits and dahs, in brackets, unless the lesson teaches by sound only. */
const drawn = (c: Ctx, glyph: string) => (c.glyphs === false ? '' : ` (${glyph})`);
const BT = '– · · · –';
const SK = '· · · – · –';

// ---- Slots: the parts of an over ----

const theirCall = (c: Ctx, max = 1): Slot => ({ role: 'their call', accept: [c.them.call], max, missing: `Send their call, ${c.them.call}.` });
const de: Slot = { role: 'DE', accept: ['DE'], missing: "Put DE between the calls. It means 'from'." };
/** `afterDe`: the step sends DE before your call, so the note says where it goes. */
const myCall = (c: Ctx, min = 1, max = 2, afterDe = true): Slot => ({
  role: 'your call',
  accept: [up(c.me.call)],
  min,
  max,
  missing: afterDe ? `Send your call, ${up(c.me.call)}, after DE.` : `Send your call, ${up(c.me.call)}.`,
});
/** K, or KN or BK; AR also hands it over (AR K is often sent when answering a call). */
const k: Slot = { role: 'K', accept: ['K', 'KN', 'BK', 'AR'], max: 2, missing: "End with K. It means 'over to you'." };
/** R ('received'), often sent twice. */
const r: Slot = { role: 'R', accept: ['R', 'RR'], max: 2, optional: true, missing: '' };
/** HW? ('how do you copy?'), also sent as HW ? or HW. */
const hw: Slot = { role: 'HW?', accept: ['HW?', 'HW', '?'], max: 2, optional: true, missing: '' };

// ---- What the other station sends ----

const cq = (c: Ctx) => `CQ CQ DE ${c.them.call} ${c.them.call} K`;
const theirOver = (c: Ctx) => {
  const t = c.them;
  return `${up(c.me.call)} DE ${t.call} GM TNX FER CALL <BT> UR RST ${t.rst} ${t.rst} <BT> NAME ${t.name} ${t.name} <BT> QTH ${t.qth} ${t.state} ${t.qth} ${t.state} <BT> HW? ${up(c.me.call)} DE ${t.call} K`;
};
const theirSignoff = (c: Ctx) => `R R TNX ${first(c.me.name)} FER FB QSO <BT> 73 ES GL ${up(c.me.call)} DE ${c.them.call} <SK> EE`;

const overFields = (c: Ctx): Field[] => [
  { key: 'rst', label: 'Report they gave you', answer: c.them.rst, kind: 'rst' },
  { key: 'name', label: 'Their name', answer: c.them.name, kind: 'name' },
  { key: 'qth', label: 'Their QTH (town)', answer: c.them.qth, kind: 'qth' },
];

// ---- Steps used in more than one lesson ----

function hearCq(c: Ctx): Step {
  return {
    kind: 'listen',
    title: 'Hear the CQ',
    explain: [
      'A station sending CQ is asking for a contact with anyone who hears it.',
      'Its callsign comes after DE, usually twice. Copy it.',
    ],
    play: cq(c),
    fields: [{ key: 'call', label: 'Their call', answer: c.them.call, kind: 'call' }],
  };
}

function answerCq(c: Ctx): Step {
  return {
    kind: 'send',
    title: 'Answer it',
    explain: [
      'Send their call once, then DE, then your call twice, then K.',
      "DE means 'from'. K means 'over to you': it tells them it's their turn.",
    ],
    model: `${c.them.call} DE ${up(c.me.call)} ${up(c.me.call)} K`,
    outline: 'their call · DE · your call twice · K',
    slots: [theirCall(c), de, myCall(c, 1, 2), k],
  };
}

function copyOver(c: Ctx): Step {
  return {
    kind: 'listen',
    title: 'Copy their first over',
    explain: [
      "An over is one station's turn to send. In their first over they come back with your call and theirs, a greeting, then three things you will hear in almost every contact: a signal report, their name and where they are.",
      `BT${drawn(c, BT)} separates the parts. Names and places are usually sent twice, so you get a second chance.`,
    ],
    play: theirOver(c),
    fields: overFields(c),
  };
}

const exchangeSlots = (c: Ctx): Slot[] => [
  theirCall(c),
  de,
  myCall(c, 1, 1),
  r,
  { role: 'thanks', accept: ['TNX', 'THANKS', 'TU', 'TKS'], missing: 'Thank them: TNX.' },
  { role: 'their name', accept: [first(c.them.name)], optional: true, missing: '' },
  // The report, your name and your QTH may come in any order.
  { role: 'UR', accept: ['UR'], optional: true, missing: '', part: 'report' },
  { role: 'RST', accept: ['RST'], optional: true, missing: '', part: 'report' },
  { role: 'your report', accept: [], kind: 'rst', min: 1, max: 2, missing: 'Give them a report: three digits, such as 579.', part: 'report' },
  { role: 'NAME', accept: ['NAME', 'OP'], missing: 'Say NAME before your name.', part: 'name' },
  { role: 'your name', accept: [first(c.me.name)], max: 2, missing: `Send your name, ${first(c.me.name)}.`, part: 'name' },
  { role: 'QTH', accept: ['QTH'], missing: 'Say QTH before where you are.', part: 'qth' },
  { role: 'where you are', accept: [first(c.me.qth)], max: 2, missing: `Send where you are, ${up(c.me.qth)}.`, part: 'qth' },
  hw,
  theirCall(c),
  de,
  myCall(c, 1, 1),
  k,
];

function sendWholeOver(c: Ctx): Step {
  const me = c.me;
  return {
    kind: 'send',
    title: 'Send your first over',
    explain: [
      'An over is one turn of sending. Send all of yours in one go: who it is to and from, thanks, a report, your name and where you are, then hand it back.',
      'Send it slowly. A clean over at a slow speed is easier to copy than a fast one with mistakes.',
    ],
    model: `${c.them.call} DE ${up(me.call)} R TNX ${first(c.them.name)} <BT> UR RST 579 579 <BT> NAME ${first(me.name)} ${first(me.name)} <BT> QTH ${where(me)} <BT> HW? ${c.them.call} DE ${up(me.call)} K`,
    outline: 'their call · DE · your call · R TNX and their name · UR RST and a report twice · NAME and yours twice · QTH and where you are · HW? · their call DE your call · K',
    slots: exchangeSlots(c),
  };
}

function hearSignoff(c: Ctx): Step {
  return {
    kind: 'listen',
    title: 'They sign off',
    explain: [
      "R R means they received everything. TNX FER FB QSO means thanks for the fine contact. 73 is 'best regards', and ES GL is 'and good luck'.",
      `SK, sent as one character${drawn(c, SK)}, says the contact is over. The two dits at the very end (EE) are a friendly last goodbye.`,
    ],
    play: theirSignoff(c),
    fields: [{ key: 'name', label: 'The name they used for you', answer: first(c.me.name), kind: 'name' }],
  };
}

function sendSignoff(c: Ctx): Step {
  return {
    kind: 'send',
    title: 'Sign off',
    explain: [
      `Thank them, send 73, both calls with DE between, then SK as one character with no gap inside${drawn(c, SK)}. Add EE if you like.`,
      'No K at the end: SK already says the contact is over.',
    ],
    model: `TNX ${first(c.them.name)} 73 ${c.them.call} DE ${up(c.me.call)} <SK> EE`,
    outline: 'TNX and their name · 73 · their call · DE · your call · SK · EE',
    // Thanks, 73 and the calls with SK may come in any order: 73 is often sent after SK.
    slots: [
      { role: 'thanks', accept: ['TNX', 'THANKS', 'TU', 'TKS'], missing: 'Thank them: TNX.', part: 'thanks' },
      { role: 'their name', accept: [first(c.them.name)], optional: true, missing: '', part: 'thanks' },
      { role: '73', accept: ['73'], missing: "Send 73: 'best regards'.", part: '73' },
      ...[theirCall(c), de, myCall(c, 1, 1)].map((s) => ({ ...s, part: 'calls' })),
      { role: 'SK', accept: ['SK', 'VA'], missing: `End with SK, one character with no gap inside${drawn(c, SK)}.`, part: 'calls' },
      // Two dits, sent as EE or E E, or a few more: it is only a friendly goodbye.
      { role: 'EE', accept: ['EE', 'E', 'EEE', 'EEEE'], max: 2, optional: true, missing: '' },
    ],
  };
}

// ---- The lessons ----

export const LESSONS: Lesson[] = [
  {
    id: 'answer-cq',
    name: 'Answer a CQ',
    summary: 'Hear a station calling CQ, copy its call and answer it.',
    steps: (c) => [
      hearCq(c),
      answerCq(c),
      {
        kind: 'note',
        title: 'You have a contact',
        explain: [`That's ${c.them.call} coming back to you: your call, DE, theirs, then a greeting and thanks for the call. The next lesson, Copy their first over, copies the rest of what they send in this turn.`],
        play: `${up(c.me.call)} DE ${c.them.call} GM TNX FER CALL`,
      },
    ],
  },
  {
    id: 'copy-over',
    name: 'Copy their first over',
    summary: 'A signal report, a name and a town, one part at a time, then their whole turn.',
    steps: (c) => [
      {
        kind: 'listen',
        title: 'The report',
        explain: [
          'UR RST 579 is their report on your signal: readability from 1 to 5, strength from 1 to 9, and tone from 1 to 9.',
          'They send the report twice, so you get a second chance to copy it. 5NN is short for 599, the best report: N stands for 9.',
        ],
        play: `UR RST ${c.them.rst} ${c.them.rst}`,
        fields: [overFields(c)[0]],
      },
      {
        kind: 'listen',
        title: 'The name',
        explain: ['NAME, then the name, twice. Some operators send OP instead of NAME.'],
        play: `NAME ${c.them.name} ${c.them.name}`,
        fields: [overFields(c)[1]],
      },
      {
        kind: 'listen',
        title: 'The QTH',
        explain: ['QTH is where they are: a town, then their region (state, province or country). They send both twice.'],
        play: `QTH ${c.them.qth} ${c.them.state} ${c.them.qth} ${c.them.state}`,
        fields: [overFields(c)[2]],
      },
      copyOver(c),
    ],
  },
  {
    id: 'send-over',
    name: 'Send your first over',
    summary: 'Send your report, name and town a piece at a time, then your whole turn, called an over.',
    steps: (c) => [
      {
        kind: 'send',
        title: 'Who it is to and from',
        explain: ['Start with their call, DE, and your call. They know at once that what follows is for them.'],
        model: `${c.them.call} DE ${up(c.me.call)}`,
        outline: 'their call · DE · your call',
        slots: [theirCall(c), de, myCall(c, 1, 1)],
      },
      {
        kind: 'send',
        title: 'Thanks',
        explain: ["R means 'received': you got what they sent. Then TNX (thanks) and their name."],
        model: `R TNX ${first(c.them.name)}`,
        outline: 'R · TNX · their name',
        slots: [
          r,
          { role: 'thanks', accept: ['TNX', 'THANKS', 'TU', 'TKS'], missing: 'Send TNX for thanks.' },
          { role: 'their name', accept: [first(c.them.name)], missing: `Add their name, ${first(c.them.name)}.` },
        ],
      },
      {
        kind: 'send',
        title: 'Your report on them',
        explain: [
          'UR RST, then your report on them, twice. It has three digits.',
          'The first is readability, from 1 to 5: 5 if you copied them easily, 4 or 3 if some of it was hard to read. The second is strength, from 1 to 9: 9 if they were loud, lower if they were faint. The third is tone, from 1 to 9: 9 for a clean tone, which almost everyone has.',
        ],
        model: 'UR RST 579 579',
        outline: 'UR RST · a report twice',
        slots: [
          { role: 'UR', accept: ['UR'], optional: true, missing: '' },
          { role: 'RST', accept: ['RST'], optional: true, missing: '' },
          { role: 'your report', accept: [], kind: 'rst', min: 2, max: 2, missing: 'Send a report: three digits, such as 579.' },
        ],
      },
      {
        kind: 'send',
        title: 'Your name',
        explain: ['NAME, then your name twice.'],
        model: `NAME ${first(c.me.name)} ${first(c.me.name)}`,
        outline: 'NAME · your name twice',
        slots: [
          { role: 'NAME', accept: ['NAME', 'OP'], missing: 'Start with NAME.' },
          { role: 'your name', accept: [first(c.me.name)], min: 2, max: 2, missing: `Send your name, ${first(c.me.name)}.` },
        ],
      },
      {
        kind: 'send',
        title: 'Where you are',
        explain: ['QTH, then where you are: your town, and your region (state, province or country) if it adds something.'],
        model: `QTH ${where(c.me)}`,
        outline: 'QTH · where you are',
        slots: [
          { role: 'QTH', accept: ['QTH'], missing: 'Start with QTH.' },
          { role: 'where you are', accept: [first(c.me.qth)], max: 2, missing: `Send where you are, ${up(c.me.qth)}.` },
        ],
      },
      {
        kind: 'send',
        title: 'Hand it back',
        explain: ["HW? asks how they copy you. Then their call, DE, your call and K: 'over to you'."],
        model: `HW? ${c.them.call} DE ${up(c.me.call)} K`,
        outline: 'HW? · their call · DE · your call · K',
        slots: [hw, theirCall(c), de, myCall(c, 1, 1), k],
      },
      sendWholeOver(c),
    ],
  },
  {
    id: 'sign-off',
    name: 'Sign off',
    summary: 'Hear them sign off, then end the contact yourself with 73 and SK.',
    steps: (c) => [hearSignoff(c), sendSignoff(c)],
  },
  {
    id: 'call-cq',
    name: 'Call CQ',
    summary: 'Call CQ, copy the station that answers, and welcome them.',
    steps: (c) => [
      {
        kind: 'send',
        title: 'Call CQ',
        explain: [
          "CQ means 'calling any station'. Send CQ two or three times, then DE, your call twice, and K.",
          'Then listen. If nobody answers, call again.',
        ],
        model: `CQ CQ CQ DE ${up(c.me.call)} ${up(c.me.call)} K`,
        outline: 'CQ two or three times · DE · your call twice · K',
        slots: [
          { role: 'CQ', accept: ['CQ'], min: 2, max: 3, missing: 'Start with CQ, sent two or three times.' },
          de,
          myCall(c, 2, 2),
          k,
        ],
      },
      {
        kind: 'listen',
        title: 'Someone answers',
        explain: ['A station answering sends your call, DE, and its own call, usually twice. Copy its call.'],
        play: `${up(c.me.call)} DE ${c.them.call} ${c.them.call} K`,
        fields: [{ key: 'call', label: 'Their call', answer: c.them.call, kind: 'call' }],
      },
      {
        kind: 'send',
        title: 'Welcome them',
        explain: [
          'Their call, DE, your call, then a greeting and thanks for the call. GM is good morning, GA good afternoon and GE good evening.',
          'Your report, name and QTH follow, as in the lesson Send your first over.',
        ],
        model: `${c.them.call} DE ${up(c.me.call)} GM TNX FER CALL`,
        outline: 'their call · DE · your call · GM · TNX FER CALL',
        slots: [
          theirCall(c),
          de,
          myCall(c, 1, 1),
          { role: 'greeting', accept: ['GM', 'GA', 'GE', 'GD'], optional: true, missing: '', part: 'greeting' },
          { role: 'thanks', accept: ['TNX', 'THANKS', 'TU', 'TKS'], missing: 'Thank them for the call: TNX FER CALL.', part: 'thanks' },
        ],
      },
    ],
  },
  {
    id: 'whole',
    name: 'A whole QSO',
    summary: 'Answer a CQ, swap reports, names and towns, and sign off.',
    steps: (c) => [hearCq(c), answerCq(c), copyOver(c), sendWholeOver(c), hearSignoff(c), sendSignoff(c)],
  },
  {
    id: 'pota',
    name: 'Quick exchanges: POTA',
    summary: 'Parks on the Air (POTA): you call a station operating from a park, and you swap a 5NN report and your region.',
    steps: (c) => [
      {
        kind: 'listen',
        title: 'A park activator calls',
        explain: [
          'A station operating from a park is called the activator. Activators make many short contacts, and CQ POTA tells you they are in a park.',
          'Copy their call.',
        ],
        play: `CQ POTA CQ POTA DE ${c.them.call} ${c.them.call} K`,
        fields: [{ key: 'call', label: 'Their call', answer: c.them.call, kind: 'call' }],
      },
      {
        kind: 'send',
        title: 'Send your call',
        explain: [
          'The stations calling a park are called hunters, and you are one. Send only your call, once. The activator is answering many stations, so they need nothing else yet.',
        ],
        model: up(c.me.call),
        outline: 'your call',
        slots: [myCall(c, 1, 2, false)],
      },
      {
        kind: 'listen',
        title: 'Their report and region',
        explain: ['They send your call, 5NN (short for 599, the best report) and their region, then BK to hand it back. Their region is their state, province or country.'],
        play: `${up(c.me.call)} 5NN ${c.them.state} ${c.them.state} BK`,
        fields: [{ key: 'state', label: 'Their region', answer: c.them.state, kind: 'text' }],
      },
      {
        kind: 'send',
        title: 'Your report and region',
        explain: [
          'You may start with BK. Then send TU (thank you), 5NN and your region twice, and end with BK to hand it back.',
          'Your region is your state, province or country. In a city-state such as Singapore, send the country.',
        ],
        model: `BK TU 5NN ${region(c.me)} ${region(c.me)} BK`,
        outline: 'BK if you like · TU · 5NN · your region twice · BK',
        slots: [
          { role: 'BK', accept: ['BK'], optional: true, missing: '' },
          r,
          { role: 'TU', accept: ['TU', 'TNX'], optional: true, missing: '' },
          { role: 'report', accept: [], kind: 'rst', missing: 'Send a report: 5NN.' },
          { role: 'your region', accept: [first(region(c.me))], max: 2, missing: `Send your region, ${region(c.me)}.` },
          { role: 'BK', accept: ['BK', 'K', 'KN', 'AR'], missing: 'End with BK. It hands the contact back to them.' },
        ],
      },
      {
        kind: 'note',
        title: 'Done',
        explain: ['They finish with TU 73 and go on to the next hunter. A whole POTA contact takes about 20 seconds.'],
        play: 'TU 73 EE',
      },
    ],
  },
];

/** A new station for each run. */
export function newStation(rng: Rng, mix: Mix): BotIdentity {
  return makeIdentity(rng, 0, mix);
}
