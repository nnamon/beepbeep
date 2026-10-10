import { describe, expect, it } from 'vitest';
import { parse, isCallsign, missingPart } from './parse';
import { QsoBot, type Format } from './bot';

const ME = { call: 'K1ABC', name: 'TOM', qth: 'BOSTON', state: 'MA', skcc: '12345T' };

describe('parser', () => {
  it('reads a typical first over', () => {
    const p = parse('W9XYZ DE K1ABC R R GM TNX FER CALL UR RST 579 579 = NAME TOM TOM = QTH BOSTON MA BOSTON MA = HW? W9XYZ DE K1ABC KN');
    expect(p.calls).toEqual(['W9XYZ', 'K1ABC']);
    expect(p.rst).toBe('579');
    expect(p.name).toBe('TOM');
    expect(p.qth).toBe('BOSTON MA');
    expect(p.state).toBe('MA');
    expect(p.handover).toBe(true);
  });
  it('knows callsigns from reports and cut numbers', () => {
    expect(isCallsign('K1ABC')).toBe(true);
    expect(isCallsign('VE3XYZ')).toBe(true);
    expect(isCallsign('5NN')).toBe(false);
    expect(isCallsign('579')).toBe(false);
    expect(parse('UR 5NN').rst).toBe('599');
  });
  it('spots requests and sign-off', () => {
    expect(parse('QRS PSE').qrs).toBe(true);
    expect(parse('NAME?').asks).toContain('name');
    expect(parse('TNX FER QSO 73 TU <SK>').signoff).toBe(true);
    expect(parse('AGN?').agn).toBe(true);
  });
  it('finds the missed part of a busted call', () => {
    expect(missingPart('WB2UZ', 'WB2UZE')).toBe('E');
    expect(missingPart('WB2XXX', 'WB2UZE')).toBe('UZE');
  });
});

function run(format: Format, script: (bot: QsoBot) => string[]) {
  const bot = new QsoBot({ format, opener: 'bot', you: ME, wpm: 20, seed: 42 });
  const opening = bot.start();
  expect(opening[0].text).toContain(bot.active!.call);
  for (const over of script(bot)) bot.hear(over);
  return bot;
}

