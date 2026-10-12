// The Learn QSOs checker on natural beginner input: one slip gives one note,
// spacing slips are named as spacing, and optional parts stay optional.
import { describe, expect, it } from 'vitest';
import { LESSONS, newStation, type Me, type Step } from './lessons';
import { checkSend } from './check';
import type { BotIdentity } from './bot';
import { mulberry32 } from '../util/random';

const SG: Me = { call: '9V1NE', name: 'AMON', qth: 'SINGAPORE', state: '' };
const SD: Me = { call: 'K6ABC', name: 'JOHN', qth: 'SAN DIEGO', state: 'CA' };

function ident(call: string, name: string, qth: string, state: string): BotIdentity {
  return { call, name, qth, state, skcc: '1234', rig: 'IC7300', ant: 'DIPOLE', pwr: '100', wx: 'SUNNY', age: '50', job: 'ENGINEER', rst: '579', serial: 42, pitchOffset: 0, verbosity: 0.5, repeats: 2, pace: 0, abbrev: 1 };
}
const W1AW = ident('W1AW', 'BOB', 'NEWINGTON', 'CT');

type Send = Step & { kind: 'send' };
const sendSteps = (lesson: string, me: Me, them: BotIdentity): Send[] =>
  LESSONS.find((l) => l.id === lesson)!.steps({ me, them }).filter((s): s is Send => s.kind === 'send');
const step = (lesson: string, i: number, me: Me = SG, them: BotIdentity = W1AW) => sendSteps(lesson, me, them)[i];

describe('spacing slips are spacing, not missing parts', () => {
  it('two words run together', () => {
    const cq = checkSend('CQCQ CQ DE 9V1NE 9V1NE K', step('call-cq', 0).slots);
    expect(cq.result).toBe('almost');
    expect(cq.notes).toEqual(['CQ and CQ ran together: leave a word space between them.']);
    const k = checkSend('W1AW DE 9V1NE 9V1NEK', step('answer-cq', 0).slots);
    expect(k.result).toBe('almost');
    expect(k.notes).toEqual(['9V1NE and K ran together: leave a word space between them.']);
    const de = checkSend('W1AWDE 9V1NE 9V1NE K', step('answer-cq', 0).slots);
    expect(de.notes).toEqual(['W1AW and DE ran together: leave a word space between them.']);
  });

  it('one word split in two', () => {
    const call = checkSend('W1AW DE 9V1 NE 9V1 NE K', step('answer-cq', 0).slots);
    expect(call.result).toBe('almost');
    expect(call.notes).toEqual(['9V1NE came out as 9V1 NE: a gap inside it was as long as a word space, so keep its characters closer together.']);
    const report = checkSend('UR RST 5 79 5 79', step('send-over', 2).slots);
    expect(report.result).toBe('almost');
    expect(report.notes).toEqual(['579 came out as 5 79: a gap inside it was as long as a word space, so keep its characters closer together.']);
    const sk = checkSend('TNX BOB 73 W1AW DE 9V1NE S K', step('sign-off', 0).slots);
    expect(sk.result).toBe('almost');
    expect(sk.notes).toEqual(['SK came out as S K: send it as one character, with no gap inside.']);
  });
});

