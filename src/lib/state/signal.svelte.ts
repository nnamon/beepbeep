// What the signal bar shows: input level, tone lock, key state, speed.

import { untrack } from 'svelte';
import { engine, type MicInfo } from '../audio/engine';
import { settings } from './settings.svelte';

export const signal = $state({
  micOn: false,
  starting: false,
  info: null as MicInfo | null,
  error: '',
  level: -90,
  pitch: null as number | null,
  snr: 0,
  keyDown: false,
  wpm: 0,
  /** True during receive drills: the bar hides key and level in strict mode. */
  receiving: false,
  /** Last time the key was down (ms, performance clock). */
  lastKeyDown: 0,
  /** A short message such as a speed change, cleared after a moment. */
  notice: '',
  /** A decoder is listening to the on-screen touch key: the pad is live. */
  touchKey: false,
  /** Screens where you send are open: the pad stays in place (faded while not listening). */
  touchArea: 0,
});

let noticeTimer: ReturnType<typeof setTimeout> | null = null;

export function notify(text: string) {
  signal.notice = text;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (signal.notice = ''), 1800);
}

let unsub: (() => void) | null = null;

export async function startMic(): Promise<MicInfo | null> {
  signal.starting = true;
  signal.error = '';
  try {
    const info = await engine.startMic(settings.micDeviceId || undefined);
    signal.info = info;
    signal.micOn = true;
    if (settings.pinnedHz) engine.command({ type: 'pin', hz: settings.pinnedHz });
    unsub?.();
    unsub = engine.onEvents((events) => {
      for (const e of events) {
        if (e.type === 'status') {
          signal.level = e.level;
          signal.pitch = e.pitch;
          signal.snr = e.snr;
          signal.keyDown = e.keyDown;
          if (e.keyDown) signal.lastKeyDown = performance.now();
        } else if (e.type === 'lock') signal.pitch = e.hz;
      }
    });
    return info;
  } catch (err) {
    signal.error = micError(err);
    signal.micOn = false;
    return null;
  } finally {
    signal.starting = false;
  }
}

export function stopMic() {
  unsub?.();
  unsub = null;
  engine.stopMic();
  signal.micOn = false;
  signal.pitch = null;
  signal.keyDown = false;
  signal.level = -90;
}

function micError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError') return 'Microphone blocked. Allow it in site settings and retry.';
  if (name === 'NotFoundError') return 'No microphone found.';
  if (name === 'NotReadableError') return 'Microphone in use by another app.';
  return (err as Error)?.message || 'Microphone failed to start.';
}

/**
 * Call from a screen where you send (in an $effect): the touch key pad stays
 * on screen while it is open, so it does not come and go, moving the layout,
 * each time a decoder starts or stops. Returns the release.
 */
export function touchKeyArea(): () => void {
  // Untracked: the calling effect must not depend on the count it changes.
  untrack(() => signal.touchArea++);
  return () => {
    untrack(() => (signal.touchArea = Math.max(0, signal.touchArea - 1)));
  };
}