describe('bot calls CQ', () => {
  it('completes a ragchew and copies your details', () => {
    const bot = run('ragchew', (b) => {
      const c = b.active!.call;
      return [
        `${c} DE K1ABC K1ABC K`,
        `${c} DE K1ABC R R TNX FER CALL UR RST 579 579 = NAME TOM TOM = QTH BOSTON MA = HW? ${c} DE K1ABC KN`,
        `R R FB = RIG HR IS K3 = ANT IS DIPOLE = ${c} DE K1ABC KN`,
        `R R FB = WX HR SUNNY = ${c} DE K1ABC KN`,
        `R R FB = AGE 52 ${c} DE K1ABC KN`,
        `TNX FER QSO 73 ${c} DE K1ABC TU <SK>`,
        'EE',
      ];
    });
    expect(bot.done).toBe(true);
    expect(bot.copied).toMatchObject({ call: 'K1ABC', rst: '579', name: 'TOM', state: 'MA' });
  });

  it('asks again when it cannot read you', () => {
    const bot = new QsoBot({ format: 'ragchew', opener: 'bot', you: ME, wpm: 20, seed: 1 });
    bot.start();
    expect(bot.hear('EEEE TTT')[0].text).toMatch(/^QRZ\?/);
  });

  it('gives stations their own pace and abbreviation habits', () => {
    const plain = new QsoBot({ format: 'ragchew', opener: 'bot', you: ME, wpm: 20, seed: 1 });
    plain.stations[0].abbrev = 0;
    plain.stations[0].pace = 2;
    const opening = plain.start();
    expect(opening[0].wpm).toBe(22);
    const reply = plain.hear(`${plain.active!.call} DE K1ABC TNX FER CALL UR RST 579 579 NAME TOM TOM QTH BOSTON MA BK`);
    const words = reply.map((t) => t.text).join(' ').split(' ');
    expect(words.some((w) => ['THANKS', 'FOR', 'AND', 'HERE'].includes(w))).toBe(true);
    const sst = new QsoBot({ format: 'sst', opener: 'bot', you: ME, wpm: 20, seed: 1 });
    sst.stations[0].pace = 2;
    expect(sst.start()[0].wpm).toBe(20);
  });

  it('repeats and slows down on QRS', () => {
    const bot = new QsoBot({ format: 'ragchew', opener: 'bot', you: ME, wpm: 20, seed: 1 });
    const first = bot.start();
    const again = bot.hear('QRS');
    expect(again[0].text).toBe(first[0].text);
    expect(again[0].wpm).toBe(first[0].wpm - 4);
  });

  it('repairs a busted call the LICW way', () => {
    const bot = new QsoBot({ format: 'ragchew', opener: 'you', you: ME, wpm: 20, seed: 3 });
    const answer = bot.hear('CQ CQ DE K1ABC K1ABC K');
    const real = bot.active!.call;
    expect(answer[0].text).toContain(real);
    const wrong = real.slice(0, -1) + (real.endsWith('X') ? 'Y' : 'X');
    const fix = bot.hear(`${wrong} DE K1ABC UR 599 K`)[0].text;
    const miss = missingPart(wrong, real);
    expect(fix).toBe(`${real} ${miss} ${miss} ${miss} ${real} K`);
  });

  it('runs a contest exchange', () => {
    const bot = run('contest', () => ['K1ABC', 'TU 5NN 012']);
    expect(bot.done).toBe(true);
    expect(bot.copied.serial).toBe('12');
  });

  it('runs SKCC, SST and POTA exchanges', () => {
    const skcc = run('skcc', (b) => [`${b.active!.call} DE K1ABC K`, `BK R TNX UR 579 579 MA MA NAME TOM TOM NR 12345T 12345T BK`]);
    expect(skcc.done).toBe(true);
    expect(skcc.copied).toMatchObject({ skcc: '12345T', name: 'TOM', state: 'MA' });

    const sst = run('sst', (b) => ['K1ABC', `GE ${b.active!.name} TOM MA`]);
    expect(sst.done).toBe(true);
    expect(sst.copied).toMatchObject({ name: 'TOM', state: 'MA' });
    expect(sst.botWpm).toBeLessThanOrEqual(20);

    const pota = run('pota', () => ['K1ABC K1ABC', 'BK TU UR 5NN 5NN MA MA 73 BK']);
    expect(pota.done).toBe(true);
    expect(pota.copied.state).toBe('MA');
  });
});

describe('you call CQ', () => {
  it('a station answers and the QSO completes', () => {
    const bot = new QsoBot({ format: 'licw', opener: 'you', you: ME, wpm: 18, seed: 9 });
    const ans = bot.hear('CQ CQ CQ DE K1ABC K1ABC K');
    const c = bot.active!.call;
    expect(ans[0].text).toBe(`K1ABC DE ${c} ${c} K`);
    bot.hear(`${c} DE K1ABC GM TNX FER CALL UR RST 599 599 = NAME TOM TOM = QTH BOSTON MA = HW? ${c} DE K1ABC KN`);
    bot.hear(`R R TNX FER QSO 73 ${c} DE K1ABC <SK>`);
    expect(bot.done).toBe(true);
  });

  it('works a pileup station by station', () => {
    const bot = new QsoBot({ format: 'pileup', opener: 'you', you: ME, wpm: 22, seed: 5, crowd: 3 });
    const calls = bot.hear('CQ DE K1ABC K');
    expect(calls).toHaveLength(3);
    const target = bot.stations[1].call;
    // Partial call with "?" brings back the matching station.
    const again = bot.hear(`${target.slice(-3)}?`);
    expect(again.some((t) => t.who === target)).toBe(true);
    const exch = bot.hear(`${target} 5NN`);
    expect(exch[0].text).toMatch(/^R TU 5NN/);
    const next = bot.hear('TU QRZ');
    expect(next).toHaveLength(2);
    expect(bot.completed.map((s) => s.call)).toEqual([target]);
  });
});

describe('garbled sending', () => {
  it('asks for QRS and a repeat when it cannot read you', () => {
    const bot = new QsoBot({ format: 'ragchew', opener: 'bot', you: ME, wpm: 20, seed: 2 });
    bot.start();
    expect(bot.hear('⁇ ⁇ E ⁇ T')[0].text).toBe('QRS PSE AGN?');
  });
});
