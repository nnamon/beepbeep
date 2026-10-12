<script module lang="ts">
  /**
   * `soundOff`: a screen is ready to listen to the touch key but waits for
   * sound, which the browser keeps off after a reload until a tap. The pad then
   * says a tap starts it, and its first tap turns sound on; the screen passes
   * that tap on as keying.
   */
  export const touchPad = $state({ soundOff: false });
</script>

<script lang="ts">
  // On-screen straight key for phones and tablets. Shown while a drill, QSO or
  // calibration is listening to the touch key. Pointer capture keeps the key
  // down if the finger slides off the pad; lifting anywhere releases it.
  import { touchKey } from '../lib/audio/live';
  import { engine } from '../lib/audio/engine';
  import { signal } from '../lib/state/signal.svelte';

  let pressed = $state(false);
  let pad: HTMLButtonElement;

  // iOS runs its own touch gestures (text selection, the magnifier, double-tap
  // zoom) from touch events, which cancelling pointer events does not stop.
  // These listeners must be non-passive to cancel them.
  $effect(() => {
    const stop = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    for (const type of ['touchstart', 'touchmove', 'touchend'] as const) pad.addEventListener(type, stop, { passive: false });
    return () => {
      for (const type of ['touchstart', 'touchmove', 'touchend'] as const) pad.removeEventListener(type, stop);
    };
  });

  const live = $derived(signal.touchKey);
  /** Not listening yet only because sound is off: a tap starts it. */
  const tapToStart = $derived(!live && touchPad.soundOff);

  function down(e: PointerEvent) {
    e.preventDefault();
    // A tap is what lets the browser play sound: it starts here, inside the tap.
    if (tapToStart) void engine.ensure().catch(() => undefined);
    if (pressed || !live) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer to capture (synthetic events) */
    }
    pressed = true;
    touchKey(true, e.timeStamp);
  }

  function up(e: PointerEvent) {
    if (!pressed) return;
    pressed = false;
    touchKey(false, e.timeStamp);
  }
</script>

<div class="dock">
  <button
    bind:this={pad}
    type="button"
    class="pad"
    class:on={live && (pressed || signal.keyDown)}
    class:idle={!live && !tapToStart}
    tabindex="-1"
    aria-disabled={!live && !tapToStart}
    aria-label={live
      ? 'Touch key. Hold to send. Space also keys.'
      : tapToStart
        ? 'Touch key. Tap it to turn sound on and start keying.'
        : 'Touch key, waiting until the app listens.'}
    onpointerdown={down}
    onpointerup={up}
    onpointercancel={up}
    onlostpointercapture={up}
    oncontextmenu={(e) => e.preventDefault()}
  >
    <span class="name">Key</span>
    <span class="hint">{live ? 'Hold to send' : tapToStart ? 'Tap to start' : 'Waiting'}</span>
  </button>
</div>

<style>
  .dock,
  .dock * {
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  .dock {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 11;
    display: flex;
    justify-content: center;
    padding: var(--s-1) calc(var(--s-2) + var(--safe-right)) calc(var(--s-1) + var(--safe-bottom)) calc(var(--s-2) + var(--safe-left));
    background: var(--bg);
    border-top: var(--hairline) solid var(--line);
  }

  .pad {
    width: 100%;
    max-width: 560px;
    height: 96px;
    border: 2px solid var(--muted);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s-half);
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }

  /* Not listening: stays in place, faded, so nothing on the page moves. */
  .pad.idle {
    opacity: 0.4;
    border-style: dashed;
  }

  .pad.on {
    border-color: var(--signal);
    background: var(--signal-soft);
  }

  .name {
    font-size: var(--size-l);
    font-weight: var(--weight-strong);
  }

  .hint {
    font-size: var(--size-s);
    color: var(--muted);
  }

  /* A phone on its side: a lower pad, so the drill keeps most of the short screen. Still a big target. */
  @media (orientation: landscape) and (max-height: 500px) {
    .dock {
      padding-top: var(--s-half);
      padding-bottom: calc(var(--s-half) + var(--safe-bottom));
    }

    .pad {
      height: 64px;
      flex-direction: row;
      gap: var(--s-2);
    }
  }
</style>
