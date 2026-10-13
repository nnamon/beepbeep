// @vitest-environment jsdom
// The Radio screen's source (multi.ts) with the audio engine mocked: the
// radio worklet's batches come from its own code (batch.ts) run here over
// rendered audio, as the browser would post them.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderBand, type Band } from './band';
import { RadioRunner, type RadioBatch, type RadioCommand } from './batch';
import { BLOCK } from './listen';
import { MultiSignalSource } from './multi';
import type { RadioSignal } from './source';
import { engine } from '../audio/engine';
import { micError, signal, stopMic } from '../state/signal.svelte';

const FS = 48000;

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

function mockEngine() {
  const calls: string[] = [];
  const commands: RadioCommand[] = [];
  const radio = new Set<(b: RadioBatch) => void>();
  vi.spyOn(engine, 'ensure').mockResolvedValue(undefined as never);
  vi.spyOn(engine, 'prepareRadio').mockImplementation(async () => void calls.push('prepareRadio'));
  vi.spyOn(engine, 'startMic').mockImplementation(async () => {
    calls.push('startMic');
    return { label: 'Test', bluetooth: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: FS };
  });
  vi.spyOn(engine, 'stopMic').mockImplementation(() => void calls.push('stopMic'));
  vi.spyOn(engine, 'startRadio').mockImplementation(async () => void calls.push('startRadio'));
  vi.spyOn(engine, 'stopRadio').mockImplementation(() => void calls.push('stopRadio'));
  vi.spyOn(engine, 'onRadio').mockImplementation((l) => {
    radio.add(l);
    return () => radio.delete(l);
  });
  vi.spyOn(engine, 'radioCommand').mockImplementation((c) => void commands.push(c));
  vi.spyOn(engine, 'command').mockImplementation(() => undefined);
  const sidetone = vi.spyOn(engine, 'sidetone').mockResolvedValue(undefined);
  const element = vi.spyOn(engine, 'sidetoneElement').mockImplementation(() => undefined);
  const play = vi.spyOn(engine, 'play');
  return {
    calls,
    commands,
    /** The worklet over the audio: its batches to every listener, and the dits sent back to it. */
    play(samples: Float32Array) {
      const runner = new RadioRunner(FS);
      let sent = 0;
      for (let i = 0; i < samples.length; i += BLOCK) {
        while (sent < commands.length) runner.command(commands[sent++]);
        const b = runner.process(samples.subarray(i, Math.min(samples.length, i + BLOCK)));
        if (b) for (const l of [...radio]) l(b);
      }
    },
    send: (b: RadioBatch) => {
      for (const l of [...radio]) l(b);
    },
    silent: () => [sidetone, element, play].every((s) => !s.mock.calls.length),
  };
}

const twoAtOnce: Band = {
  stations: [
    { name: 'A', pitch: 600, wpm: 20, sends: [{ text: 'CQ CQ DE 9V1XX 9V1XX K', at: 0.5 }] },
    { name: 'B', pitch: 750, wpm: 16, levelDb: -6, sends: [{ text: 'VK2BHF DE JA1QRT UR 579 K', at: 1.2 }] },
  ],
  noise: { snrDb: 20 },
  seed: 5,
};

