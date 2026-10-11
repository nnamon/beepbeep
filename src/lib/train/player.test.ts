import { describe, expect, it } from 'vitest';
import { Player, wordSpaceMs, type PlayerDeps, type Recipe } from './player';
import { cardsFromText, material, type Card } from './cards';
import { mulberry32 } from '../util/random';

/** A fake clock: CW lasts 1 s a play, speech 0.5 s; every step is logged. */
function fake() {
  let t = 0;
  const log: string[] = [];
  const deps: PlayerDeps = {
    async cw(text, wpm, fwpm) {
      log.push(`cw ${text} ${wpm}/${fwpm}`);
      t += 1000;
      return { done: Promise.resolve(), stop: () => log.push('stop') };
    },
    async say(text, spell) {
      log.push(`say ${text}${spell ? ' (spelled)' : ''}`);
      t += 500;
    },
    hush: () => {},
    async sleep(ms) {
      if (ms > 0) log.push(`wait ${Math.round(ms)}`);
      t += ms;
    },
    now: () => t,
  };
  return { deps, log, time: () => t };
}

const cards = (...s: string[]): Card[] => s.map((x) => ({ cw: x, speech: x }));

async function runToEnd(p: Player) {
  p.start();
  for (let i = 0; i < 200 && !['done'].includes(p.state.phase); i++) await new Promise((r) => setTimeout(r, 0));
}

describe('exercise player', () => {
  it('familiarity: says the card, then plays it three times a word space apart', async () => {
    const f = fake();
    const r: Recipe = { wpm: 14, fwpm: 14, repeats: 2, repeatGap: 2, voice: { when: 'before', spell: true, delay: 1.5, after: 0.25 } };
    await runToEnd(new Player(cards('R'), r, f.deps));
    const gap = Math.round(wordSpaceMs(2, 14));
    expect(f.log).toEqual(['wait 1500', 'say R (spelled)', 'wait 250', 'cw R 14/14', `wait ${gap}`, 'cw R 14/14', `wait ${gap}`, 'cw R 14/14']);
  });

  it('recognition: plays, waits, then says it; cards a set wait apart', async () => {
    const f = fake();
    const r: Recipe = { wpm: 14, fwpm: 14, voice: { when: 'after', spell: true, delay: 1.5, after: 2 }, wait: 1 };
    await runToEnd(new Player(cards('T', 'I'), r, f.deps));
    expect(f.log).toEqual(['cw T 14/14', 'wait 1500', 'say T (spelled)', 'wait 2000', 'wait 1000', 'cw I 14/14', 'wait 1500', 'say I (spelled)', 'wait 2000']);
  });

  it('groups: no voice between cards, everything read back at the end', async () => {
    const f = fake();
    const r: Recipe = { wpm: 12, fwpm: 8, voice: { when: 'end', spell: true, delay: 0 } };
    const p = new Player(cards('REA', 'TIN'), r, f.deps);
    await runToEnd(p);
    expect(f.log.filter((l) => !l.startsWith('wait'))).toEqual(['cw REA 12/8', 'cw TIN 12/8', 'say REA (spelled)', 'say TIN (spelled)']);
    expect(p.state.done).toBe(2);
  });

  it('Speed Racer: fast to slow, says it, then once more at the fastest', async () => {
    const f = fake();
    const r: Recipe = { wpm: 20, fwpm: 20, racer: { multipliers: [1.5, 1.25, 1], say: true, replay: true }, voice: { when: 'after', spell: false, delay: 0.5 } };
    await runToEnd(new Player(cards('CQ'), r, f.deps));
    expect(f.log.filter((l) => !l.startsWith('wait'))).toEqual(['cw CQ 30/30', 'cw CQ 25/25', 'cw CQ 20/20', 'say CQ', 'cw CQ 30/30']);
  });

  it('VET: effective speed steps every 30 s, and the run ends after the last step', async () => {
    const f = fake();
    const steps = [8, 10, 11, 12].map((fwpm) => ({ seconds: 30, wpm: 12, fwpm }));
    const p = new Player(cards(...Array.from({ length: 200 }, (_, i) => `G${i}`)), { wpm: 12, fwpm: 8, steps, wait: 1 }, f.deps);
    await runToEnd(p);
    const speeds = f.log.filter((l) => l.startsWith('cw')).map((l) => l.split(' ')[2]);
    expect(speeds[0]).toBe('12/8');
    expect([...new Set(speeds)]).toEqual(['12/8', '12/10', '12/11', '12/12']);
    // 2 s a card: 60 cards fill 120 s.
    expect(speeds).toHaveLength(60);
    expect(f.time()).toBeLessThan(122_000);
  });

  it('pause stops the sound; resume plays the card again; back and next move', async () => {
    let t = 0;
    const log: string[] = [];
    let release: () => void = () => {};
    const deps: PlayerDeps = {
      async cw(text) {
        log.push(`cw ${text}`);
        return { done: new Promise<void>((r) => (release = r)), stop: () => log.push('stop') };
      },
      async say() {},
      hush: () => {},
      async sleep(ms) {
        t += ms;
      },
      now: () => t,
    };
    const p = new Player(cards('A', 'B', 'C'), { wpm: 20, fwpm: 20 }, deps);
    p.start();
    await new Promise((r) => setTimeout(r, 0));
    p.pause();
    expect(p.state.phase).toBe('paused');
    expect(log).toEqual(['cw A', 'stop']);
    p.next();
    expect(p.state.index).toBe(1);
    expect(p.state.phase).toBe('paused');
    p.resume();
    await new Promise((r) => setTimeout(r, 0));
    expect(log.at(-1)).toBe('cw B');
    p.back();
    await new Promise((r) => setTimeout(r, 0));
    expect(log.slice(-2)).toEqual(['stop', 'cw A']);
    release();
  });
});

