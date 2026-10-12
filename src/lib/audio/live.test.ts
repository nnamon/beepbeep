// @vitest-environment jsdom
// The keyboard and touch keys, as the page runs them.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { engine } from './engine';
import { LiveDecoder, touchKey } from './live';

let perfNow = 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.spyOn(performance, 'now').mockImplementation(() => perfNow);
  vi.spyOn(engine, 'ensure').mockResolvedValue(undefined as never);
  vi.spyOn(engine, 'sidetone').mockResolvedValue(undefined);
  vi.spyOn(engine, 'sidetoneElement').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function finish(live: LiveDecoder): Promise<string> {
  perfNow += 3000;
  live.flush();
  await live.settle();
  live.stop();
  return live.text;
}

describe('a key held down', () => {
  // The audio clock, running with the page's.
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
