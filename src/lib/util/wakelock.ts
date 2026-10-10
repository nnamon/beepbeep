// Keeps the screen on during drills where supported (Screen Wake Lock API).

import { practiceRunning } from '../state/clock.svelte';

let lock: WakeLockSentinel | null = null;
let wanted = false;

/** Keeps the screen on while a drill runs; also drives the practice clock. */
export async function keepAwake(on: boolean) {
  wanted = on;
  practiceRunning(on);
  try {
    if (on && !lock && 'wakeLock' in navigator) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => (lock = null));
    } else if (!on && lock) {
      await lock.release();
      lock = null;
    }
  } catch {
    /* not allowed (e.g. low battery); carry on without it */
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible') void keepAwake(true);
  });
}