describe('natural input gives no false notes', () => {
  const whole = () => step('whole', 1);
  it('the report, name and QTH parts may come in any order', () => {
    for (const middle of ['UR RST 579 579 = QTH SINGAPORE = NAME AMON AMON', 'NAME AMON AMON = QTH SINGAPORE = UR RST 579 579', 'QTH SINGAPORE = UR 579 579 = NAME AMON'])
      expect(checkSend(`W1AW DE 9V1NE R TNX BOB = ${middle} = HW? W1AW DE 9V1NE K`, whole().slots), middle).toMatchObject({ result: 'pass', notes: [] });
    // A part left out is still named, once.
    const noQth = checkSend('W1AW DE 9V1NE R TNX BOB = NAME AMON AMON = UR RST 579 579 = HW? W1AW DE 9V1NE K', whole().slots);
    expect(noQth.result).toBe('try');
    expect(noQth.notes).toEqual(['Say QTH before where you are.', 'Send where you are, SINGAPORE.']);
  });
  it('your call twice with no gap, in a step that takes it once, is a spacing slip', () => {
    for (const [s, text] of [[step('send-over', 0), 'W1AW DE 9V1NE9V1NE'], [step('send-over', 5), 'HW? W1AW DE 9V1NE9V1NE K']] as const) {
      const v = checkSend(text, s.slots);
      expect(v, text).toMatchObject({ result: 'almost', notes: ['9V1NE and 9V1NE ran together: leave a word space between them.'] });
    }
  });
  it('73 after SK is still 73', () => {
    expect(checkSend('TNX BOB W1AW DE 9V1NE SK 73', step('sign-off', 0).slots)).toMatchObject({ result: 'pass', notes: [] });
    expect(checkSend('TNX BOB W1AW DE 9V1NE <SK> 73 EE', step('sign-off', 0).slots)).toMatchObject({ result: 'pass', notes: [] });
    // With no 73 at all, it is asked for.
    expect(checkSend('TNX BOB W1AW DE 9V1NE <SK>', step('sign-off', 0).slots).notes).toEqual(["Send 73: 'best regards'."]);
  });
  it('a stray E on the optional BK is named as a slip', () => {
    const v = checkSend('BKE TU 5NN SINGAPORE SINGAPORE BK', step('pota', 1).slots);
    expect(v).toMatchObject({ result: 'almost', notes: ['BK: you sent BKE; it is BK.'], extras: [] });
  });
  it('AR ends an over where K does', () => {
    expect(checkSend('W1AW DE 9V1NE 9V1NE AR', step('answer-cq', 0).slots)).toMatchObject({ result: 'pass', notes: [] });
    expect(checkSend('W1AW DE 9V1NE 9V1NE <AR> K', step('answer-cq', 0).slots)).toMatchObject({ result: 'pass', notes: [], extras: [] });
    expect(checkSend('HW? W1AW DE 9V1NE AR', step('send-over', 5).slots)).toMatchObject({ result: 'pass', notes: [] });
  });
  it('a report with a digit out of range says which digit and why', () => {
    const r = step('send-over', 2).slots;
    expect(checkSend('UR RST 679 679', r)).toMatchObject({ result: 'almost', notes: ['Your report: you sent 679, but the first digit, readability, goes from 1 to 5.'], extras: [] });
    expect(checkSend('UR RST 509 509', r).notes).toEqual(['Your report: you sent 509, but the second digit, strength, goes from 1 to 9.']);
    expect(checkSend('UR RST 570 570', r).notes).toEqual(['Your report: you sent 570, but the third digit, tone, goes from 1 to 9.']);
    expect(checkSend('BK TU 6NN SINGAPORE SINGAPORE BK', step('pota', 1).slots).notes).toEqual(['Report: you sent 6NN, but the first digit, readability, goes from 1 to 5.']);
  });
  it('a split number or callsign says characters; a split word says letters', () => {
    expect(checkSend('UR RST 5 79 5 79', step('send-over', 2).slots).notes).toEqual(['579 came out as 5 79: a gap inside it was as long as a word space, so keep its characters closer together.']);
    expect(checkSend('C Q CQ CQ DE 9V1NE 9V1NE K', step('call-cq', 0).slots).notes).toEqual(['CQ came out as C Q: a gap inside it was as long as a word space, so keep its letters closer together.']);
  });
});

describe('usual ways of sending are not slips', () => {
  it('HW ?, R R, E E and VA pass', () => {
    expect(checkSend('HW ? W1AW DE 9V1NE K', step('send-over', 5).slots)).toMatchObject({ result: 'pass', notes: [] });
    expect(checkSend('R R TNX BOB', step('send-over', 1).slots)).toMatchObject({ result: 'pass', notes: [] });
    expect(checkSend('TNX BOB 73 W1AW DE 9V1NE <SK> E E', step('sign-off', 0).slots)).toMatchObject({ result: 'pass', notes: [] });
    expect(checkSend('TNX BOB 73 W1AW DE 9V1NE VA', step('sign-off', 0).slots)).toMatchObject({ result: 'pass', notes: [] });
  });
});

describe('POTA: the leading BK is optional', () => {
  const pota = () => step('pota', 1);
  it('passes with or without the leading BK', () => {
    expect(checkSend('TU 5NN SINGAPORE SINGAPORE BK', pota().slots)).toMatchObject({ result: 'pass', notes: [] });
    expect(checkSend('BK TU 5NN SINGAPORE SINGAPORE BK', pota().slots)).toMatchObject({ result: 'pass', notes: [] });
    expect(checkSend('R TU 5NN SINGAPORE BK', pota().slots)).toMatchObject({ result: 'pass', notes: [] });
  });
  it('the hunter step does not ask for DE', () => {
    const v = checkSend('W1AW', step('pota', 0).slots);
    expect(v.result).toBe('try');
    expect(v.notes).toEqual(['Send your call, 9V1NE.']);
  });
});

