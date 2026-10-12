import { describe, expect, it } from 'vitest';
import { parse, isCallsign, missingPart, endsTurn } from './parse';
import { QsoBot, FORMATS, reportSent, type Format } from './bot';

const ME = { call: 'K1ABC', name: 'TOM', qth: 'BOSTON', state: 'MA', skcc: '12345T' };
const SG = { call: '9V1NE', name: 'AMON', qth: 'SINGAPORE', state: '', skcc: '' };

describe('when your turn ends', () => {
  /** Where the simulator would stop listening, word by word: the first prefix that ends the turn. */
  const cut = (over: string) => {
    const w = over.split(' ');
    for (let i = 1; i <= w.length; i++) if (endsTurn(w.slice(0, i).join(' '))) return w.slice(0, i).join(' ');
    return null;
  };
  it("the lessons' own overs run to their end", () => {
    const over = 'W1AW DE 9V1NE R TNX BOB <BT> UR RST 579 579 <BT> NAME AMON AMON <BT> QTH SINGAPORE <BT> HW? W1AW DE 9V1NE K';
    expect(cut(over)).toBe(over);
    expect(cut('BK TU 5NN SINGAPORE SINGAPORE BK')).toBe('BK TU 5NN SINGAPORE SINGAPORE BK');
    expect(cut('TNX BOB 73 W1AW DE 9V1NE <SK>')).toBe('TNX BOB 73 W1AW DE 9V1NE <SK>');
    expect(cut('R R TNX FER QSO 73 ES GL W1AW DE 9V1NE KN')).toBe('R R TNX FER QSO 73 ES GL W1AW DE 9V1NE KN');
  });
  it('K, KN, SK, AR and a closing BK end it; EE after SK still ends it', () => {
    for (const end of ['K', 'KN', '<KN>', 'SK', '<SK>', 'AR', '+', 'BK']) expect(endsTurn(`W1AW DE 9V1NE ${end}`), end).toBe(true);
    expect(endsTurn('W1AW DE 9V1NE <SK> EE')).toBe(true);
    for (const open of ['BK', 'HW?', 'QTH?', '73', 'TU 73', 'QTH REGINA SK', 'QTH RICHMOND VA', 'QTH LITTLE ROCK AR', 'AGN?']) expect(endsTurn(open), open).toBe(false);
  });
});

describe('exchanges without K', () => {
  it('a contest exchange ends once your callsign, then your serial number, is in', () => {
    const c = new QsoBot({ format: 'contest', opener: 'bot', you: SG, wpm: 20, seed: 1 });
    c.start();
    expect(c.turnComplete(c.active!.call)).toBe(false);
    expect(c.turnComplete('9V1NE')).toBe(true);
    c.hear('9V1NE');
    expect(c.turnComplete('TU 5NN')).toBe(false);
    expect(c.turnComplete('TU 5NN 001')).toBe(true);
  });
  it('SST needs your name and region; POTA and SOTA your report and region', () => {
    const sst = new QsoBot({ format: 'sst', opener: 'you', you: SG, wpm: 18, seed: 2 });
    expect(sst.turnComplete('CQ SST')).toBe(false);
    expect(sst.turnComplete('CQ SST 9V1NE')).toBe(true);
    sst.hear('CQ SST 9V1NE');
    const call = sst.active!.call;
    expect(sst.turnComplete(`${call} GE AMON`)).toBe(false);
    expect(sst.turnComplete(`${call} GE AMON SINGAPORE`)).toBe(true);
    for (const format of ['pota', 'sota'] as const) {
      const p = new QsoBot({ format, opener: 'bot', you: SG, wpm: 18, seed: 3 });
      p.start();
      p.hear('9V1NE');
      expect(p.turnComplete('R TU 5NN'), format).toBe(false);
      expect(p.turnComplete('R TU 5NN SINGAPORE'), format).toBe(true);
    }
  });
  it('a ragchew always needs K or a pause', () => {
    const r = new QsoBot({ format: 'ragchew', opener: 'bot', you: SG, wpm: 18, seed: 4 });
    r.start();
    expect(r.turnComplete('9V1NE')).toBe(false);
    expect(r.turnComplete(`${r.active!.call} DE 9V1NE 9V1NE`)).toBe(false);
  });
});

