// Guided QSO lessons: a standard contact taken apart into small steps. Each
// step explains one part, plays what the other station sends or shows what
// you send, and is checked, so you can get it wrong and try again. Every run
// meets a new station.

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
}

const up = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');
const first = (s: string) => up(s).split(' ')[0];

// ---- Slots: the parts of an over ----

const theirCall = (c: Ctx, max = 1): Slot => ({ role: 'their call', accept: [c.them.call], max, missing: `Send their call, ${c.them.call}.` });
const de: Slot = { role: 'DE', accept: ['DE'], missing: "Put DE between the calls. It means 'from'." };
const myCall = (c: Ctx, min = 1, max = 2): Slot => ({
  role: 'your call',
  accept: [up(c.me.call)],
  min,
  max,
  missing: `Send your call, ${up(c.me.call)}, after DE.`,
});
const k: Slot = { role: 'K', accept: ['K', 'KN', 'BK'], missing: "End with K. It means 'over to you'." };

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
      'Its call sign comes after DE, usually twice. Copy it.',
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
      'They come back with your call and theirs, a greeting, then three things you will hear in almost every contact: a signal report, their name and where they are.',
      'BT (– · · · –) separates the parts. Names and places are usually sent twice, so you get a second chance.',
    ],
    play: theirOver(c),
    fields: overFields(c),
  };
}

const exchangeSlots = (c: Ctx): Slot[] => [
  theirCall(c),
  de,
  myCall(c, 1, 1),
  { role: 'R', accept: ['R', 'RR'], optional: true, missing: '' },
  { role: 'thanks', accept: ['TNX', 'THANKS', 'TU', 'TKS'], missing: 'Thank them: TNX.' },
  { role: 'their name', accept: [first(c.them.name)], optional: true, missing: '' },
  { role: 'UR', accept: ['UR'], optional: true, missing: '' },
  { role: 'RST', accept: ['RST'], optional: true, missing: '' },
  { role: 'your report', accept: [], kind: 'rst', min: 1, max: 2, missing: 'Give them a report: three digits, such as 579.' },
  { role: 'NAME', accept: ['NAME', 'OP'], missing: 'Say NAME before your name.' },
  { role: 'your name', accept: [first(c.me.name)], max: 2, missing: `Send your name, ${first(c.me.name)}.` },
  { role: 'QTH', accept: ['QTH'], missing: 'Say QTH before where you are.' },
  { role: 'your town', accept: [first(c.me.qth)], max: 2, missing: `Send your town, ${up(c.me.qth)}.` },
  { role: 'HW?', accept: ['HW?', 'HW'], optional: true, missing: '' },
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
      'All of it in one go: who it is to and from, thanks, a report, your name and your town, then hand it back.',
      'Take it slowly. A clean over at a slow speed is better than a fast one with mistakes.',
    ],
    model: `${c.them.call} DE ${up(me.call)} R TNX ${first(c.them.name)} <BT> UR RST 579 579 <BT> NAME ${first(me.name)} ${first(me.name)} <BT> QTH ${up(me.qth)} ${up(me.state)} <BT> HW? ${c.them.call} DE ${up(me.call)} K`,
    outline: 'their call · DE · your call · R TNX and their name · UR RST and a report twice · NAME and yours twice · QTH and your town · HW? · their call DE your call · K',
    slots: exchangeSlots(c),
  };
}

