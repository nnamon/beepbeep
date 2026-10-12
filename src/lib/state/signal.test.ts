// @vitest-environment jsdom
// Starting the microphone: presses that come while the browser is still
// asking for it share that one start.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { engine, type MicInfo } from '../audio/engine';
import { signal, startMic } from './signal.svelte';

const INFO: MicInfo = { label: 'Mic', bluetooth: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48000 };

afterEach(() => vi.restoreAllMocks());

describe('startMic', () => {
  // Before: a second Start while the permission prompt was open opened a
  // second stream, and one of them stayed on after leaving.
  it('shares a start that is still waiting', async () => {
    let open!: (i: MicInfo) => void;
    const start = vi.spyOn(engine, 'startMic').mockImplementation(() => new Promise((r) => (open = r)));
    vi.spyOn(engine, 'onEvents').mockImplementation(() => () => undefined);
    const a = startMic();
    const b = startMic();
    expect(start).toHaveBeenCalledTimes(1);
    expect(signal.starting).toBe(true);
    open(INFO);
    expect(await a).toBe(INFO);
    expect(await b).toBe(INFO);
    expect(signal.micOn).toBe(true);
    expect(signal.starting).toBe(false);
    // Once that start is over, a new one (another device) asks again.
    void startMic();
    expect(start).toHaveBeenCalledTimes(2);
    open(INFO);
  });
});

describe('engine.startMic', () => {
  it('asks the browser once for two starts while it waits', async () => {
    const ctx = { audioWorklet: { addModule: () => Promise.resolve() }, sampleRate: 48000 };
    vi.spyOn(engine, 'ensure').mockResolvedValue(ctx as never);
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    // The permission prompt stays open.
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(() => undefined));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    void engine.startMic();
    void engine.startMic();
    await new Promise((r) => setTimeout(r, 0));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
