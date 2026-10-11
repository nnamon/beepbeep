import { describe, expect, it } from 'vitest';
import { todaySteps, type TodayInput } from './today';
import { CLASSES, classById, type ClassId } from './classes';

const base: TodayInput = { track: 'licw', stage: 'bc1', fresh: ['T', 'I', 'N'], weak: [], added: ['T', 'I', 'N'], sessionMinutes: 15, day: 0 };
const ROUTES = new Set(['practice/familiarity', 'practice/copy/groups', 'practice/ttr', 'practice/hear-send', 'practice/ifr', 'pocket/round/characters', 'qso', 'qso/learn/whole']);

describe("today's session", () => {
  it('every step on every stage and day opens something real', () => {
    for (const track of ['koch', 'licw'] as const) {
      for (const c of CLASSES) {
        for (let day = 0; day < 12; day++) {
          for (const steps of [todaySteps({ ...base, track, stage: c.id as ClassId, day }), todaySteps({ ...base, track, stage: c.id as ClassId, day, fresh: [], weak: ['K'] })]) {
            expect(steps.length).toBeGreaterThan(2);
            for (const s of steps) {
              if (s.to[0] === 'practice' && s.to[1] === 'class') {
                const ex = classById(s.to[2])?.exercises.find((e) => e.id === s.to[3]);
                expect(ex, `${c.id} day ${day}: ${s.to.join('/')}`).toBeTruthy();
                expect(ex!.source, `${s.to.join('/')} needs your own text`).not.toBe('text');
                expect(s.modes).toContain(`class:${s.to[2]}/${s.to[3]}`);
              } else expect(ROUTES.has(s.to.join('/')), s.to.join('/')).toBe(true);
            }
          }
        }
      }
    }
  });

  it('BC: new sounds first, then naming, copying, sending; copy exercise changes daily', () => {
    const steps = todaySteps(base);
    expect(steps.map((s) => s.id)).toEqual(['familiarity', 'spot', 'recognition', 'ttr', 'copy', 'send', 'check']);
    expect(steps[0].title).toBe('Familiarity on T I N');
    const copies = new Set(Array.from({ length: 6 }, (_, day) => todaySteps({ ...base, day }).find((s) => s.id === 'copy')!.title));
    expect(copies.size).toBe(6);
    // Once the group is learned, the spot step drops out.
    expect(todaySteps({ ...base, fresh: [] }).map((s) => s.id)).not.toContain('spot');
  });

  it('scales the required steps to your session length', () => {
    const total = (m: number) => todaySteps({ ...base, sessionMinutes: m }).filter((s) => !s.optional).reduce((a, s) => a + s.minutes, 0);
    expect(Math.abs(total(15) - 15)).toBeLessThanOrEqual(2);
    expect(Math.abs(total(30) - 30)).toBeLessThanOrEqual(3);
  });

  it('Koch: new character, copy, TTR, send, weak characters if any', () => {
    const steps = todaySteps({ ...base, track: 'koch', fresh: ['R'], weak: ['K', 'M'], added: ['R'] });
    expect(steps.map((s) => s.id)).toEqual(['spot', 'copy', 'ttr', 'send', 'weak', 'more']);
    expect(steps.find((s) => s.id === 'weak')!.title).toBe('Pocket round for K M');
  });
});
