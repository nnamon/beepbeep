// @vitest-environment jsdom
// The keyboard and touch keys, timed as the page runs them: key events carry
// their own timestamps (performance clock), and the browser's audio clock can
// stall or jump under load.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { engine } from './engine';
import { LiveDecoder, touchKey } from './live';
import type { DetectorEvent } from '../dsp/detector';

let perfNow = 0;
let audioNow = 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.spyOn(performance, 'now').mockImplementation(() => perfNow);
  vi.spyOn(engine, 'now', 'get').mockImplementation(() => audioNow);
  vi.spyOn(engine, 'ensure').mockResolvedValue(undefined as never);
  vi.spyOn(engine, 'sidetone').mockResolvedValue(undefined);
  vi.spyOn(engine, 'sidetoneElement').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Space pressed or released at `ms` (performance clock), handled 2 ms later. */
function space(down: boolean, ms: number) {
  perfNow = ms + 2;
  const e = new KeyboardEvent(down ? 'keydown' : 'keyup', { code: 'Space' });
  Object.defineProperty(e, 'timeStamp', { value: ms });
  window.dispatchEvent(e);
}

/** K at 15 wpm (dah dit dah, 80 ms dits) from 1 s on the page's clock: [time, down]. */
const K: [number, boolean][] = [
  [1000, true],
  [1240, false],
  [1320, true],
  [1400, false],
  [1480, true],
  [1720, false],
];

async function finish(live: LiveDecoder): Promise<string> {
  perfNow += 3000;
  live.flush();
  await live.settle();
  live.stop();
  return live.text;
}

describe('keyboard and touch key timing', () => {
  // Before: key times were read off the audio clock, so a stalled clock made
  // every mark last no time at all (nothing decoded), and a jumping one
  // shortened dits or stretched them (K read as M or T).
  it('keeps mark lengths when the audio clock stalls', async () => {
    const live = new LiveDecoder({ source: 'straight', charWpm: 15, pitch: 600 });
    await live.start();
    audioNow = 5;
    for (const [ms, down] of K) space(down, ms);
    expect(live.marks.map((m) => Math.round((m.end - m.start) * 1000))).toEqual([240, 80, 240]);
    expect(await finish(live)).toBe('K');
  });

  it('keeps mark lengths when the audio clock jumps', async () => {
    const live = new LiveDecoder({ source: 'touch', charWpm: 15, pitch: 600 });
    await live.start();
    const audio = [5, 5, 5.3, 5.3, 5.3, 5.8];
    K.forEach(([ms, down], i) => {
      audioNow = audio[i];
      perfNow = ms + 2;
      touchKey(down, ms);
    });
    expect(live.marks.map((m) => Math.round((m.end - m.start) * 1000))).toEqual([240, 80, 240]);
    expect(await finish(live)).toBe('K');
  });
});

describe('switching between the touch key and the microphone', () => {
  // The detector keeps its own clock, which starts when the microphone does.
  // Before, the touch key's times (audio clock) and the detector's could run
  // backwards across a switch, and the over's marks came out of order.
  it('keeps the marks in order on one clock', async () => {
    let listener: ((events: DetectorEvent[], time: number) => void) | null = null;
    vi.spyOn(engine, 'onEvents').mockImplementation((l) => {
      listener = l;
      return () => (listener = null);
    });
    vi.spyOn(engine, 'command').mockImplementation(() => undefined);
    // The audio clock started a minute after the page.
    vi.spyOn(engine, 'now', 'get').mockImplementation(() => perfNow / 1000 - 60);
    const live = new LiveDecoder({ source: 'touch', charWpm: 15, pitch: 600 });
    await live.start();
    perfNow = 100002;
    touchKey(true, 100000);
    perfNow = 100082;
    touchKey(false, 100080);
    perfNow = 102000;
    await live.switchSource('mic');
    // The detector has run for 3 s; E keyed at 2.5 s on its clock, 0.5 s ago.
    listener!([{ type: 'key', down: true, t: 2.5 }, { type: 'key', down: false, t: 2.58 }], 3);
    const starts = live.marks.map((m) => m.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(live.marks[1].start - live.marks[0].end).toBeGreaterThan(1);
    live.stop();
  });
});

describe('a key held down', () => {
  // A healthy audio clock, running with the page's.
  beforeEach(() => void vi.spyOn(engine, 'now', 'get').mockImplementation(() => perfNow / 1000 + 7));

  // Before: three seconds with the key down read as T at the end of the over.
  it('reads nothing and leaves the speed alone', async () => {
    const live = new LiveDecoder({ source: 'touch', charWpm: 15, pitch: 600 });
    await live.start();
    const wpm = live.decoder.wpm;
    perfNow = 1002;
    touchKey(true, 1000);
    perfNow = 4002;
    touchKey(false, 4000);
    expect(live.decoder.wpm).toBe(wpm);
    expect(await finish(live)).toBe('');
  });

  it('keeps the letters around it', async () => {
    const live = new LiveDecoder({ source: 'touch', charWpm: 15, pitch: 600 });
    await live.start();
    const keys: [number, boolean][] = [
      [1000, true],
      [1080, false],
      [2000, true],
      [5000, false],
      [6000, true],
      [6080, false],
    ];
    for (const [ms, down] of keys) {
      perfNow = ms + 2;
      touchKey(down, ms);
    }
    expect(await finish(live)).toBe('E E');
  });
});

describe('Space on a focused button', () => {
  /** Space pressed or released on `target` at `ms`; returns the event. */
  function spaceOn(target: Element, down: boolean, ms: number) {
    perfNow = ms + 2;
    const e = new KeyboardEvent(down ? 'keydown' : 'keyup', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
    Object.defineProperty(e, 'timeStamp', { value: ms });
    target.dispatchEvent(e);
    return e;
  }

  function button(): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = 'Stop';
    document.body.append(b);
    return b;
  }

  // Before: Space on Stop or Done reached with Tab keyed the straight key, and
  // the button never got the press.
  it('reached with Tab presses the button and keys nothing', async () => {
    const b = button();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    b.focus();
    const live = new LiveDecoder({ source: 'straight', charWpm: 15, pitch: 600 });
    await live.start();
    const down = spaceOn(b, true, 1000);
    spaceOn(b, false, 1080);
    expect(down.defaultPrevented).toBe(false);
    expect(live.marks).toEqual([]);
    live.stop();
    b.remove();
  });

  it('just clicked with the mouse still keys the straight key', async () => {
    const b = button();
    b.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    b.focus();
    const live = new LiveDecoder({ source: 'straight', charWpm: 15, pitch: 600 });
    await live.start();
    const down = spaceOn(b, true, 1000);
    spaceOn(b, false, 1080);
    expect(down.defaultPrevented).toBe(true);
    expect(live.marks.map((m) => Math.round((m.end - m.start) * 1000))).toEqual([80]);
    live.stop();
    b.remove();
  });
});
