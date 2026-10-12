import { describe, expect, it } from 'vitest';
import { LESSONS, newStation, type Me } from './lessons';
import { checkField, checkSend } from './check';
import { mulberry32 } from '../util/random';

const ME: Me = { call: 'k1xyz', name: 'tom', qth: 'salem', state: 'ma' };
const ME2: Me = { call: 'VK2ABC', name: 'Annabel', qth: 'San Diego', state: 'CA' };
// A city-state: the QTH says it all, with or without the region filled in.
const SG: Me = { call: '9v1ne', name: 'Jeremy', qth: 'Singapore', state: '' };
const SG2: Me = { call: '9V1NE', name: 'JEREMY', qth: 'SINGAPORE', state: 'singapore' };

describe('guided QSO lessons', () => {
  it("every step's model passes its own check, for many stations", () => {
    for (const me of [ME, ME2, SG, SG2]) {
      for (let seed = 1; seed <= 50; seed++) {
        const them = newStation(mulberry32(seed), 'world');
        for (const l of LESSONS) {
          for (const s of l.steps({ me, them })) {
            if (s.kind === 'send') {
              const v = checkSend(s.model, s.slots);
              expect(v.result, `${l.id} / ${s.title} / ${them.call}: ${v.notes.join(' ')}`).toBe('pass');
            }
            if (s.kind === 'listen') for (const f of s.fields) expect(s.play.toUpperCase(), `${l.id} / ${s.title}`).toContain(f.answer.toUpperCase());
          }
        }
      }
    }
  });

  it('answering a CQ: says what is missing or wrong', () => {
    const them = newStation(mulberry32(3), 'world');
    const step = LESSONS[0].steps({ me: ME, them }).find((s) => s.kind === 'send')!;
    if (step.kind !== 'send') throw new Error();
    const T = them.call;
    expect(checkSend(`${T} DE K1XYZ K1XYZ K`, step.slots).result).toBe('pass');
    expect(checkSend(`${T} DE K1XYZ K`, step.slots).result).toBe('pass');
    const noK = checkSend(`${T} DE K1XYZ K1XYZ`, step.slots);
    expect(noK.result).toBe('try');
    expect(noK.notes).toEqual(["End with K. It means 'over to you'."]);
    const noDe = checkSend(`${T} K1XYZ K1XYZ K`, step.slots);
    expect(noDe.notes).toEqual(["Put DE between the calls. It means 'from'."]);
    // One letter off on a call: almost, with the fix.
    const slip = checkSend(`${T} DE K1XYA K1XYZ K`, step.slots);
    expect(slip.result).toBe('almost');
    expect(slip.notes[0]).toBe('Your call: you sent K1XYA; it is K1XYZ.');
    // Calling yourself first is not answering them.
    expect(checkSend('K1XYZ DE K1XYZ K', step.slots).result).toBe('try');
  });

  it('a report must be a report; names and sign-off parts are named when missing', () => {
    const them = newStation(mulberry32(5), 'world');
    const steps = LESSONS.find((l) => l.id === 'send-over')!.steps({ me: ME, them });
    const report = steps.find((s) => s.title === 'Your report on them')!;
    if (report.kind !== 'send') throw new Error();
    expect(checkSend('UR RST 579 579', report.slots).result).toBe('pass');
    expect(checkSend('UR RST 5NN 5NN', report.slots).result).toBe('pass');
    expect(checkSend('UR RST 579', report.slots).notes).toEqual(['Send your report twice.']);
    // Three digits, but not a report: it says which digit is out of range.
    expect(checkSend('UR RST 679 679', report.slots)).toMatchObject({ result: 'almost', notes: ['Your report: you sent 679, but the first digit, readability, goes from 1 to 5.'] });
    const off = LESSONS.find((l) => l.id === 'sign-off')!.steps({ me: ME, them })[1];
    if (off.kind !== 'send') throw new Error();
    expect(checkSend(`TNX 73 ${them.call} DE K1XYZ`, off.slots).notes).toEqual(['End with SK, one character with no gap inside (· · · – · –).']);
    expect(checkSend(`TNX 73 ${them.call} DE K1XYZ <SK>`, off.slots).result).toBe('pass');
  });

  it('copied fields: exact, a letter off, or wrong; 5NN is 599; the town is enough', () => {
    expect(checkField('w1abc', 'W1ABC', 'call').result).toBe('right');
    expect(checkField('W1ABD', 'W1ABC', 'call').result).toBe('close');
    expect(checkField('K2ZZ', 'W1ABC', 'call').result).toBe('wrong');
    expect(checkField('5NN', '599', 'rst').result).toBe('right');
    expect(checkField('Salem MA', 'SALEM', 'qth').result).toBe('right');
    expect(checkField('SAN FRANCISCO', 'SAN DIEGO', 'qth').result).toBe('wrong');
  });
});

describe('their QTH', () => {
  const qthSteps = (them: ReturnType<typeof newStation>) => {
    const steps = LESSONS.find((l) => l.id === 'copy-over')!.steps({ me: ME, them });
    const play = (title: string) => {
      const s = steps.find((x) => x.title === title)!;
      return s.kind === 'listen' ? s.play : '';
    };
    const explain = steps.find((x) => x.title === 'The QTH')!.explain.join(' ');
    return { part: play('The QTH'), over: play('Copy their first over'), explain };
  };
  it('a city-state station sends its QTH once, twice over', () => {
    const sg = { ...newStation(mulberry32(1), 'world'), call: '9V1AB', qth: 'SINGAPORE', state: 'SINGAPORE' };
    const q = qthSteps(sg);
    expect(q.part).toBe('QTH SINGAPORE SINGAPORE');
    expect(q.over).toContain('<BT> QTH SINGAPORE SINGAPORE <BT>');
    expect(q.explain).not.toMatch(/both twice/);
  });
  it('a station with a region sends the town and region, twice over', () => {
    const ct = { ...newStation(mulberry32(1), 'world'), call: 'W1AW', qth: 'NEWINGTON', state: 'CT' };
    const q = qthSteps(ct);
    expect(q.part).toBe('QTH NEWINGTON CT NEWINGTON CT');
    expect(q.over).toContain('<BT> QTH NEWINGTON CT NEWINGTON CT <BT>');
  });
});

describe('where you are', () => {
  it('sends the QTH once, with a region only when it adds something', () => {
    const them = newStation(mulberry32(8), 'world');
    const qth = (me: Me) => {
      const s = LESSONS.find((l) => l.id === 'send-over')!.steps({ me, them }).find((x) => x.title === 'Where you are')!;
      return s.kind === 'send' ? s.model : '';
    };
    expect(qth(SG)).toBe('QTH SINGAPORE');
    expect(qth(SG2)).toBe('QTH SINGAPORE');
    expect(qth(ME)).toBe('QTH SALEM MA');
    // In a POTA exchange the region is your QTH when you left it blank.
    const pota = LESSONS.find((l) => l.id === 'pota')!.steps({ me: SG, them }).find((x) => x.title === 'Your report and region')!;
    expect(pota.kind === 'send' && pota.model).toBe('BK TU 5NN SINGAPORE SINGAPORE BK');
  });
});