describe('one slip gives one note', () => {
  it('a stray E on the first call of a whole over', () => {
    const over = step('send-over', 6);
    const v = checkSend(over.model.replace(/^(\S+)/, '$1E'), over.slots);
    expect(v.result).toBe('almost');
    expect(v.notes).toEqual(['Their call: you sent W1AWE; it is W1AW.']);
  });
  it('a stray dit on K is a slip of K', () => {
    const v = checkSend('W1AW DE 9V1NE 9V1NE KE', step('answer-cq', 0).slots);
    expect(v.result).toBe('almost');
    expect(v.notes).toEqual(['K: you sent KE; it is K.']);
  });
  it('a forgotten part is named once, and the rest still lines up', () => {
    const over = step('send-over', 6);
    const noFirstCall = checkSend(over.model.split(' ').slice(1).join(' '), over.slots);
    expect(noFirstCall.notes).toEqual(['Send their call, W1AW.']);
    const noDe = checkSend(over.model.replace(' DE ', ' '), over.slots);
    expect(noDe.notes).toEqual(["Put DE between the calls. It means 'from'."]);
  });
  it('the same slip twice is one note', () => {
    const v = checkSend('W1AW DE 9V1NI 9V1NI K', step('answer-cq', 0).slots);
    expect(v).toMatchObject({ result: 'almost', notes: ['Your call: you sent 9V1NI; it is 9V1NE.'] });
  });
});

// Beginner variants of every model, after the audit's list: each changes one thing.
type Variant = [name: string, fn: (m: string, me: Me) => string, keepsEverything: boolean];
const w = (s: string) => s.split(' ');
const VARIANTS: Variant[] = [
  ['lower case', (m) => m.toLowerCase(), true],
  ['extra spaces', (m) => `  ${m.replace(/ /g, '   ')}  `, true],
  ['prosigns as letters', (m) => m.replace(/<(\w\w)>/g, '$1'), true],
  ['BT typed as =', (m) => m.replace(/<BT>/g, '='), true],
  ['extra E word after first word', (m) => { const x = w(m); x.splice(1, 0, 'E'); return x.join(' '); }, true],
  ['extra T word at end', (m) => `${m} T`, true],
  ['extra E glued to last word', (m) => `${m}E`, true],
  ['extra E glued to first word', (m) => { const x = w(m); x[0] += 'E'; return x.join(' '); }, true],
  ['K as KN', (m) => m.replace(/ K$/, ' KN'), true],
  ['K as BK', (m) => m.replace(/ K$/, ' BK'), true],
  ['first two words merged', (m) => { const x = w(m); return x.length < 2 ? m : [x[0] + x[1], ...x.slice(2)].join(' '); }, true],
  ['last two words merged', (m) => { const x = w(m); return x.length < 2 ? m : [...x.slice(0, -2), x[x.length - 2] + x[x.length - 1]].join(' '); }, true],
  ['my call split in two', (m, me) => m.replaceAll(me.call, `${me.call.slice(0, 3)} ${me.call.slice(3)}`), true],
  ['my call one letter off', (m, me) => m.replaceAll(me.call, me.call.slice(0, -1) + (me.call.endsWith('E') ? 'I' : 'E')), true],
  ['579 as 5NN', (m) => m.replace(/579/g, '5NN'), true],
  ['579 split 5 79', (m) => m.replace(/579/g, '5 79'), true],
  ['TNX as TU', (m) => m.replace(/TNX/g, 'TU'), true],
  ['R as R R', (m) => m.replace(/ R /, ' R R '), true],
  ['NAME IS', (m) => m.replace(/NAME /g, 'NAME IS '), true],
  ['HW? as HW CPY?', (m) => m.replace(/HW\?/g, 'HW CPY?'), true],
  ['SK as VA', (m) => m.replace(/<SK>/g, 'VA'), true],
  ['SK as S K', (m) => m.replace(/<SK>/g, 'S K'), true],
  ['drop the first word', (m) => w(m).slice(1).join(' '), false],
  ['DE missing', (m) => m.replace(/ DE /, ' '), false],
];

describe('every lesson model with one beginner slip', () => {
  const stations = [W1AW, ident('JA1ABC', 'TARO', 'TOKYO', 'JAPAN'), ident('9V1AB', 'TAN', 'SINGAPORE', 'SINGAPORE'), ...Array.from({ length: 20 }, (_, i) => newStation(mulberry32(i + 1), 'world'))];
  for (const me of [SG, SD]) {
    it(`gives at most one note, and never "not yet" when everything is there (${me.call})`, () => {
      const bad: string[] = [];
      for (const them of stations) {
        for (const l of LESSONS) {
          for (const s of sendSteps(l.id, me, them)) {
            for (const [name, fn, keeps] of VARIANTS) {
              const text = fn(s.model, me);
              if (text === s.model) continue;
              const v = checkSend(text, s.slots);
              const where = `${l.id} / ${s.title} / ${them.call} / ${name}: "${text}" -> ${v.result} ${JSON.stringify(v.notes)}`;
              if (v.notes.length > 1) bad.push(where);
              else if (keeps && v.result === 'try') bad.push(where);
            }
          }
        }
      }
      expect(bad).toEqual([]);
    });
  }
});