function hearSignoff(c: Ctx): Step {
  return {
    kind: 'listen',
    title: 'They sign off',
    explain: [
      "R R means they received everything. TNX FER FB QSO: thanks for the fine contact. 73 is 'best regards'. ES GL: and good luck.",
      'SK, sent as one character (· · · – · –), says the contact is over. The two dits at the very end (EE) are a friendly last goodbye.',
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
      'Thank them, send 73, both calls with DE between, then SK as one character with no gap inside (· · · – · –). Add EE if you like.',
      'No K at the end: SK already says the contact is over.',
    ],
    model: `TNX ${first(c.them.name)} 73 ${c.them.call} DE ${up(c.me.call)} <SK> EE`,
    outline: 'TNX and their name · 73 · their call · DE · your call · SK · EE',
    slots: [
      { role: 'thanks', accept: ['TNX', 'THANKS', 'TU', 'TKS'], missing: 'Thank them: TNX.' },
      { role: 'their name', accept: [first(c.them.name)], optional: true, missing: '' },
      { role: '73', accept: ['73'], missing: "Send 73: 'best regards'." },
      theirCall(c),
      de,
      myCall(c, 1, 1),
      { role: 'SK', accept: ['SK'], missing: 'End with SK, one character with no gap inside (· · · – · –).' },
      { role: 'EE', accept: ['EE'], optional: true, missing: '' },
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
        explain: [`That's ${c.them.call} coming back to you: your call, DE, theirs, then a greeting and thanks for the call. The next lesson copies the rest of their over.`],
        play: `${up(c.me.call)} DE ${c.them.call} GM TNX FER CALL`,
      },
    ],
  },
  {
    id: 'copy-over',
    name: 'Copy their first over',
    summary: 'A signal report, a name and a town, one part at a time, then the whole over.',
    steps: (c) => [
      {
        kind: 'listen',
        title: 'The report',
        explain: [
          'UR RST 579 is their report on your signal: readability from 1 to 5, strength from 1 to 9, and tone from 1 to 9.',
          '5NN is short for 599, the best report. It is sent twice.',
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
        explain: ['QTH is where they are: a town, then the state, province or country, sent twice.'],
        play: `QTH ${c.them.qth} ${c.them.state} ${c.them.qth} ${c.them.state}`,
        fields: [overFields(c)[2]],
      },
      copyOver(c),
    ],
  },
  {
    id: 'send-over',
    name: 'Send your first over',
    summary: 'Your report, name and town, a piece at a time, then the whole over.',
    steps: (c) => [
      {
        kind: 'send',
        title: 'Who it is to and from',
        explain: ['Start with their call, DE, and your call. They know at once the over is for them.'],
        model: `${c.them.call} DE ${up(c.me.call)}`,
        outline: 'their call · DE · your call',
        slots: [theirCall(c), de, myCall(c, 1, 1)],
      },
      {
        kind: 'send',
        title: 'Thanks',
        explain: ["R means 'received': you got their over. Then TNX (thanks) and their name."],
        model: `R TNX ${first(c.them.name)}`,
        outline: 'R · TNX · their name',
        slots: [
          { role: 'R', accept: ['R', 'RR'], optional: true, missing: '' },
          { role: 'thanks', accept: ['TNX', 'THANKS', 'TU', 'TKS'], missing: 'Send TNX for thanks.' },
          { role: 'their name', accept: [first(c.them.name)], missing: `Add their name, ${first(c.them.name)}.` },
        ],
      },
      {
        kind: 'send',
        title: 'Your report on them',
        explain: [
          'UR RST, then your report twice. Readability 1 to 5, strength 1 to 9, tone 1 to 9.',
          'If you copied them well and they were loud, 599. If you missed a little, 579 or 559.',
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
        explain: ['QTH, then your town and your state, province or country.'],
        model: `QTH ${up(c.me.qth)} ${up(c.me.state)}`,
        outline: 'QTH · your town · your region',
        slots: [
          { role: 'QTH', accept: ['QTH'], missing: 'Start with QTH.' },
          { role: 'your town', accept: [first(c.me.qth)], max: 2, missing: `Send your town, ${up(c.me.qth)}.` },
        ],
      },
      {
        kind: 'send',
        title: 'Hand it back',
        explain: ["HW? asks how they copy you. Then their call, DE, your call and K: 'over to you'."],
        model: `HW? ${c.them.call} DE ${up(c.me.call)} K`,
        outline: 'HW? · their call · DE · your call · K',
        slots: [{ role: 'HW?', accept: ['HW?', 'HW'], optional: true, missing: '' }, theirCall(c), de, myCall(c, 1, 1), k],
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
          'Their call, DE, your call, then a greeting and thanks for the call. GM is good morning; GA good afternoon; GE good evening.',
          'Your report, name and QTH follow, as in Send your first over.',
        ],
        model: `${c.them.call} DE ${up(c.me.call)} GM TNX FER CALL`,
        outline: 'their call · DE · your call · GM · TNX FER CALL',
        slots: [
          theirCall(c),
          de,
          myCall(c, 1, 1),
          { role: 'greeting', accept: ['GM', 'GA', 'GE', 'GD'], optional: true, missing: '' },
          { role: 'thanks', accept: ['TNX', 'THANKS', 'TU', 'TKS'], missing: 'Thank them for the call: TNX FER CALL.' },
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
    summary: 'Parks on the Air: your call, a 5NN report and your state, and done.',
    steps: (c) => [
      {
        kind: 'listen',
        title: 'A park activator calls',
        explain: [
          'Activators operate from parks and make many short contacts. CQ POTA means they are in a park.',
          'Copy their call.',
        ],
        play: `CQ POTA CQ POTA DE ${c.them.call} ${c.them.call} K`,
        fields: [{ key: 'call', label: 'Their call', answer: c.them.call, kind: 'call' }],
      },
      {
        kind: 'send',
        title: 'Send your call',
        explain: ['As a hunter you send only your call, once. Nothing else: they are busy.'],
        model: up(c.me.call),
        outline: 'your call',
        slots: [myCall(c, 1, 2)],
      },
      {
        kind: 'listen',
        title: 'Their report and state',
        explain: ['They send your call, 5NN (599) and their state, then BK to hand it back.'],
        play: `${up(c.me.call)} 5NN ${c.them.state} ${c.them.state} BK`,
        fields: [{ key: 'state', label: 'Their state or region', answer: c.them.state, kind: 'text' }],
      },
      {
        kind: 'send',
        title: 'Your report and state',
        explain: ['BK, then TU (thank you), 5NN and your state twice, then BK.'],
        model: `BK TU 5NN ${up(c.me.state)} ${up(c.me.state)} BK`,
        outline: 'BK · TU · 5NN · your state twice · BK',
        slots: [
          { role: 'BK', accept: ['BK'], optional: true, missing: '' },
          { role: 'TU', accept: ['TU', 'TNX'], optional: true, missing: '' },
          { role: 'report', accept: [], kind: 'rst', missing: 'Send a report: 5NN.' },
          { role: 'your state', accept: [up(c.me.state)], max: 2, missing: `Send your state, ${up(c.me.state)}.` },
        ],
      },
      { kind: 'note', title: 'Done', explain: ['They finish with TU 73 and go on to the next hunter. A whole POTA contact takes about twenty seconds.'], play: 'TU 73 EE' },
    ],
  },
];

/** A new station for each run. */
export function newStation(rng: Rng, mix: Mix): BotIdentity {
  return makeIdentity(rng, 0, mix);
}