describe('cards', () => {
  it('reads your text one line or one word to a card', () => {
    expect(cardsFromText('cq cq de\n\n  tnx fer call ', true)).toEqual([
      { cw: 'CQ CQ DE', speech: 'cq cq de' },
      { cw: 'TNX FER CALL', speech: 'tnx fer call' },
    ]);
    expect(cardsFromText('rig ant', false).map((c) => c.cw)).toEqual(['RIG', 'ANT']);
  });

  it("reads Morse Browser markup: {cw|speech}, CW only, voice only", () => {
    const [a, b, c] = cardsFromText('{consumer|}\n{|African consumer}\n{73|best regards} es gl', true);
    expect(a).toEqual({ cw: 'CONSUMER', speech: '' });
    expect(b).toEqual({ cw: '', speech: 'African consumer' });
    expect(c).toEqual({ cw: '73 ES GL', speech: 'best regards es gl' });
  });

  it('keeps prosigns and drops what has no code', () => {
    expect(cardsFromText('tu <sk> “73”', true)[0].cw).toBe('TU <SK> 73');
  });

  it('generates material from the lesson only', () => {
    const rng = mulberry32(3);
    const known = ['R', 'E', 'A', 'T', 'I', 'N'];
    for (const src of ['chars', 'groups', 'words', 'trigrams'] as const) {
      for (const c of material(src, { rng, known, added: ['T', 'I', 'N'], count: 30, min: 1, max: 3 })) {
        expect(c.cw.replace(/ /g, '').split('').every((ch) => known.includes(ch)), `${src}: ${c.cw}`).toBe(true);
      }
    }
    expect(material('new', { rng, known, added: ['T', 'I', 'N'], count: 9 }).map((c) => c.cw).sort()).toEqual(['I', 'I', 'I', 'N', 'N', 'N', 'T', 'T', 'T']);
    // BK comes as a pair with 2 and 8.
    const bk = material('new', { rng, known: [...known, '2', '8', 'B', 'K'], added: ['2', '8'], words: ['BK'], count: 30 });
    expect(bk.some((c) => c.cw === 'BK')).toBe(true);
  });
});
