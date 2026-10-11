<script lang="ts">
  // On-screen straight key for phones and tablets. Shown while a drill, QSO or
  // calibration is listening to the touch key. Pointer capture keeps the key
  // down if the finger slides off the pad; lifting anywhere releases it.
  import { touchKey } from '../lib/audio/live';
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

  function down(e: PointerEvent) {
    e.preventDefault();
    if (pressed) return;
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
    class:on={pressed || signal.keyDown}
    tabindex="-1"
    aria-label="Touch key. Hold to send. Space also keys."
    onpointerdown={down}
    onpointerup={up}
    onpointercancel={up}
    onlostpointercapture={up}
    oncontextmenu={(e) => e.preventDefault()}
  >
    <span class="name">Key</span>
    <span class="hint">Hold to send</span>
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
    padding: var(--s-1) var(--s-2) calc(var(--s-1) + env(safe-area-inset-bottom));
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
</style>