describe('the Radio source', () => {
  afterEach(() => {
    stopMic();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('loads its worklet before asking for the microphone, then listens with it', async () => {
    const e = mockEngine();
    const source = new MultiSignalSource();
    await source.start();
    expect(e.calls).toEqual(['prepareRadio', 'startMic', 'startRadio']);
    source.stop();
    expect(e.calls.at(-1)).toBe('stopRadio');
  });

  it('reads every signal at once, sends each channel its speed, and never keys or plays a sound', async () => {
    const e = mockEngine();
    const source = new MultiSignalSource();
    const seen: RadioSignal[][] = [];
    source.subscribe((list) => seen.push(list));
    await source.start();
    e.play(renderBand(twoAtOnce, FS).samples);
    source.stop();
    await settle();
    const last = seen.at(-1)!;
    expect(last.map((s) => [Math.round(s.pitch / 50) * 50, s.text + s.pending]).sort()).toEqual([
      [600, 'CQ CQ DE 9V1XX 9V1XX K'],
      [750, 'VK2BHF DE JA1QRT UR 579 K'],
    ]);
    // The 16 wpm station's dit went to its channel's filter (the decoders start at 20 wpm, so the other's needed none).
    const dits = e.commands.filter((c) => c.type === 'dit');
    expect(new Set(dits.map((c) => c.ch)).size).toBe(1);
    expect(dits.at(-1)!.dit).toBeCloseTo(1.2 / 16, 2);
    expect(e.silent()).toBe(true);
  });

  it('keeps the text on Stop and goes on with it after Start', async () => {
    const e = mockEngine();
    const source = new MultiSignalSource();
    let last: RadioSignal[] = [];
    source.subscribe((list) => (last = list));
    await source.start();
    e.play(renderBand({ stations: [{ name: 'A', pitch: 650, wpm: 20, sends: [{ text: 'CQ DE 9V1NE K', at: 0.5 }] }], noise: { snrDb: 25 }, seed: 2 }, FS).samples);
    source.stop();
    expect(last.map((s) => s.text)).toEqual(['CQ DE 9V1NE K']);
    const id = last[0].id;
    // A new worklet: its time and its channels start again.
    await source.start();
    e.play(renderBand({ stations: [{ name: 'A', pitch: 652, wpm: 20, sends: [{ text: 'TEST K', at: 0.5 }] }], noise: { snrDb: 25 }, seed: 3 }, FS).samples);
    source.stop();
    expect(last).toHaveLength(1);
    expect(last[0].id).toBe(id);
    expect(last[0].text).toBe('CQ DE 9V1NE K\nTEST K');
  });

  it('on Clear forgets every text and goes on listening', async () => {
    const e = mockEngine();
    const source = new MultiSignalSource();
    let last: RadioSignal[] = [];
    source.subscribe((list) => (last = list));
    await source.start();
    e.play(renderBand(twoAtOnce, FS).samples);
    source.subscribe((list) => (last = list));
    expect(last).toHaveLength(2);
    source.clear();
    expect(last).toEqual([]);
    expect(e.calls).not.toContain('stopRadio');
  });

  it('tells the screen a few times a second while listening', async () => {
    vi.useFakeTimers();
    mockEngine();
    const source = new MultiSignalSource();
    let n = 0;
    source.subscribe(() => n++);
    await source.start();
    n = 0;
    vi.advanceTimersByTime(1000);
    expect(n).toBe(4);
    source.stop();
    n = 0;
    vi.advanceTimersByTime(5000);
    // After Stop, once more, then no more: nothing is left to read.
    expect(n).toBeLessThanOrEqual(1);
  });

  it('shows the level and the key light in the signal bar from its batches, and no pitch', async () => {
    const e = mockEngine();
    const source = new MultiSignalSource();
    await source.start();
    e.send({ type: 'events', events: [], time: 1, lag: 0.35, level: -42, keying: 2 });
    expect(signal.level).toBe(-42);
    expect(signal.keyDown).toBe(true);
    expect(signal.pitch).toBeNull();
    e.send({ type: 'events', events: [], time: 1.05, lag: 0.35, level: -60, keying: 0 });
    expect(signal.keyDown).toBe(false);
    source.stop();
  });

  it('Stop while the browser asks for the microphone gives that start up', async () => {
    const e = mockEngine();
    let allow!: () => void;
    vi.spyOn(engine, 'startMic').mockImplementation(
      () =>
        new Promise((r) => {
          allow = () => r({ label: 'Test', bluetooth: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: FS });
        }),
    );
    const source = new MultiSignalSource();
    const started = source.start();
    await settle();
    source.stop();
    allow();
    await started;
    expect(e.calls).not.toContain('startRadio');
  });

  it('rejects with the browser error when the microphone is blocked', async () => {
    const e = mockEngine();
    vi.spyOn(engine, 'startMic').mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    expect(signal.micOn).toBe(false);
    const source = new MultiSignalSource();
    const err = await source.start().catch((x: unknown) => x);
    expect(micError(err)).toBe("The microphone is blocked. Allow it in the browser's site settings, then try again.");
    expect(e.calls).not.toContain('startRadio');
  });
});