describe('the station hears you right', () => {
  it('works a station whose call is close to yours', () => {
    const bot = new QsoBot({ format: 'ragchew', opener: 'bot', you: SG, wpm: 18, seed: 1 });
    bot.active!.call = '9V1AB';
    bot.start();
    const reply = bot.hear('9V1AB DE 9V1NE 9V1NE K')[0].text;
    expect(reply).not.toMatch(/QRZ/);
    expect(reply).toMatch(/^9V1NE DE 9V1AB /);
    expect(bot.copied.call).toBe('9V1NE');
    // Calling CQ: the close call is still yours, and the station does not "repair" its own call.
    const you = new QsoBot({ format: 'licw', opener: 'you', you: SG, wpm: 18, seed: 1 });
    you.active!.call = '9V1AB';
    expect(you.hear('CQ CQ DE 9V1NE 9V1NE K')[0].text).toMatch(/^9V1NE DE 9V1AB/);
    expect(you.hear('9V1AB DE 9V1NE GE TNX FER CALL UR RST 579 579 NAME AMON AMON QTH SINGAPORE HW? 9V1AB DE 9V1NE KN')[0].text).toMatch(/^9V1NE DE 9V1AB R R/);
  });
  it('answers a garbled CQ that has your call, and asks who is calling when it has none', () => {
    for (const format of ['ragchew', 'pota', 'contest', 'sst'] as Format[]) {
      const bot = new QsoBot({ format, opener: 'you', you: SG, wpm: 18, seed: 4 });
      const r = bot.hear('KQ KQ DE 9V1NE K');
      expect(r.length, format).toBe(1);
      expect(r[0].text, format).toContain(bot.active!.call);
      const none = new QsoBot({ format, opener: 'you', you: SG, wpm: 18, seed: 4 });
      expect(none.hear('TETQ TETQ K')[0]?.text, format).toBe('QRZ?');
    }
  });
  it('a CQ without your call gets QRZ?, not your saved call', () => {
    const bot = new QsoBot({ format: 'ragchew', opener: 'you', you: SG, wpm: 18, seed: 4 });
    expect(bot.hear('CQ CQ CQ K')[0].text).toBe('QRZ?');
    expect(bot.copied.call).toBeNull();
  });
  it('HW? closing a full over is not a request for your report', () => {
    const bot = new QsoBot({ format: 'ragchew', opener: 'bot', you: SG, wpm: 18, seed: 4 });
    bot.start();
    const c = bot.active!.call;
    bot.hear(`${c} DE 9V1NE 9V1NE K`);
    const reply = bot.hear(`${c} DE 9V1NE R TNX <BT> UR RST 579 579 <BT> NAME AMON AMON <BT> QTH SINGAPORE <BT> HW? ${c} DE 9V1NE K`)[0].text;
    expect(reply).not.toMatch(/^UR RST/);
    // On its own, HW? asks how they copy you: they give you a report.
    expect(bot.hear(`HW? ${c} DE 9V1NE K`)[0].text).toMatch(/UR RST/);
  });
});

describe('SST outside the USA', () => {
  for (const region of ['SG', '9V', 'DX', 'TAMPINES', 'SINGAPORE']) {
    it(`takes ${region} as your region and finishes`, () => {
      const bot = new QsoBot({ format: 'sst', opener: 'you', you: SG, wpm: 18, seed: 4 });
      bot.hear('CQ SST 9V1NE');
      bot.hear(`${bot.active!.call} GE AMON ${region}`);
      expect(bot.done).toBe(true);
      expect(bot.copied).toMatchObject({ name: 'AMON', state: region });
    });
  }
  for (const over of ['GE AMON SINGAPORE', 'TNX AMON SINGAPORE', 'BK AMON SINGAPORE', 'DE 9V1NE AMON SINGAPORE', 'GE OM AMON SINGAPORE', 'R TU AMON SINGAPORE BK']) {
    it(`reads the name and region in "${over}"`, () => {
      const bot = new QsoBot({ format: 'sst', opener: 'you', you: SG, wpm: 18, seed: 4 });
      bot.hear('CQ SST 9V1NE');
      bot.hear(`${bot.active!.call} ${over}`);
      expect(bot.copied).toMatchObject({ name: 'AMON', state: 'SINGAPORE' });
    });
  }
  it('Delaware and Ontario still count as regions', () => {
    for (const st of ['DE', 'ON']) {
      const bot = new QsoBot({ format: 'sst', opener: 'you', you: { ...ME, state: st }, wpm: 18, seed: 4 });
      bot.hear('CQ SST K1ABC');
      bot.hear(`${bot.active!.call} GE TOM ${st}`);
      expect(bot.copied, st).toMatchObject({ name: 'TOM', state: st });
    }
  });
});

