// @vitest-environment jsdom
// The interim radio source: the app's detector run offline over rendered
// audio, its events shared out by pitch and decoded continuously.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderText } from '../morse/render';
import { Detector, type DetectorEvent } from '../dsp/detector';
import { engine } from '../audio/engine';
import { settings } from '../state/settings.svelte';
import { micError, signal, stopMic } from '../state/signal.svelte';
import { KEEP_CHARS, OVER_MARKS, SignalTracker, SingleSignalSource, keepLast } from './single';
import type { RadioSignal } from './source';

const FS = 48000;

type Part = { text: string; hz: number; wpm: number } | { silence: number };

/** Stations one after another (and silences), as one recording. */
function band(parts: Part[], snrDb = 25): Float32Array {
  const pieces = parts.map((p) =>
    'silence' in p
      ? new Float32Array(Math.round(p.silence * FS))
      : renderText(p.text, { sampleRate: FS, pitch: p.hz, amplitude: 0.4, charWpm: p.wpm, seed: 7 }).samples,
  );
  const out = new Float32Array(pieces.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of pieces) {
    out.set(p, at);
    at += p.length;
  }
  // A radio's hiss under everything, the stations included.
  let seed = 11;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const noise = 0.4 * Math.SQRT1_2 * 10 ** (-snrDb / 20) * Math.sqrt(3);
  for (let i = 0; i < out.length; i++) out[i] += noise * rand();
  return out;
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Runs the detector over the samples in worklet-sized blocks, as the browser does, into `sink`. */
function listen(samples: Float32Array, sink: (events: DetectorEvent[], time: number) => void, dit: () => number | null) {
  const detector = new Detector(FS, { dit: 1.2 / 18 });
  for (let i = 0; i < samples.length; i += 128) {
    const events = detector.process(samples.subarray(i, Math.min(samples.length, i + 128)));
    sink(events, detector.time);
    const d = dit();
    if (d) detector.setDit(d);
  }
}

async function track(parts: Part[]): Promise<RadioSignal[]> {
  let ms = 0;
  const tracker = new SignalTracker(undefined, () => ms);
  listen(band(parts), (events, time) => {
    ms = time * 1000;
    tracker.feed(events, time);
  }, () => tracker.dit);
  await tracker.finish();
  await settle();
  return tracker.list();
}

describe('keepLast', () => {
  it('keeps short text as it is', () => {
    expect(keepLast('CQ CQ DE 9V1NE K\n')).toBe('CQ CQ DE 9V1NE K\n');
  });

  it('drops the oldest text, starting again at a word', () => {
    const text = 'PARIS '.repeat(5000);
    const kept = keepLast(text);
    expect(kept.length).toBeLessThanOrEqual(KEEP_CHARS);
    expect(kept.startsWith('PARIS ')).toBe(true);
    expect(text.endsWith(kept)).toBe(true);
  });
});

describe('one station', () => {
  it('decodes a CQ and settles it into the text after the silence', async () => {
    const list = await track([{ silence: 1 }, { text: 'CQ CQ DE 9V1NE 9V1NE K', hz: 650, wpm: 20 }, { silence: 4 }]);
    expect(list).toHaveLength(1);
    const s = list[0];
    expect(s.text).toBe('CQ CQ DE 9V1NE 9V1NE K\n');
    expect(s.pending).toBe('');
    expect(s.keying).toBe(false);
    expect(Math.abs(s.pitch - 650)).toBeLessThan(15);
    expect(s.wpm).not.toBeNull();
    expect(Math.abs(s.wpm! - 20)).toBeLessThan(3);
    // As it was while the station sent, not in the silence after.
    expect(s.snr).toBeGreaterThan(20);
  });

  it('ends an over after 3 seconds of silence: each over is a line', async () => {
    const list = await track([
      { silence: 1 },
      { text: 'CQ CQ DE 9V1NE K', hz: 650, wpm: 20 },
      { silence: 4 },
      { text: 'QRZ DE 9V1NE K', hz: 650, wpm: 20 },
      { silence: 4 },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe('CQ CQ DE 9V1NE K\nQRZ DE 9V1NE K\n');
  });

  it('keeps a word gap inside an over: a pause of 2 seconds is not the end of it', async () => {
    const list = await track([{ silence: 1 }, { text: 'CQ CQ', hz: 650, wpm: 20 }, { silence: 2 }, { text: 'DE 9V1NE K', hz: 650, wpm: 20 }, { silence: 4 }]);
    expect(list[0].text).toBe('CQ CQ DE 9V1NE K\n');
  });

  it('shows the over in progress before it ends', async () => {
    let ms = 0;
    const tracker = new SignalTracker(undefined, () => ms);
    listen(band([{ silence: 1 }, { text: 'CQ CQ DE 9V1NE K', hz: 650, wpm: 20 }, { silence: 1 }]), (events, time) => {
      ms = time * 1000;
      tracker.feed(events, time);
    }, () => tracker.dit);
    await settle();
    const [s] = tracker.list();
    expect(s.text).toBe('');
    expect(s.pending).toBe('CQ CQ DE 9V1NE K');
  });

  it('splits a long transmission without pauses at a word, on the same line', async () => {
    const words = 'PARIS '.repeat(18).trim();
    const list = await track([{ silence: 1 }, { text: words, hz: 650, wpm: 20 }, { silence: 4 }]);
    const text = list[0].text;
    expect(text).toBe(`${words}\n`);
    // 18 PARIS are 252 marks: one split at OVER_MARKS, written with a space.
    expect(18 * 14).toBeGreaterThan(OVER_MARKS);
  });

  it('forgets the text on Clear and goes on listening', async () => {
    let ms = 0;
    const tracker = new SignalTracker(undefined, () => ms);
    const sink = (events: DetectorEvent[], time: number) => {
      ms = time * 1000;
      tracker.feed(events, time);
    };
    const detector = new Detector(FS, { dit: 1.2 / 18 });
    const run = (samples: Float32Array) => {
      for (let i = 0; i < samples.length; i += 128) {
        sink(detector.process(samples.subarray(i, Math.min(samples.length, i + 128))), detector.time);
        if (tracker.dit) detector.setDit(tracker.dit);
      }
    };
    run(band([{ silence: 1 }, { text: 'CQ CQ DE 9V1NE K', hz: 650, wpm: 20 }, { silence: 4 }]));
    await settle();
    expect(tracker.list()[0].text).toBe('CQ CQ DE 9V1NE K\n');
    tracker.clear();
    expect(tracker.list()).toEqual([]);
    run(band([{ text: 'QRZ DE 9V1NE K', hz: 650, wpm: 20 }, { silence: 4 }]));
    await settle();
    const list = tracker.list();
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe('QRZ DE 9V1NE K\n');
  });
});

describe('two stations', () => {
  it('gives each pitch its own signal, text and speed', async () => {
    const list = await track([
      { silence: 1 },
      { text: 'CQ CQ CQ DE 9V1NE 9V1NE K', hz: 600, wpm: 16 },
      { silence: 2 },
      { text: '9V1NE DE G4ABC G4ABC GM OM UR RST 599 599 K', hz: 780, wpm: 24 },
      { silence: 4 },
    ]);
    expect(list).toHaveLength(2);
    const low = list.find((s) => s.pitch < 690)!;
    const high = list.find((s) => s.pitch > 690)!;
    expect(Math.abs(low.pitch - 600)).toBeLessThan(15);
    expect(Math.abs(high.pitch - 780)).toBeLessThan(15);
    expect(low.text).toContain('CQ CQ CQ DE 9V1NE 9V1NE K');
    // The detector moves to a new pitch once it has heard it for about a second, so the first words can be lost.
    expect(high.text).toContain('G4ABC GM OM UR RST 599 599 K');
    expect(high.id).not.toBe(low.id);
    // Newest activity first.
    expect(list[0].id).toBe(high.id);
    expect(Math.abs(low.wpm! - 16)).toBeLessThan(3);
    expect(Math.abs(high.wpm! - 24)).toBeLessThan(4);
  });

  it('goes back to the same signal when the first station sends again', async () => {
    const list = await track([
      { silence: 1 },
      { text: 'CQ CQ CQ DE 9V1NE 9V1NE K', hz: 600, wpm: 16 },
      { silence: 2 },
      { text: '9V1NE DE G4ABC G4ABC GM OM UR RST 599 599 K', hz: 780, wpm: 24 },
      { silence: 2 },
      { text: 'G4ABC DE 9V1NE R TNX FER CALL UR RST 579 579 K', hz: 600, wpm: 16 },
      { silence: 4 },
    ]);
    expect(list).toHaveLength(2);
    const low = list.find((s) => s.pitch < 690)!;
    expect(low.text.split('\n').filter(Boolean)).toHaveLength(2);
    expect(low.text).toContain('TNX FER CALL UR RST 579 579 K');
    expect(list[0].id).toBe(low.id);
  });
});

describe('the microphone source', () => {
  afterEach(() => {
    stopMic();
    vi.restoreAllMocks();
  });

  function mockEngine() {
    const commands: unknown[] = [];
    let listener: ((events: DetectorEvent[], time: number) => void) | null = null;
    vi.spyOn(engine, 'ensure').mockResolvedValue(undefined as never);
    vi.spyOn(engine, 'startMic').mockResolvedValue({ label: 'Test', bluetooth: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: FS });
    vi.spyOn(engine, 'stopMic').mockImplementation(() => undefined);
    vi.spyOn(engine, 'command').mockImplementation((c) => void commands.push(c));
    vi.spyOn(engine, 'onEvents').mockImplementation((l) => {
      listener = l;
      return () => (listener = null);
    });
    const sidetone = vi.spyOn(engine, 'sidetone').mockResolvedValue(undefined);
    const element = vi.spyOn(engine, 'sidetoneElement').mockImplementation(() => undefined);
    const play = vi.spyOn(engine, 'play');
    return { commands, send: (events: DetectorEvent[], time: number) => listener?.(events, time), silent: () => [sidetone, element, play].every((s) => !s.mock.calls.length) };
  }

  it("listens at any pitch without the user's pin and squelch, and puts them back on Stop", async () => {
    const e = mockEngine();
    settings.pinnedHz = 700;
    settings.squelchDb = 12;
    try {
      const source = new SingleSignalSource();
      await source.start();
      const pins = e.commands.filter((c) => (c as { type: string }).type === 'pin');
      const squelches = e.commands.filter((c) => (c as { type: string }).type === 'squelch');
      expect(pins.at(-1)).toEqual({ type: 'pin', hz: null });
      expect(squelches.at(-1)).toEqual({ type: 'squelch', db: null });
      source.stop();
      expect(e.commands.slice(-2)).toEqual([
        { type: 'pin', hz: 700 },
        { type: 'squelch', db: 12 },
      ]);
    } finally {
      settings.pinnedHz = null;
      settings.squelchDb = null;
    }
  });

  it('decodes what the detector hears, and never keys or plays a sound', async () => {
    const e = mockEngine();
    const source = new SingleSignalSource();
    const seen: RadioSignal[][] = [];
    source.subscribe((list) => seen.push(list));
    await source.start();
    // The detector's filters follow the last dit the source sent.
    const dit = () => (e.commands.findLast((c) => (c as { type: string }).type === 'dit') as { dit: number } | undefined)?.dit ?? null;
    listen(band([{ silence: 1 }, { text: 'CQ DE 9V1NE K', hz: 650, wpm: 20 }, { silence: 1 }]), e.send, dit);
    source.stop();
    await settle();
    const last = seen.at(-1)!;
    expect(last).toHaveLength(1);
    expect(last[0].text).toBe('CQ DE 9V1NE K\n');
    // Its speed went to the detector's filters.
    expect(e.commands.some((c) => (c as { type: string }).type === 'dit')).toBe(true);
    expect(e.silent()).toBe(true);
  });

  it('rejects with the browser error when the microphone is blocked', async () => {
    mockEngine();
    vi.spyOn(engine, 'startMic').mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    expect(signal.micOn).toBe(false);
    const source = new SingleSignalSource();
    const err = await source.start().catch((x: unknown) => x);
    expect(micError(err)).toBe("The microphone is blocked. Allow it in the browser's site settings, then try again.");
  });
});
