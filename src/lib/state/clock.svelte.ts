// Practice clock: minutes of active drill time, for the 30-minute break nudge.
// A gap of 10 minutes or more starts a fresh count.

export const clock = $state({ activeMs: 0, running: false });

let since = 0;
let lastStop = 0;
let timer: ReturnType<typeof setInterval> | null = null;

export function practiceRunning(on: boolean) {
  const now = Date.now();
  if (on && !clock.running) {
    if (lastStop && now - lastStop > 10 * 60_000) clock.activeMs = 0;
    since = now;
    clock.running = true;
    timer = setInterval(() => {
      clock.activeMs += Date.now() - since;
      since = Date.now();
    }, 5000);
  } else if (!on && clock.running) {
    clock.activeMs += now - since;
    clock.running = false;
    lastStop = now;
    if (timer) clearInterval(timer);
    timer = null;
  }
}