describe('what the station sent you', () => {
  it('is the report it actually sent, as digits, or nothing in SST', () => {
    const bot = new QsoBot({ format: 'ragchew', opener: 'bot', you: SG, wpm: 18, seed: 4 });
    const s = { ...bot.active!, rst: '579' };
    expect(reportSent('ragchew', s)).toBe('579');
    expect(reportSent('sota', s)).toBe('579');
    for (const f of ['pota', 'contest', 'pileup'] as Format[]) expect(reportSent(f, s), f).toBe('599');
    expect(reportSent('sst', s)).toBe('');
  });
});

describe('format descriptions', () => {
  it('explain each format in whole sentences, without "state" alone or WPM in capitals', () => {
    for (const f of FORMATS) {
      expect(f.exchange, f.id).toMatch(/\.$/);
      expect(f.exchange, f.id).not.toMatch(/\bstate\b(?!, province)|WPM|each repeated/);
    }
  });
});

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

describe('international stations', () => {
  it('gives every station a call, city and region from one country', async () => {
    const { makeIdentity } = await import('./bot');
    const { COUNTRIES, countryOf } = await import('../train/world');
    const { mulberry32 } = await import('../util/random');
    const rng = mulberry32(42);
    for (let i = 0; i < 600; i++) {
      const s = makeIdentity(rng, 0, 'world');
      const c = countryOf(s.call);
      expect(c, s.call).not.toBeNull();
      expect(c!.places.some((p) => p.city === s.qth && p.region === s.state), `${s.call} ${s.qth} ${s.state}`).toBe(true);
      expect(COUNTRIES).toContain(c);
    }
  });

  it('works out your area and weights the stations you hear', async () => {
    const { areaOf, countryOf, MIXES } = await import('../train/world');
    const { makeIdentity } = await import('./bot');
    const { mulberry32 } = await import('../util/random');
    expect(areaOf({ call: '9V1AB', state: '' })).toBe('asia');
    expect(areaOf({ call: '', state: 'SINGAPORE' })).toBe('asia');
    expect(areaOf({ call: 'DL1ABC', state: '' })).toBe('europe');
    expect(areaOf({ call: 'K1ABC', state: '' })).toBe('americas');
    expect(areaOf({ call: '', state: '' })).toBeNull();
    const rng = mulberry32(7);
    const counts = { asia: 0, europe: 0, americas: 0 };
    const n = 2000;
    for (let i = 0; i < n; i++) counts[countryOf(makeIdentity(rng, 0, 'asia').call)!.area]++;
    for (const area of ['asia', 'europe', 'americas'] as const) {
      expect(Math.abs(counts[area] / n - MIXES.asia[area]), area).toBeLessThan(0.04);
    }
  });

  it('copies your region when it is a country, or one it does not list', () => {
    for (const region of ['SINGAPORE', 'PENANG']) {
      const bot = new QsoBot({ format: 'sst', opener: 'you', you: { ...ME, call: '9V1AB', name: 'JOSE', state: region }, wpm: 18, seed: 3 });
      bot.hear('CQ SST DE 9V1AB');
      bot.hear(`GE ${bot.active!.name} JOSE ${region}`);
      expect(bot.copied, region).toMatchObject({ name: 'JOSE', state: region });
    }
  });

  it('does not take the SK prosign for Saskatchewan', () => {
    expect(parse('TNX FER QSO 73 TU <SK>').state).toBeNull();
    expect(parse('QTH REGINA SK').state).toBe('SK');
  });
});
